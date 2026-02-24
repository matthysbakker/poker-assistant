import type { CardCode, Position } from "@/lib/card-detection/types";
import type { DetectionResult } from "@/lib/card-detection/types";
import type { HandAnalysis } from "@/lib/ai/schema";
import type { TableTemperature } from "@/lib/poker/table-temperature";

export type HandPhase = "WAITING" | "PREFLOP" | "FLOP" | "TURN" | "RIVER";

export interface StreetSnapshot {
  street: HandPhase;
  heroCards: CardCode[];
  communityCards: CardCode[];
  /** Claude's completed analysis for this street, stored after streaming finishes. */
  analysis?: HandAnalysis;
}

export interface HandState {
  /** Current street in the hand. */
  street: HandPhase;
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
  pendingStreet: HandPhase | null;
  /** Incremented each time Claude analysis should be triggered. */
  analyzeGeneration: number;
  /** Whether a Claude request is currently in flight. */
  analyzing: boolean;
  /** Hero's position at the table (locked on first detection within a hand). */
  heroPosition: Position | null;
  /** Unique ID for this poker hand — groups all streets together. Generated at WAITING→PREFLOP. */
  pokerHandId: string | null;
}

export type HandAction =
  | { type: "DETECTION"; detection: DetectionResult }
  | { type: "ANALYSIS_STARTED" }
  | { type: "ANALYSIS_COMPLETE"; analysis?: HandAnalysis }
  | { type: "RESET" };

export interface CaptureContext {
  sessionId: string;
  pokerHandId: string | null;
  tableTemperature: TableTemperature | null;
  tableReads: number | null;
  /** Hero's table position at the moment the capture was triggered. */
  heroPosition: Position | null;
  personaSelected: {
    personaId: string;
    personaName: string;
    action: string;
    temperature: TableTemperature | null;
  } | null;
}
