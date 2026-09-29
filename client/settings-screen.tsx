import { useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Platform, Text } from "react-native";
import { formatRoutes, parseRoutes } from "../shared/routes";
import { routerSettings } from "../shared/settings";
import { useOmpModels } from "./model-field";
import { PairsEditor } from "./pairs-editor";

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
  const models = useOmpModels(null);
  const [fallbackDraft, setFallbackDraft] = useState(formatRoutes(values.fallbacks));
  const [reserveDraft, setReserveDraft] = useState(String(values.usageReservePct));
  const parsed = parseRoutes(fallbackDraft);
  const reserve = Number(reserveDraft);
  const reserveError = Number.isFinite(reserve) && reserve >= 0 && reserve <= 100 ? null : "0 to 100";
  const dirty =
    formatRoutes(parsed.routes) !== formatRoutes(values.fallbacks) || reserve !== values.usageReservePct;
  const save = (patch: Partial<typeof values>) => void settings.save({ ...values, ...patch }, settings.revision);
  const sessionsWithPairs = Object.keys(values.sessionPairs).length;
  const muted = { color: theme.colors.foregroundMuted };

  return (
    <>
      <SettingsSection title="Model pairs for all sessions">
        <SettingsCard>
          <Text style={muted}>
            Wherever omp would use the left model, it uses the right one: omp roles, task and
            sub-agent models, and new omp agents. Each omp session also has a Routes pill above its
            composer for pairs that apply to that session only
            {sessionsWithPairs > 0 ? ` (${sessionsWithPairs} session(s) have their own)` : ""}.
          </Text>
          <PairsEditor
            rows={values.pairs.map((pair) => ({ ...pair, level: "global" as const }))}
            models={models}
            theme={theme}
            levels={false}
            saving={settings.saving}
            error={settings.saveError}
            onSave={(rows) => save({ pairs: rows.map(({ from, to }) => ({ from, to })) })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Automatic fallback">
        <SettingsCard>
          <SettingsSwitch
            label="Automatic fallback"
            hint="omp keeps the left model and moves to the right one on quota or rate-limit errors, and before a request when usage is below the reserve."
            value={values.autoFallback}
            disabled={settings.saving}
            onValueChange={(autoFallback) => save({ autoFallback })}
          />
          <SettingsRow
            label="Fallback routes"
            hint="One per line: provider/* or provider/model -> target[, next target]"
            error={parsed.error}
          >
            <TextInput
              value={fallbackDraft}
              onChangeText={setFallbackDraft}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                fontFamily: MONOSPACE,
                fontSize: 12,
                color: theme.colors.foreground,
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
            label="Save fallback routes"
            actionLabel={settings.saving ? "Saving..." : "Save"}
            disabled={settings.saving || !dirty || parsed.error !== null || reserveError !== null}
            error={settings.saveError}
            onPress={() => save({ fallbacks: parsed.routes, usageReservePct: reserve })}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
