import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { RouteSchema } from "./routes";

export const routerSettings = defineSettings({
  id: "router",
  scope: "host",
  version: 1,
  schema: z.object({
    /**
     * Arm omp's own fallback: on 429/quota errors, and before a request when the provider's
     * usage report is below the reserve, omp switches to the route's target.
     */
    autoFallback: z.boolean().default(true),
    /** Use the target right away: new agents start on it and matching omp roles point to it. */
    force: z.boolean().default(false),
    routes: z
      .array(RouteSchema)
      .default([{ from: "openai-codex/*", to: ["opencode-go/deepseek-v4.1-flash"] }]),
    /** Remaining-quota percentage below which omp switches before sending a request. */
    usageReservePct: z.number().min(0).max(100).default(10),
  }),
});
