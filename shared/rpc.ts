import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** What routing does for one omp session right now. */
export const agentRoutingRpc = defineRpc({
  name: "router.agent",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({
    /** Handed to the session through `PI_CONFIG_FILES`; omp re-reads it before each task. */
    overlayPath: z.string(),
    overlay: z.string(),
    /** The session's main model. The plugin API cannot switch it; the composer model picker can. */
    model: z.string().nullable(),
    /** omp roles rewritten for this session: role → model. */
    roles: z.record(z.string(), z.string()),
    /** omp task agents rewritten for this session: agent name → model. */
    agents: z.record(z.string(), z.string()),
    error: z.string().nullable(),
  }),
});
