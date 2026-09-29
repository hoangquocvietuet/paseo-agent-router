import { z } from "zod";

/**
 * Selectors follow omp's fallback-chain key syntax: an exact `provider/model-id`, or
 * `provider/*` for every model of a provider.
 */
const SelectorSchema = z.string().trim().min(1);

/** Fallback only: keep `from`, move to `to` (in order) when `from` hits quota or rate limits. */
export const RouteSchema = z.object({
  from: SelectorSchema,
  to: z.array(SelectorSchema).min(1),
});
export type Route = z.infer<typeof RouteSchema>;

/** Switch now: wherever omp would use `from`, use `to` instead. */
export const PairSchema = z.object({ from: SelectorSchema, to: SelectorSchema });
export type Pair = z.infer<typeof PairSchema>;

/** Model selectors may carry a thinking suffix (`provider/model:high`); matching ignores it. */
export function matchesSelector(model: string, from: string): boolean {
  const bare = model.split(":")[0];
  return from.endsWith("/*") ? bare.startsWith(from.slice(0, -1)) : bare === from;
}

/** First matching pair wins, so session pairs listed before global pairs override them. */
export function switchTarget(model: string, pairs: readonly Pair[]): string | undefined {
  return pairs.find((pair) => matchesSelector(model, pair.from))?.to;
}

/** One route per line: `from -> to[, fallback…]`. Blank lines and `#` comments are ignored. */
export function parseRoutes(text: string): { routes: Route[]; error: string | null } {
  const routes: Route[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const [from, to, extra] = line.split("->");
    const parsed = RouteSchema.safeParse({
      from: from ?? "",
      to: (to ?? "").split(",").map((selector) => selector.trim()).filter(Boolean),
    });
    if (extra !== undefined || !parsed.success) {
      return { routes, error: `Line ${index + 1}: expected "provider/* -> provider/model[, …]"` };
    }
    routes.push(parsed.data);
  }
  return { routes, error: null };
}

export function formatRoutes(routes: readonly Route[]): string {
  return routes.map((route) => `${route.from} -> ${route.to.join(", ")}`).join("\n");
}
