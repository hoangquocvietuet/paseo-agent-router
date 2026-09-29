import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { defaultDataDir, Router } from "./server/router";
import { agentRoutingRpc } from "./shared/rpc";
import { routerSettings } from "./shared/settings";

const OMP_PROVIDER = "omp";
/** omp roles and agent files can change outside Paseo (`/model`, `omp config set`, edits). */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(routerSettings);
  const router = new Router(settings, defaultDataDir());
  const reload = () => router.reload().catch((error) => console.error("Router reload failed", error));

  const unsubscribe = settings.subscribe(() => reload());
  const timer = setInterval(reload, REFRESH_INTERVAL_MS);

  // Every omp session Paseo opens (create, resume, refresh) loads its own routing overlay.
  server.before("agent.session_open", async ({ request }, { paseo }) => {
    if (request.provider !== OMP_PROVIDER) return;
    router.attach(paseo);
    const overlayPath = await router.prepareSession(request.agentId, request.cwd);
    return { ...request, env: router.sessionEnv(request.env, overlayPath) };
  });

  // Global pairs switch new omp agents right away; their tasks follow the parent's model.
  server.before("agent.create", async ({ request }, { paseo }) => {
    const { config } = request;
    if (config.provider !== OMP_PROVIDER || !config.model) return;
    router.attach(paseo);
    const switched = await router.newAgentModel(config.model, config.thinkingOptionId, config.cwd);
    if (!switched) return;
    console.log(`Routing new agent from ${config.model} to ${switched.model}`);
    return { ...request, config: { ...config, ...switched } };
  });

  // A new agent's snapshot exists only after its session opened; a turn may follow a model change.
  const refreshAgent = (event: { agent: { id: string; provider: string } }, { paseo }: PluginHookContext) => {
    if (event.agent.provider !== OMP_PROVIDER) return;
    router.attach(paseo);
    return router.refresh(event.agent.id);
  };
  server.on("agent.created", refreshAgent);
  server.on("agent.turn_started", refreshAgent);

  server.handle(agentRoutingRpc, ({ agentId }, { paseo }) => {
    router.attach(paseo);
    return router.describe(agentId);
  });

  return () => {
    clearInterval(timer);
    return unsubscribe();
  };
}
