import type { DetectionResult } from "@/lib/card-detection/types";

export type Street = "WAITING" | "PREFLOP" | "FLOP" | "TURN" | "RIVER";

export interface StreetSnapshot {
  street: Street;
  heroCards: string[];
  communityCards: string[];
  timestamp: number;
}

export interface HandState {
  /** Current street in the hand. */
  street: Street;
  /** Unique ID for the current hand (null when WAITING). */
  handId: string | null;
  /** Detected hero cards (card codes). */
  heroCards: string[];
  /** Detected community cards (card codes). */
  communityCards: string[];
  /** Whether hero's action buttons are visible. */
  heroTurn: boolean;
  /** Accumulated snapshots per street for context. */
  streets: StreetSnapshot[];
  /** Consecutive frames at the current detected card count (for hysteresis). */
  frameCount: number;
  /** Pending detection that the hysteresis is waiting to confirm. */
  pendingStreet: Street | null;
  /** Whether Claude analysis should be triggered. */
  shouldAnalyze: boolean;
  /** Whether a Claude request is currently in flight. */
  analyzing: boolean;
}

export type HandAction =
  | { type: "DETECTION"; detection: DetectionResult }
  | { type: "ANALYSIS_STARTED" }
  | { type: "ANALYSIS_COMPLETE" }
  | { type: "RESET" };
