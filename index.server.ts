import type { PluginServerContext } from "@getpaseo/plugin/server";
import { defaultOverlayPath, Router } from "./server/router";
import { statusRpc } from "./shared/rpc";
import { routerSettings } from "./shared/settings";

const OMP_PROVIDER = "omp";
/** omp roles can change outside Paseo (`/model`, `omp config set`). */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(routerSettings);
  const router = new Router(settings, defaultOverlayPath());
  const regenerate = () =>
    router.regenerate().catch((error) => console.error("Could not write omp overlay", error));

  void regenerate();
  const unsubscribe = settings.subscribe(() => regenerate());
  const timer = setInterval(regenerate, REFRESH_INTERVAL_MS);

  // Every omp session Paseo opens (create, resume, refresh) loads the routing overlay.
  server.before("agent.session_open", ({ request }) => {
    if (request.provider !== OMP_PROVIDER || !router.isReady()) return;
    return { ...request, env: router.sessionEnv(request.env) };
  });

  // While forcing, new omp agents start on the route's target; their tasks inherit it.
  server.before("agent.create", async ({ request }, { paseo }) => {
    const { config } = request;
    if (config.provider !== OMP_PROVIDER || !config.model) return;
    const forced = await router.forcedModel(paseo, config.model, config.thinkingOptionId, config.cwd);
    if (!forced) return;
    console.log(`Routing new agent from ${config.model} to ${forced.model}`);
    return { ...request, config: { ...config, ...forced } };
  });

  server.handle(statusRpc, async () => {
    await router.regenerate();
    return router.status();
  });

  return () => {
    clearInterval(timer);
    return unsubscribe();
  };
}
