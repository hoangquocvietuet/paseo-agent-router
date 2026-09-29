# paseo-agent-router

A [Paseo](https://paseo.sh) plugin that routes [omp](https://github.com/can1357/oh-my-pi) models from Paseo instead of omp's own config: fall back from an exhausted provider (for example Codex) to another model, or force the switch, for Paseo agents and the tasks/sub-agents omp spawns for them.

## How it works

The plugin writes an omp settings overlay (`$PASEO_HOME/plugin-data/agent-router/omp-overlay.yml`) and hands it to every omp session Paseo opens through `PI_CONFIG_FILES` (create, resume and refresh). Your `~/.omp/agent/config.yml` is never modified. omp reloads overlays before each task dispatch, so route changes reach the subagents of running sessions too.

- **Automatic fallback** (on by default) writes `retry.fallbackChains` for each route plus `retry.usageAwareFallback`: omp switches to the route's target when the model hits a quota or rate-limit error, and before a request when the provider's usage report is below the reserve.
- **Force routing now** (off by default):
  - new omp agents whose model matches a route are created on the route's target (with a thinking level the target supports); their tasks inherit it;
  - omp `modelRoles` that point to a routed model are rewritten to the target in the overlay.
- Sessions opened before the plugin was installed load the overlay when they reopen. A running session keeps its main model until it falls back or reopens.

Routes use omp's fallback-chain key syntax, one per line:

```text
openai-codex/* -> opencode-go/deepseek-v4.1-flash
anthropic/claude-opus-5 -> anthropic/claude-sonnet-5, opencode-go/deepseek-v4.1-flash
```

## UI

- Settings → Plugins → **Model routing**: automatic fallback, force switch, routes, usage reserve, and the current overlay.
- Command Center (⌘K): **Toggle forced model routing**, **Open model routing settings**.

## Install

Requires Paseo 0.9.2 or newer with **Settings → Plugins → Enable plugins**, and omp as a Paseo provider.

```bash
git clone https://github.com/hoangquocvietuet/paseo-agent-router.git
paseo plugin install "$PWD/paseo-agent-router"
```

Update with `git pull && paseo plugin reload agent-router`. Plugins are trusted, unsandboxed code.

## Develop

```bash
npm install
npm run typecheck
paseo plugin reload agent-router
paseo plugin logs agent-router
```
