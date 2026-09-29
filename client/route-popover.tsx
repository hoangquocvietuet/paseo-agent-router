import { useAgent, useRpc, useSettings } from "@getpaseo/plugin/client";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { switchTarget } from "../shared/routes";
import { agentRoutingRpc } from "../shared/rpc";
import { effectivePairs, routerSettings } from "../shared/settings";
import { useOmpModels } from "./model-field";
import { PairsEditor, type PairRow } from "./pairs-editor";

/** The composer pill's popover: this session's model pairs, and what they change right now. */
export function RoutePopover(props: PluginButtonContentProps) {
  if (props.context !== "agent") return null;
  return <SessionRoutes {...props} agentId={props.agentId} />;
}

function SessionRoutes({ agentId, theme }: PluginButtonContentProps & { agentId: string }) {
  const settings = useSettings(routerSettings);
  const agent = useAgent(agentId, (snapshot) => ({ model: snapshot.model, cwd: snapshot.cwd }));
  const models = useOmpModels(agent?.cwd ?? null);
  const routing = useRpc(agentRoutingRpc);
  const queryClient = useQueryClient();
  const statusKey = ["agent-router", "agent", agentId];
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => routing({ agentId }),
    enabled: settings.status === "ready",
  });

  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };
  const heading = { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const };

  if (settings.status === "loading") return <Text style={muted}>Loading...</Text>;
  if (settings.status !== "ready") {
    return <Text style={{ color: theme.colors.statusDanger }}>{settings.error}</Text>;
  }

  const values = settings.values;
  const rows: PairRow[] = [
    ...(values.sessionPairs[agentId] ?? []).map((pair) => ({ ...pair, level: "session" as const })),
    ...values.pairs.map((pair) => ({ ...pair, level: "global" as const })),
  ];
  const save = async (next: PairRow[]) => {
    const session = next.filter((row) => row.level === "session").map(({ from, to }) => ({ from, to }));
    const sessionPairs = { ...values.sessionPairs };
    if (session.length > 0) sessionPairs[agentId] = session;
    else delete sessionPairs[agentId];
    const pairs = next.filter((row) => row.level === "global").map(({ from, to }) => ({ from, to }));
    if (await settings.save({ ...values, pairs, sessionPairs }, settings.revision)) {
      await queryClient.invalidateQueries({ queryKey: statusKey });
    }
  };

  const mainModel = agent?.model ?? status.data?.model ?? null;
  const mainTarget = mainModel ? switchTarget(mainModel, effectivePairs(values, agentId)) : undefined;
  const rewritten = status.data
    ? [
        ...Object.entries(status.data.roles).map(([role, model]) => `@${role} → ${model}`),
        ...Object.entries(status.data.agents).map(([name, model]) => `${name} → ${model}`),
      ]
    : [];

  return (
    <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 12, padding: 4, minWidth: 320 }}>
      <View style={{ gap: 4 }}>
        <Text style={heading}>Model routes</Text>
        <Text style={muted}>
          Wherever omp would use the left model, it uses the right one. Tasks and sub-agents follow
          at their next dispatch.
        </Text>
      </View>
      {/* Remount after a save so the draft starts from the stored pairs. */}
      <PairsEditor
        key={settings.revision}
        rows={rows}
        models={models}
        theme={theme}
        levels
        saving={settings.saving}
        error={settings.saveError}
        onSave={(next) => void save(next)}
      />
      <View style={{ gap: 4 }}>
        <Text style={heading}>In this session</Text>
        <Text style={muted}>Main model: {mainModel ?? "unknown"}</Text>
        {mainTarget ? (
          <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
            Switch the main model to {mainTarget} in the composer's model picker; plugins cannot
            change a running session's model.
          </Text>
        ) : null}
        {status.isError ? (
          <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{String(status.error)}</Text>
        ) : null}
        {status.data ? (
          <Text style={muted}>
            {rewritten.length > 0 ? `Rerouted: ${rewritten.join(", ")}` : "Nothing rerouted."}
          </Text>
        ) : null}
        {status.data?.error ? (
          <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>{status.data.error}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
