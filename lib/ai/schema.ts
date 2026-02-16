import { z } from "zod";

export const handAnalysisSchema = z.object({
  heroCards: z
    .string()
    .describe("Hero's hole cards, e.g. 'Ah Kd'"),
  communityCards: z
    .string()
    .describe("Community cards on the board, e.g. 'Qs Jc 10h'. Empty if preflop"),
  heroPosition: z
    .enum(["UTG", "MP", "CO", "BTN", "SB", "BB"])
    .describe("Hero's position at the table"),
  potSize: z
    .string()
    .describe("Current pot size, e.g. '120 BB' or '$24'"),
  heroStack: z
    .string()
    .describe("Hero's remaining stack, e.g. '95 BB' or '$190'"),
  street: z
    .enum(["PREFLOP", "FLOP", "TURN", "RIVER"])
    .describe("Current street / betting round"),
  action: z
    .enum(["FOLD", "CHECK", "CALL", "BET", "RAISE"])
    .describe("Recommended action"),
  amount: z
    .string()
    .optional()
    .describe("Bet/raise sizing if applicable, e.g. '2/3 pot' or '75 BB'"),
  confidence: z
    .enum(["HIGH", "MEDIUM", "LOW"])
    .describe("Confidence level of the recommendation"),
  reasoning: z
    .string()
    .describe("Step-by-step reasoning explaining the recommendation, written for beginners"),
  concept: z
    .string()
    .describe("The key poker concept at play, e.g. 'Pot Odds', 'Position Advantage', 'Semi-Bluff'"),
  tip: z
    .string()
    .describe("A practical beginner-friendly tip related to this situation"),
});

export type HandAnalysis = z.infer<typeof handAnalysisSchema>;
