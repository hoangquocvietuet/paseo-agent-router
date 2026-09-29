import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { PairSchema, RouteSchema, type Pair } from "./routes";

const DEFAULT_FALLBACK = { from: "openai-codex/*", to: ["opencode-go/deepseek-v4.1-flash"] };

/** v1 had one route list, applied as fallback, and a `force` switch that also applied it now. */
const SettingsV1Schema = z
  .object({
    autoFallback: z.boolean().optional(),
    force: z.boolean().optional(),
    routes: z.array(RouteSchema).optional(),
    usageReservePct: z.number().optional(),
  })
  .catch({});

export const routerSettings = defineSettings({
  id: "router",
  scope: "host",
  version: 2,
  schema: z.object({
    /**
     * Arm omp's own fallback for `fallbacks`: on 429/quota errors, and before a request when the
     * provider's usage report is below the reserve, omp moves to the next selector.
     */
    autoFallback: z.boolean().default(true),
    fallbacks: z.array(RouteSchema).default([DEFAULT_FALLBACK]),
    /** Remaining-quota percentage below which omp switches before sending a request. */
    usageReservePct: z.number().min(0).max(100).default(10),
    /** Switch-now pairs for every omp session, and for new omp agents. */
    pairs: z.array(PairSchema).default([]),
    /** Switch-now pairs for one session, keyed by agent id. They win over `pairs`. */
    sessionPairs: z.record(z.string(), z.array(PairSchema)).default({}),
  }),
  migrate(values, fromVersion) {
    if (fromVersion !== 1) return values;
    const v1 = SettingsV1Schema.parse(values);
    const routes = v1.routes ?? [DEFAULT_FALLBACK];
    return {
      autoFallback: v1.autoFallback ?? true,
      fallbacks: routes,
      usageReservePct: v1.usageReservePct ?? 10,
      pairs: v1.force ? routes.map((route) => ({ from: route.from, to: route.to[0] })) : [],
      sessionPairs: {},
    };
  },
});

/** Pairs in effect for one agent: its own first, then the global ones. */
export function effectivePairs(
  values: { pairs: readonly Pair[]; sessionPairs: Readonly<Record<string, readonly Pair[]>> },
  agentId: string | null,
): Pair[] {
  return [...((agentId && values.sessionPairs[agentId]) || []), ...values.pairs];
}
