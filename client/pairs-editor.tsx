import type { PluginTheme } from "@getpaseo/plugin";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ModelField } from "./model-field";

export type PairLevel = "session" | "global";

export interface PairRow {
  from: string;
  to: string;
  level: PairLevel;
}

const LEVEL_LABELS: Record<PairLevel, string> = {
  session: "This session",
  global: "All sessions",
};

/**
 * Editable "model A → model B" rows. With `levels`, each row also chooses whether it applies to
 * this session or to every session.
 */
export function PairsEditor({
  rows,
  models,
  theme,
  levels,
  saving,
  error,
  onSave,
}: {
  rows: readonly PairRow[];
  models: readonly string[];
  theme: PluginTheme;
  levels: boolean;
  saving: boolean;
  error: string | null;
  onSave(rows: PairRow[]): void;
}) {
  const [draft, setDraft] = useState<PairRow[]>(() => rows.map((row) => ({ ...row })));
  const update = (index: number, patch: Partial<PairRow>) =>
    setDraft((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const complete = draft.every((row) => row.from.trim() && row.to.trim());
  const dirty = JSON.stringify(draft) !== JSON.stringify(rows);

  const button = {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  };
  const text = { color: theme.colors.foreground, fontSize: 13 };

  return (
    <View style={{ gap: 8 }}>
      {draft.length === 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>No pairs yet.</Text>
      ) : null}
      {draft.map((row, index) => (
        <View key={index} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 6 }}>
          <ModelField
            value={row.from}
            onChange={(from) => update(index, { from })}
            models={models}
            placeholder="From (e.g. openai-codex/*)"
            theme={theme}
          />
          <Text style={{ ...text, paddingTop: 6 }}>→</Text>
          <ModelField
            value={row.to}
            onChange={(to) => update(index, { to })}
            models={models.filter((model) => !model.endsWith("/*"))}
            placeholder="To (provider/model)"
            theme={theme}
          />
          {levels ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Applies to ${LEVEL_LABELS[row.level]}; press to change`}
              style={button}
              onPress={() => update(index, { level: row.level === "session" ? "global" : "session" })}
            >
              <Text style={text}>{LEVEL_LABELS[row.level]}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove pair"
            style={button}
            onPress={() => setDraft((current) => current.filter((_, at) => at !== index))}
          >
            <Text style={text}>✕</Text>
          </Pressable>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Pressable
          accessibilityRole="button"
          style={button}
          onPress={() =>
            setDraft((current) => [...current, { from: "", to: "", level: levels ? "session" : "global" }])
          }
        >
          <Text style={text}>+ Add pair</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={saving || !dirty || !complete}
          style={{
            ...button,
            borderColor: theme.colors.accent,
            backgroundColor: theme.colors.accent,
            opacity: saving || !dirty || !complete ? 0.5 : 1,
          }}
          onPress={() => onSave(draft.map((row) => ({ ...row, from: row.from.trim(), to: row.to.trim() })))}
        >
          <Text style={{ color: theme.colors.accentForeground, fontSize: 13 }}>
            {saving ? "Saving..." : "Save"}
          </Text>
        </Pressable>
      </View>
      {error ? <Text style={{ color: theme.colors.statusDanger }}>{error}</Text> : null}
    </View>
  );
}
