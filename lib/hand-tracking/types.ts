import type { CardCode } from "@/lib/card-detection/types";
import type { DetectionResult } from "@/lib/card-detection/types";

export type Street = "WAITING" | "PREFLOP" | "FLOP" | "TURN" | "RIVER";

export interface StreetSnapshot {
  street: Street;
  heroCards: CardCode[];
  communityCards: CardCode[];
  timestamp: number;
}

export interface HandState {
  /** Current street in the hand. */
  street: Street;
  /** Unique ID for the current hand (null when WAITING). */
  handId: string | null;
  /** Detected hero cards (card codes). */
  heroCards: CardCode[];
  /** Detected community cards (card codes). */
  communityCards: CardCode[];
  /** Whether hero's action buttons are visible. */
  heroTurn: boolean;
  /** Accumulated snapshots per street for context. */
  streets: StreetSnapshot[];
  /** Consecutive frames at the current detected card count (for hysteresis). */
  frameCount: number;
  /** Pending detection that the hysteresis is waiting to confirm. */
  pendingStreet: Street | null;
  /** Incremented each time Claude analysis should be triggered. */
  analyzeGeneration: number;
  /** Whether a Claude request is currently in flight. */
  analyzing: boolean;
}

export type HandAction =
  | { type: "DETECTION"; detection: DetectionResult }
  | { type: "ANALYSIS_STARTED" }
  | { type: "ANALYSIS_COMPLETE" }
  | { type: "RESET" };
