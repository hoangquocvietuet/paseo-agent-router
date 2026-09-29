import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerRoutePills } from "./client/pills";
import { RouterSettingsScreen } from "./client/settings-screen";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: "router",
    title: "Model routing",
    icon: "Route",
    Component: RouterSettingsScreen,
  });
  client.addCommandCenterItem({
    id: "open-settings",
    title: "Open model routing settings",
    icon: "Route",
    keywords: ["route", "model", "fallback", "switch", "codex", "deepseek"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("router");
    },
  });
  return registerRoutePills(client);
}
