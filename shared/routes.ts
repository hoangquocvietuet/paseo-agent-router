import { z } from "zod";

/**
 * `from` uses omp's fallback-chain key syntax: an exact `provider/model-id` or `provider/*` for
 * every model of a provider. `to` is the ordered list of replacement selectors.
 */
export const RouteSchema = z.object({
  from: z.string().trim().min(1),
  to: z.array(z.string().trim().min(1)).min(1),
});
export type Route = z.infer<typeof RouteSchema>;

/** Model selectors may carry a thinking suffix (`provider/model:high`); routing ignores it. */
export function matchesRoute(model: string, from: string): boolean {
  const bare = model.split(":")[0];
  return from.endsWith("/*") ? bare.startsWith(from.slice(0, -1)) : bare === from;
}

export function findRoute(model: string, routes: readonly Route[]): Route | undefined {
  return routes.find((route) => matchesRoute(model, route.from));
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
