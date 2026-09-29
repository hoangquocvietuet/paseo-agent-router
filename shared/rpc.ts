import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const statusRpc = defineRpc({
  name: "router.status",
  input: z.object({}),
  output: z.object({
    /** Handed to every omp session Paseo opens through `PI_CONFIG_FILES`. */
    overlayPath: z.string(),
    overlay: z.string(),
    generatedAt: z.string().nullable(),
    /** omp roles that point to a routed model and are rewritten while forcing. */
    forcedRoles: z.record(z.string(), z.string()),
    error: z.string().nullable(),
  }),
});
