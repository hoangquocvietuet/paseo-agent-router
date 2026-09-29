import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { RouterSettingsScreen } from "./client/settings-screen";
import { routerSettings } from "./shared/settings";

const settings = settingsRpc(routerSettings.id);

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: "router",
    title: "Model routing",
    icon: "Route",
    Component: RouterSettingsScreen,
  });
  client.addCommandCenterItem({
    id: "toggle-force",
    title: "Toggle forced model routing",
    icon: "Route",
    keywords: ["route", "model", "fallback", "codex", "deepseek", "force"],
    context: "global",
    async onSelect({ rpc, openSettings }) {
      const current = await rpc(settings.read, {});
      if (current.status !== "ready") {
        openSettings("router");
        return;
      }
      const values = routerSettings.schema.parse(current.values);
      await rpc(settings.write, { revision: current.revision, values: { ...values, force: !values.force } });
      openSettings("router");
    },
  });
  client.addCommandCenterItem({
    id: "open-settings",
    title: "Open model routing settings",
    icon: "Route",
    keywords: ["route", "model", "fallback"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("router");
    },
  });
  return () => {};
}
