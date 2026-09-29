import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { findRoute } from "../shared/routes";
import { routerSettings } from "../shared/settings";

type PaseoApi = PluginHandlerContext["paseo"];
type RouterConfig = z.infer<typeof routerSettings.schema>;

const runFile = promisify(execFile);

export function defaultOverlayPath(): string {
  const paseoHome = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
  return join(paseoHome, "plugin-data", "agent-router", "omp-overlay.yml");
}

/**
 * Owns the omp settings overlay that every Paseo-launched omp session loads through
 * `PI_CONFIG_FILES`. omp reloads overlays before each task dispatch, so rewriting the file
 * reroutes subagents of running sessions too.
 */
export class Router {
  private config: RouterConfig = routerSettings.schema.parse({});
  private forcedRoles: Record<string, string> = {};
  private generatedAt: string | null = null;
  private error: string | null = null;
  private regenerating: Promise<void> | null = null;

  constructor(
    private readonly settings: PluginSettings<typeof routerSettings.schema>,
    readonly overlayPath: string,
  ) {}

  current(): RouterConfig {
    return this.config;
  }

  /** Only after the first overlay exists: a missing overlay file must not reach omp. */
  isReady(): boolean {
    return this.generatedAt !== null;
  }

  regenerate(): Promise<void> {
    this.regenerating ??= this.write().finally(() => {
      this.regenerating = null;
    });
    return this.regenerating;
  }

  async status() {
    const overlay = await readFile(this.overlayPath, "utf8").catch(() => "");
    return {
      overlayPath: this.overlayPath,
      overlay,
      generatedAt: this.generatedAt,
      forcedRoles: this.forcedRoles,
      error: this.error,
    };
  }

  /** Session env with the overlay appended last, so it wins over overlays set elsewhere. */
  sessionEnv(env: Record<string, string>): Record<string, string> {
    const existing = env.PI_CONFIG_FILES ?? process.env.PI_CONFIG_FILES ?? "";
    const files = existing.split(":").filter((file) => file && file !== this.overlayPath);
    return { ...env, PI_CONFIG_FILES: [...files, this.overlayPath].join(":") };
  }

  /**
   * The route's target for a new agent's model while forcing, with a thinking option the target
   * supports (the source's option may not exist there).
   */
  async forcedModel(
    api: PaseoApi,
    model: string,
    thinkingOptionId: string | undefined,
    cwd: string,
  ): Promise<{ model: string; thinkingOptionId: string | undefined } | null> {
    if (!this.config.force) return null;
    const route = findRoute(model, this.config.routes);
    if (!route) return null;
    const target = route.to[0];
    try {
      const { models } = await api.providers.listModels("omp", { cwd });
      const definition = models?.find((candidate) => candidate.id === target);
      const options = definition?.thinkingOptions?.map((option) => option.id) ?? [];
      const keep = thinkingOptionId !== undefined && options.includes(thinkingOptionId);
      return { model: target, thinkingOptionId: keep ? thinkingOptionId : definition?.defaultThinkingOptionId };
    } catch (error) {
      console.error("Could not read omp models; creating without a thinking option", error);
      return { model: target, thinkingOptionId: undefined };
    }
  }

  private async write(): Promise<void> {
    const state = await this.settings.read();
    this.config = state.status === "ready" ? state.values : routerSettings.schema.parse({});
    let roles: Record<string, string> = {};
    try {
      roles = await readOmpModelRoles();
      this.error = state.status === "ready" ? null : `Invalid settings, using defaults: ${state.error}`;
    } catch (error) {
      this.error = `Could not read omp modelRoles: ${error instanceof Error ? error.message : String(error)}`;
    }
    const { overlay, forcedRoles } = buildOverlay(this.config, roles);
    // JSON is valid YAML, and omp parses the overlay as YAML.
    await writeAtomic(this.overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);
    this.forcedRoles = forcedRoles;
    this.generatedAt = new Date().toISOString();
  }
}

function buildOverlay(config: RouterConfig, roles: Record<string, string>) {
  const forcedRoles: Record<string, string> = {};
  if (config.force) {
    for (const [role, selector] of Object.entries(roles)) {
      if (selector.startsWith("@")) continue;
      const route = findRoute(selector, config.routes);
      if (route) forcedRoles[role] = route.to[0];
    }
  }
  const armed = (config.autoFallback || config.force) && config.routes.length > 0;
  const overlay = {
    ...(armed
      ? {
          retry: {
            modelFallback: true,
            usageAwareFallback: config.autoFallback,
            usageReservePct: config.usageReservePct,
            usageReservePolicy: "auto",
            fallbackChains: Object.fromEntries(config.routes.map((route) => [route.from, route.to])),
          },
        }
      : {}),
    ...(Object.keys(forcedRoles).length > 0 ? { modelRoles: forcedRoles } : {}),
  };
  return { overlay, forcedRoles };
}

/** Effective global + project-independent roles, as omp resolves them for the daemon user. */
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
