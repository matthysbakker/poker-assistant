import { z } from "zod";

export const autopilotActionSchema = z.object({
  action: z
    .enum(["FOLD", "CHECK", "CALL", "RAISE", "BET"])
    .describe("The action to take"),
  amount: z
    .number()
    .nullable()
    .describe(
      "Bet/raise amount in euros (e.g. 0.15). Null for fold/check/call.",
    ),
  reasoning: z
    .string()
    .describe("Brief reasoning for the action (1-2 sentences)"),
});

export type AutopilotAction = z.infer<typeof autopilotActionSchema>;
