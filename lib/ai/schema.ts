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
      "Hero's hole cards. If 'Detected cards: ...' was provided: copy ONLY those detected cards exactly — " +
      "do NOT add cards you can see in the image that were not listed in the detection. " +
      "If a card is missing from detection, write '??' as placeholder, e.g. 'Qc ??'. " +
      "Only read fully from the image if no detection was provided at all. Format: e.g. 'Ah Kd'"
    ),
  communityCards: z
    .string()
    .describe(
      "Community cards. If 'Detected cards: ...' was provided: copy ONLY those detected community cards exactly — " +
      "do NOT add cards you can see in the image that were not listed in the detection. " +
      "Only read fully from the image if no detection was provided at all. " +
      "Format: e.g. 'Qs Jc Th'. Empty string if preflop."
    ),
  heroPosition: z
    .enum(["UTG", "MP", "CO", "BTN", "SB", "BB"])
    .describe(
      "Hero's position at the table. If 'Hero position: ...' was provided in detected cards, use it exactly as ground truth. " +
      "Otherwise, find the dealer button chip (small circle marked 'D') — that player is BTN. " +
      "Count clockwise: SB, BB, UTG, MP, CO. Do NOT assume hero is BB because they are at the bottom of the screen."
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
  boardTexture: z
    .string()
    .optional()
    .describe(
      "Board texture summary for post-flop streets (e.g., 'Paired monotone', 'Rainbow dry board', 'Two-tone connected'). " +
      "Omit for PREFLOP.",
    ),
  draws: z
    .string()
    .optional()
    .describe(
      "Hero's active draws on post-flop streets: flush draws (9 outs), open-ended straight draws (8), " +
      "gutshots (4), combo draws (12-15). Example: 'Nut flush draw + OESD = 15 outs'. " +
      "Omit if no relevant draws or PREFLOP.",
    ),
  equityEstimate: z
    .string()
    .optional()
    .describe(
      "Hero's estimated equity vs opponent's likely range on this post-flop street. " +
      "Example: '~65% vs likely top-pair range'. Omit for PREFLOP or if highly uncertain.",
    ),
  spr: z
    .string()
    .optional()
    .describe(
      "Stack-to-pot ratio (SPR) for post-flop streets: effective stack divided by pot size. " +
      "Low SPR (<4) = committed; medium SPR (4-12) = proceed with care; high SPR (>12) = no commitment yet. " +
      "Example: 'SPR 4.2 — medium commitment, set/two-pair are committed'. Omit for PREFLOP.",
    ),
  potOdds: z
    .string()
    .optional()
    .describe(
      "Pot odds if hero is facing a bet on a post-flop street. " +
      "Format: 'Getting 2.5:1, need 29% equity to call profitably'. " +
      "Omit if hero is not facing a bet or PREFLOP.",
    ),
  facingAction: z
    .string()
    .optional()
    .describe(
      "The action hero is currently facing on a post-flop street " +
      "(e.g., 'Facing a 2/3-pot c-bet', 'Facing a check-raise to 6x', 'First to act — no bet facing'). " +
      "Omit for PREFLOP.",
    ),
  concept: z
    .string()
    .optional()
    .describe("The key poker concept at play, e.g. 'Pot Odds', 'Position Advantage', 'Semi-Bluff'. Keep to 2-4 words. Always include."),
  tip: z
    .string()
    .optional()
    .describe("A practical beginner-friendly tip related to this situation. Omit in continuous/fast mode."),
});

export type HandAnalysis = z.infer<typeof handAnalysisSchema>;
