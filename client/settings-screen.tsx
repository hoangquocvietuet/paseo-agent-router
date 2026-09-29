import { useRpc, useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Platform, Text } from "react-native";
import { formatRoutes, parseRoutes } from "../shared/routes";
import { statusRpc } from "../shared/rpc";
import { routerSettings } from "../shared/settings";

type Theme = PluginSurfaceProps["theme"];
type ReadySettings = Extract<SettingsState<typeof routerSettings.schema>, { status: "ready" }>;

const MONOSPACE = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

export function RouterSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(routerSettings);
  if (settings.status === "loading") {
    return <Text style={{ color: theme.colors.foregroundMuted }}>Loading...</Text>;
  }
  if (settings.status !== "ready") {
    return <Text style={{ color: theme.colors.statusDanger }}>{settings.error}</Text>;
  }
  // Remount on saves so drafts start from the stored values.
  return <RouterControls key={settings.revision} settings={settings} theme={theme} />;
}

function RouterControls({ settings, theme }: { settings: ReadySettings; theme: Theme }) {
  const values = settings.values;
  const [routesDraft, setRoutesDraft] = useState(formatRoutes(values.routes));
  const [reserveDraft, setReserveDraft] = useState(String(values.usageReservePct));
  const parsed = parseRoutes(routesDraft);
  const reserve = Number(reserveDraft);
  const reserveError = Number.isFinite(reserve) && reserve >= 0 && reserve <= 100 ? null : "0 to 100";
  const dirty =
    formatRoutes(parsed.routes) !== formatRoutes(values.routes) || reserve !== values.usageReservePct;
  const save = (patch: Partial<typeof values>) => void settings.save({ ...values, ...patch }, settings.revision);

  const status = useRpc(statusRpc);
  const statusQuery = useQuery({
    queryKey: ["agent-router", "status", settings.revision],
    queryFn: () => status({}),
  });

  const mono = { fontFamily: MONOSPACE, fontSize: 12, color: theme.colors.foreground };
  const muted = { color: theme.colors.foregroundMuted };

  return (
    <>
      <SettingsSection title="Model routing">
        <SettingsCard>
          <SettingsSwitch
            label="Automatic fallback"
            hint="omp switches to the route's target on quota or rate-limit errors, and before a request when usage is below the reserve."
            value={values.autoFallback}
            disabled={settings.saving}
            onValueChange={(autoFallback) => save({ autoFallback })}
          />
          <SettingsSwitch
            label="Force routing now"
            hint="New omp agents start on the target, and omp roles pointing to a routed model use the target. Sessions already running keep their main model until they reopen."
            value={values.force}
            disabled={settings.saving}
            onValueChange={(force) => save({ force })}
          />
          <SettingsRow
            label="Routes"
            hint="One per line: provider/* or provider/model -> target[, next fallback]"
            error={parsed.error}
          >
            <TextInput
              value={routesDraft}
              onChangeText={setRoutesDraft}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                ...mono,
                minHeight: 72,
                padding: 8,
                borderWidth: 1,
                borderRadius: 6,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface2,
              }}
            />
          </SettingsRow>
          <SettingsInput
            label="Usage reserve (%)"
            hint="Switch before sending when the provider reports less remaining quota than this."
            initialValue={reserveDraft}
            onChangeText={setReserveDraft}
            error={reserveError}
          />
          <SettingsAction
            label="Save routes"
            actionLabel={settings.saving ? "Saving..." : "Save"}
            disabled={settings.saving || !dirty || parsed.error !== null || reserveError !== null}
            error={settings.saveError}
            onPress={() => save({ routes: parsed.routes, usageReservePct: reserve })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="omp overlay">
        <SettingsCard>
          {statusQuery.isError ? (
            <Text style={{ color: theme.colors.statusDanger }}>{String(statusQuery.error)}</Text>
          ) : null}
          {statusQuery.data ? (
            <>
              <Text style={muted}>
                Loaded by every omp session Paseo opens (PI_CONFIG_FILES). Sessions opened before
                this plugin was installed pick it up when they reopen.
              </Text>
              <Text selectable style={mono}>
                {statusQuery.data.overlayPath}
              </Text>
              {Object.keys(statusQuery.data.forcedRoles).length > 0 ? (
                <Text style={muted}>
                  Forced roles:{" "}
                  {Object.entries(statusQuery.data.forcedRoles)
                    .map(([role, model]) => `${role} → ${model}`)
                    .join(", ")}
                </Text>
              ) : null}
              {statusQuery.data.error ? (
                <Text style={{ color: theme.colors.statusWarning }}>{statusQuery.data.error}</Text>
              ) : null}
              <Text selectable style={mono}>
                {statusQuery.data.overlay || "(not written yet)"}
              </Text>
            </>
          ) : null}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
