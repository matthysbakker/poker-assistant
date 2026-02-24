export type PokerAction = "FOLD" | "CHECK" | "CALL" | "BET" | "RAISE";
export type Street = "PREFLOP" | "FLOP" | "TURN" | "RIVER";
export type { Position } from "@/lib/card-detection/types";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface LocalDecision {
  action: PokerAction;
  /** Recommended bet/raise amount in €, or null = use default sizing */
  amount: number | null;
  /** 0.0–1.0; below threshold → fall through to Claude */
  confidence: number;
  /** Human-readable explanation for console logging */
  reasoning: string;
}

export const ACTION_COLORS: Record<PokerAction, string> = {
  FOLD: "bg-red-500",
  CHECK: "bg-yellow-500",
  CALL: "bg-yellow-500",
  BET: "bg-green-500",
  RAISE: "bg-emerald-600",
};
