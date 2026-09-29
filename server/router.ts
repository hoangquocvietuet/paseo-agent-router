import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { switchTarget, type Pair } from "../shared/routes";
import { effectivePairs, routerSettings } from "../shared/settings";
import { discoverOmpAgents, primaryModel } from "./omp-agents";

type PaseoApi = PluginHandlerContext["paseo"];
type RouterValues = z.infer<typeof routerSettings.schema>;

/** The omp session a routing overlay is built for. */
interface SessionTarget {
  agentId: string | null;
  model: string | null;
  cwd: string | null;
}

interface BuiltOverlay {
  overlay: object;
  roles: Record<string, string>;
  agents: Record<string, string>;
}

const runFile = promisify(execFile);

export function defaultDataDir(): string {
  const paseoHome = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
  return join(paseoHome, "plugin-data", "agent-router");
}

/**
 * Owns one omp settings overlay per omp session, handed over through `PI_CONFIG_FILES`. omp
 * reloads overlays before each task dispatch, so rewriting a file reroutes that session's tasks
 * without restarting it.
 */
export class Router {
  private values: RouterValues = routerSettings.schema.parse({});
  private roles: Record<string, string> = {};
  private error: string | null = null;
  private api: PaseoApi | null = null;
  private loaded: Promise<void> | null = null;
  /** Agents whose overlay this process keeps current. */
  private readonly known = new Set<string>();

  constructor(
    private readonly settings: PluginSettings<typeof routerSettings.schema>,
    private readonly dataDir: string,
  ) {}

  /** Hooks and handlers carry the API; the entry point does not. */
  attach(api: PaseoApi): void {
    this.api ??= api;
  }

  overlayPath(agentId: string): string {
    return join(this.dataDir, "overlays", `${encodeURIComponent(agentId)}.yml`);
  }

  /** Sessions opened by an earlier version load this global-only overlay. */
  private legacyOverlayPath(): string {
    return join(this.dataDir, "omp-overlay.yml");
  }

  /** Re-read settings and omp roles, then rewrite every overlay. */
  async reload(): Promise<void> {
    const state = await this.settings.read();
    this.values = state.status === "ready" ? state.values : routerSettings.schema.parse({});
    this.error = state.status === "ready" ? null : `Invalid settings, using defaults: ${state.error}`;
    try {
      this.roles = await readOmpModelRoles();
    } catch (error) {
      this.error = `Could not read omp modelRoles: ${error instanceof Error ? error.message : String(error)}`;
    }
    const legacy = await this.build({ agentId: null, model: null, cwd: null });
    await writeAtomic(this.legacyOverlayPath(), serialize(legacy.overlay));
    const files = await readdir(join(this.dataDir, "overlays")).catch(() => []);
    for (const file of files) {
      if (file.endsWith(".yml")) this.known.add(decodeURIComponent(file.slice(0, -4)));
    }
    if (this.api) await Promise.all([...this.known].map((agentId) => this.refresh(agentId)));
  }

  private ensureLoaded(): Promise<void> {
    this.loaded ??= this.reload().catch((error) => console.error("Router reload failed", error));
    return this.loaded;
  }

  /** Overlay for a session about to open. Its snapshot may not exist yet for a new agent. */
  async prepareSession(agentId: string, cwd: string): Promise<string> {
    await this.ensureLoaded();
    const snapshot = this.api ? await fetchAgent(this.api, agentId) : null;
    await this.write({ agentId, model: snapshot?.model ?? null, cwd: snapshot?.cwd ?? cwd });
    return this.overlayPath(agentId);
  }

  /** Rebuild one agent's overlay from its current model; drop it once the agent is gone. */
  async refresh(agentId: string): Promise<void> {
    if (!this.api) return;
    const snapshot = await fetchAgent(this.api, agentId).catch(() => undefined);
    if (snapshot === undefined) return;
    if (!snapshot) {
      this.known.delete(agentId);
      await rm(this.overlayPath(agentId), { force: true });
      return;
    }
    await this.write({ agentId, model: snapshot.model, cwd: snapshot.cwd });
  }

  async describe(agentId: string) {
    await this.ensureLoaded();
    const snapshot = this.api ? await fetchAgent(this.api, agentId) : null;
    const target = { agentId, model: snapshot?.model ?? null, cwd: snapshot?.cwd ?? null };
    const built = await this.write(target);
    return {
      overlayPath: this.overlayPath(agentId),
      overlay: serialize(built.overlay),
      model: target.model,
      roles: built.roles,
      agents: built.agents,
      error: this.error,
    };
  }

