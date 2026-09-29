import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/**
 * omp's bundled task agents and their model lists (`omp agents unpack`). Discovered agents with
 * the same name replace them.
 */
const BUNDLED_AGENTS: Record<string, readonly string[]> = {
  task: ["@task"],
  sonic: ["@smol"],
  scout: ["@smol"],
  reviewer: ["@slow"],
  "security-reviewer": [],
};

/** Task agent name → its frontmatter model list (empty: inherits the parent's model). */
export type OmpAgentModels = Map<string, readonly string[]>;

function userAgentsDir(): string {
  return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omp", "agent"), "agents");
}

/** Nearest `.omp/agents` from `cwd` upward, like omp's project discovery. */
async function projectAgentsDir(cwd: string): Promise<string | null> {
  for (let directory = cwd; ; directory = dirname(directory)) {
    const candidate = join(directory, ".omp", "agents");
    if (await stat(candidate).then((entry) => entry.isDirectory(), () => false)) return candidate;
    if (dirname(directory) === directory) return null;
  }
}

/**
 * Task agents an omp session in `cwd` can spawn, in omp's first-wins order: project, user, then
 * bundled. Extension and Claude-plugin agents are not covered.
 */
export async function discoverOmpAgents(cwd: string): Promise<OmpAgentModels> {
  const agents: OmpAgentModels = new Map();
  for (const directory of [await projectAgentsDir(cwd), userAgentsDir()]) {
    if (!directory) continue;
    const files = (await readdir(directory).catch(() => [])).filter((file) => file.endsWith(".md")).sort();
    for (const file of files) {
      const parsed = parseFrontmatter(await readFile(join(directory, file), "utf8").catch(() => ""));
      const name = parsed.name ?? basename(file, ".md");
      if (!agents.has(name)) agents.set(name, parsed.models);
    }
  }
  for (const [name, models] of Object.entries(BUNDLED_AGENTS)) {
    if (!agents.has(name)) agents.set(name, models);
  }
  return agents;
}

/** `name` and `model` from agent frontmatter: a CSV string or a YAML list. */
function parseFrontmatter(text: string): { name?: string; models: string[] } {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return { models: [] };
  const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, "").trim();
  let name: string | undefined;
  const models: string[] = [];
  for (let index = 1; index < lines.length && lines[index].trim() !== "---"; index++) {
    const line = lines[index];
    const field = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!field) continue;
    if (field[1] === "name") name = unquote(field[2]) || undefined;
    if (field[1] !== "model") continue;
    if (field[2].trim()) {
      models.push(...unquote(field[2]).split(",").map(unquote).filter(Boolean));
      continue;
    }
    for (let item = index + 1; item < lines.length && /^\s+-\s*/.test(lines[item]); item++) {
      models.push(unquote(lines[item].replace(/^\s+-\s*/, "")));
    }
  }
  return { name, models };
}

/**
 * The model omp would pick first for a task agent: its first model, a role alias expanded
 * through `roles`, or the parent's model when the agent names none or the role is unset.
 */
export function primaryModel(
  models: readonly string[],
  roles: Readonly<Record<string, string>>,
  parentModel: string | null,
): string | null {
  const first = models[0];
  if (!first) return parentModel;
  if (!first.startsWith("@")) return first;
  return roles[first.slice(1).split(":")[0]] ?? parentModel;
}
