import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

const SUGGESTION_LIMIT = 8;

/** omp model selectors, plus a `provider/*` entry per provider for "every model of it". */
export function useOmpModels(cwd: string | null): string[] {
  const paseo = usePaseo();
  const query = useQuery({
    queryKey: ["agent-router", "omp-models", cwd],
    queryFn: () => paseo.providers.listModels("omp", cwd ? { cwd } : undefined),
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(() => {
    const ids = (query.data?.models ?? []).map((model) => model.id);
    const providers = [...new Set(ids.map((id) => id.split("/")[0]))].map((provider) => `${provider}/*`);
    return [...providers.sort(), ...ids.sort()];
  }, [query.data]);
}

/** A model selector input that suggests known selectors as you type; free text is allowed. */
export function ModelField({
  value,
  onChange,
  models,
  placeholder,
  theme,
}: {
  value: string;
  onChange(value: string): void;
  models: readonly string[];
  placeholder: string;
  theme: PluginTheme;
}) {
  const [focused, setFocused] = useState(false);
  const suggestions = useMemo(() => {
    const needle = value.trim().toLowerCase();
    return models
      .filter((model) => model !== value && (!needle || model.toLowerCase().includes(needle)))
      .slice(0, SUGGESTION_LIMIT);
  }, [models, value]);

  return (
    <View style={{ flex: 1, minWidth: 140, gap: 4 }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        // Delay so a press on a suggestion lands before the list disappears.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          color: theme.colors.foreground,
          fontSize: 13,
          paddingVertical: 6,
          paddingHorizontal: 8,
          borderWidth: 1,
          borderRadius: 6,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
        }}
      />
      {focused && suggestions.length > 0 ? (
        <View
          style={{
            borderWidth: 1,
            borderRadius: 6,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface1,
          }}
        >
          {suggestions.map((model) => (
            <Pressable
              key={model}
              accessibilityRole="button"
              onPress={() => {
                onChange(model);
                setFocused(false);
              }}
              style={{ paddingVertical: 5, paddingHorizontal: 8 }}
            >
              <Text style={{ color: theme.colors.foreground, fontSize: 12 }} numberOfLines={1}>
                {model}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
