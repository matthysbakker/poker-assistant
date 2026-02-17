import { z } from "zod";

export const PLAYER_TYPES = [
  "TIGHT_PASSIVE",
  "TIGHT_AGGRESSIVE",
  "LOOSE_PASSIVE",
  "LOOSE_AGGRESSIVE",
  "UNKNOWN",
] as const;

export type PlayerType = (typeof PLAYER_TYPES)[number];

const opponentSchema = z.object({
  seat: z.number().describe("Seat number (1-9)"),
  username: z
    .string()
    .optional()
    .describe("Player username if visible"),
  position: z
    .enum(["UTG", "MP", "CO", "BTN", "SB", "BB"])
    .optional()
    .describe("Player's position at the table"),
  stack: z
    .string()
    .describe("Stack size, e.g. '95 BB' or '$190'"),
  currentAction: z
    .string()
    .optional()
    .describe("Action this hand if visible, e.g. 'RAISE 3BB', 'FOLD'"),
  playerType: z
    .enum(PLAYER_TYPES)
    .describe("Inferred player type based on visible information"),
  notes: z
    .string()
    .optional()
    .describe("Brief read on this player based on visible clues"),
});

export type Opponent = z.infer<typeof opponentSchema>;

export const handAnalysisSchema = z.object({
  cardReadingNotes: z
    .string()
    .describe(
      "If detected cards were provided: confirm them and note any additional observations from the image. " +
      "If no detected cards: describe exactly what you see on each card — " +
      "rank symbol/letter in the corner, SHAPE of the suit symbol (pointed leaf = spade, three lobes = club, heart shape, rhombus = diamond). " +
      "Note if a rank could be 6 or 9 (check orientation)."
    ),
  heroCards: z
    .string()
    .describe("Hero's hole cards based on your card reading notes above, e.g. 'Ah Kd'"),
  communityCards: z
    .string()
    .describe("Community cards based on your card reading notes above, e.g. 'Qs Jc 10h'. Empty if preflop"),
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
  opponents: z
    .array(opponentSchema)
    .describe("All visible opponents at the table"),
  exploitAnalysis: z
    .string()
    .describe("How the recommendation exploits specific opponent tendencies at this table"),
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
