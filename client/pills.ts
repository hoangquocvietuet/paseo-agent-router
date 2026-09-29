import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { RoutePopover } from "./route-popover";

const OMP_PROVIDER = "omp";
const RETRY_MS = 5_000;

interface AgentPlacement {
  id?: string;
  provider?: string;
  status?: string;
  workspaceId?: string | null;
  archivedAt?: string | null;
}

/** An omp session with a composer: loaded (not closed), active, and placed in a workspace. */
function placementOf(agent: AgentPlacement): { agentId: string; workspaceId: string } | null {
  if (!agent.id || agent.provider !== OMP_PROVIDER) return null;
  if (agent.status === "closed" || agent.archivedAt) return null;
  if (!agent.workspaceId) return null;
  return { agentId: agent.id, workspaceId: agent.workspaceId };
}

/** Keeps one "Routes" composer pill on every live omp session. Returns the cleanup. */
export function registerRoutePills(client: PluginClientContext): () => void {
  const pills = new Map<string, { workspaceId: string; registration: PluginButtonRegistration }>();
  let stopped = false;
  let release: (() => void) | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const place = (agent: AgentPlacement) => {
    const placement = placementOf(agent);
    const current = agent.id ? pills.get(agent.id) : undefined;
    if (current && current.workspaceId === placement?.workspaceId) return;
    if (current && agent.id) {
      current.registration.remove();
      pills.delete(agent.id);
    }
    if (!placement) return;
    const registration = client.addComposerPill({
      id: "routes",
      workspaceId: placement.workspaceId,
      agentId: placement.agentId,
      button: {
        title: "Model routes for this session",
        label: "Routes",
        icon: "Route",
        behavior: { kind: "popover", Content: RoutePopover },
      },
    });
    pills.set(placement.agentId, { workspaceId: placement.workspaceId, registration });
  };
  const drop = (agentId: string) => {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  };

  const open = () => {
    client.paseo.agents
      .list({ subscribe: {} })
      .then(({ subscription }) => {
        if (stopped) {
          void subscription.release().catch(() => undefined);
          return;
        }
        const unsubscribe = subscription.subscribe({
          snapshot(list) {
            const live = new Set<string>();
            for (const { agent } of list.entries) {
              place(agent);
              if (placementOf(agent)) live.add(agent.id);
            }
            for (const agentId of [...pills.keys()]) if (!live.has(agentId)) drop(agentId);
          },
          update(message) {
            if (message.type !== "agent_update") return;
            const payload: { kind?: string; agentId?: string; agent?: AgentPlacement } = message.payload;
            if (payload.kind === "remove" && payload.agentId) drop(payload.agentId);
            else if (payload.agent) place(payload.agent);
          },
          error() {
            reopen();
          },
        });
        release = () => {
          unsubscribe();
          void subscription.release().catch(() => undefined);
        };
      })
      .catch(reopen);
  };
  const reopen = () => {
    release?.();
    release = null;
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = null;
      open();
    }, RETRY_MS);
  };

  open();
  return () => {
    stopped = true;
    if (retry !== null) {
      clearTimeout(retry);
      retry = null;
    }
    release?.();
    for (const agentId of [...pills.keys()]) drop(agentId);
  };
}