  /**
   * The global pair's target for a new agent's model, with a thinking option the target supports
   * (the source's option may not exist there).
   */
  async newAgentModel(
    model: string,
    thinkingOptionId: string | undefined,
    cwd: string,
  ): Promise<{ model: string; thinkingOptionId: string | undefined } | null> {
    await this.ensureLoaded();
    const target = switchTarget(model, this.values.pairs);
    if (!target || !this.api) return target ? { model: target, thinkingOptionId: undefined } : null;
    try {
      const { models } = await this.api.providers.listModels("omp", { cwd });
      const definition = models?.find((candidate) => candidate.id === target);
      const options = definition?.thinkingOptions?.map((option) => option.id) ?? [];
      const keep = thinkingOptionId !== undefined && options.includes(thinkingOptionId);
      return { model: target, thinkingOptionId: keep ? thinkingOptionId : definition?.defaultThinkingOptionId };
    } catch (error) {
      console.error("Could not read omp models; creating without a thinking option", error);
      return { model: target, thinkingOptionId: undefined };
    }
  }

  /** Session env with the agent's overlay appended last, so it wins over overlays set elsewhere. */
  sessionEnv(env: Record<string, string>, overlayPath: string): Record<string, string> {
    const existing = env.PI_CONFIG_FILES ?? process.env.PI_CONFIG_FILES ?? "";
    const files = existing
      .split(":")
      .filter((file) => file && file !== overlayPath && file !== this.legacyOverlayPath());
    return { ...env, PI_CONFIG_FILES: [...files, overlayPath].join(":") };
  }

  private async write(target: SessionTarget & { agentId: string }): Promise<BuiltOverlay> {
    const built = await this.build(target);
    await writeAtomic(this.overlayPath(target.agentId), serialize(built.overlay));
    this.known.add(target.agentId);
    return built;
  }

  private async build(target: SessionTarget): Promise<BuiltOverlay> {
    const pairs = effectivePairs(this.values, target.agentId);
    const roles: Record<string, string> = {};
    for (const [role, selector] of Object.entries(this.roles)) {
      const to = selector.startsWith("@") ? undefined : switchTarget(selector, pairs);
      if (to) roles[role] = to;
    }
    const agents: Record<string, string> = {};
    if (target.cwd && pairs.length > 0) {
      for (const [name, models] of await discoverOmpAgents(target.cwd)) {
        const model = primaryModel(models, this.roles, target.model);
        const to = model ? switchTarget(model, pairs) : undefined;
        if (to) agents[name] = to;
      }
    }
    const fallbackChains = chainsFor(pairs, this.values.autoFallback ? this.values.fallbacks : []);
    const overlay = {
      ...(Object.keys(fallbackChains).length > 0
        ? {
            retry: {
              modelFallback: true,
              usageAwareFallback: this.values.autoFallback,
              usageReservePct: this.values.usageReservePct,
              usageReservePolicy: "auto",
              fallbackChains,
            },
          }
        : {}),
      ...(Object.keys(roles).length > 0 ? { modelRoles: roles } : {}),
      ...(Object.keys(agents).length > 0 ? { task: { agentModelOverrides: agents } } : {}),
    };
    return { overlay, roles, agents };
  }
}

/** Switch-now pairs also act as fallbacks, ahead of the fallback-only routes for the same key. */
function chainsFor(pairs: readonly Pair[], fallbacks: readonly { from: string; to: readonly string[] }[]) {
  const chains: Record<string, string[]> = {};
  const add = (from: string, to: string) => {
    const chain = (chains[from] ??= []);
    if (!chain.includes(to)) chain.push(to);
  };
  for (const pair of pairs) add(pair.from, pair.to);
  for (const route of fallbacks) for (const to of route.to) add(route.from, to);
  return chains;
}

/** JSON is valid YAML, and omp parses overlays as YAML. */
function serialize(overlay: object): string {
  return `${JSON.stringify(overlay, null, 2)}\n`;
}

/** `null` when the daemon no longer knows the agent; other failures propagate. */
async function fetchAgent(
  api: PaseoApi,
  agentId: string,
): Promise<{ model: string | null; cwd: string } | null> {
  try {
    const agent = (await api.agents.ref(agentId).refresh())?.agent;
    return agent ? { model: agent.model, cwd: agent.cwd } : null;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Agent not found")) return null;
    throw error;
  }
}

/** Global omp roles for the daemon user (project `.omp/config.yml` roles are not covered). */
async function readOmpModelRoles(): Promise<Record<string, string>> {
  const command = process.env.OMP_COMMAND ?? "omp";
  const { stdout } = await runFile(command, ["config", "get", "modelRoles"], { timeout: 20_000 });
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

async function writeAtomic(path: string, body: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, body, "utf8");
  await rename(temporary, path);
}
