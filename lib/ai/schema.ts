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
      "If detected cards were provided: repeat the detected cards exactly as given — they are ground truth. " +
      "Only describe what you see for any cards marked [unreadable]. " +
      "If no detected cards were provided: describe exactly what you see on each card — " +
      "rank symbol/letter in the corner, SHAPE of the suit symbol. " +
      "6 vs 9: the round belly of a 6 is at the BOTTOM, a 9 at the TOP. Do NOT default to 9 — check carefully."
    ),
  heroCards: z
    .string()
    .describe(
      "Hero's hole cards. If detected cards were provided, use them exactly. " +
      "Only read from the image if no detection was provided. Format: e.g. 'Ah Kd'"
    ),
  communityCards: z
    .string()
    .describe(
      "Community cards. If detected cards were provided, use them exactly. " +
      "Only read from the image if no detection was provided. Format: e.g. 'Qs Jc Th'. Empty string if preflop"
    ),
  heroPosition: z
    .enum(["UTG", "MP", "CO", "BTN", "SB", "BB"])
    .describe(
      "Hero's position at the table. CRITICAL: Do NOT assume hero is BB because they are at the bottom of the screen. " +
      "Find the dealer button chip (small circle marked 'D') placed next to a player — that player is BTN. " +
      "Count clockwise from BTN: next is SB, then BB, then UTG, MP, CO. " +
      "Also check posted blind bets (small/big amounts) to confirm SB and BB seats."
    ),
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
    .optional()
    .describe("The key poker concept at play, e.g. 'Pot Odds', 'Position Advantage', 'Semi-Bluff'. Omit in continuous/fast mode."),
  tip: z
    .string()
    .optional()
    .describe("A practical beginner-friendly tip related to this situation. Omit in continuous/fast mode."),
});

export type HandAnalysis = z.infer<typeof handAnalysisSchema>;
