# paseo-agent-router

A [Paseo](https://paseo.sh) plugin that routes [omp](https://github.com/can1357/oh-my-pi) models from Paseo instead of omp's own config: switch model A to model B for one session or for all of them, including the tasks and sub-agents omp spawns, and fall back from an exhausted provider (for example Codex) automatically.

## How it works

Every omp session Paseo opens (create, resume, refresh) gets its own omp settings overlay, `$PASEO_HOME/plugin-data/agent-router/overlays/<agentId>.yml`, through `PI_CONFIG_FILES`. Your `~/.omp/agent/config.yml` is never modified. omp reloads overlays before each task dispatch, so changes reach running sessions' tasks without restarting them.

**Model pairs (switch now).** A pair `A → B` applies to one session or to all sessions. Wherever omp would use A, the overlay makes it use B:

- omp `modelRoles` whose model is A;
- `task.agentModelOverrides` for every task agent whose first model resolves to A: its own `model`, a role alias expanded through `modelRoles`, or the parent session's model when it names none (project `.omp/agents`, then `~/.omp/agent/agents`, then omp's bundled `task`, `sonic`, `scout`, `reviewer`, `security-reviewer`);
- a fallback chain `A → B`;
- new omp agents created on A start on B (global pairs; with a thinking level B supports).

A session's own pairs win over global ones. A running session's **main** model cannot be switched by a plugin; the pill tells you when to switch it in the composer's model picker.

**Automatic fallback.** Fallback routes (default `openai-codex/* -> opencode-go/deepseek-v4.1-flash`) keep the model and let omp move on 429/quota errors, and before a request when the provider's usage report is below the reserve (`retry.usageAwareFallback`).

Selectors use omp's syntax: `provider/model-id`, or `provider/*` for every model of a provider.

## UI

- **Routes** pill above the composer of every omp session: the pairs list (pick A and B, choose *This session* or *All sessions*, add or remove pairs), the session's main model, and what is rerouted in it right now.
- Settings → Plugins → **Model routing**: pairs for all sessions, automatic fallback, fallback routes, usage reserve.
- Command Center (⌘K): **Open model routing settings**.

Sessions opened before the plugin was installed pick up their overlay when they reopen. Agents from omp extensions or Claude plugins and roles from a project's `.omp/config.yml` are not rewritten.

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
