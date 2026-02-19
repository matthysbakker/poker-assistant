export type PokerAction = "FOLD" | "CHECK" | "CALL" | "BET" | "RAISE";
export type Street = "PREFLOP" | "FLOP" | "TURN" | "RIVER";
export type { Position } from "@/lib/card-detection/types";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export const ACTION_COLORS: Record<PokerAction, string> = {
  FOLD: "bg-red-500",
  CHECK: "bg-yellow-500",
  CALL: "bg-yellow-500",
  BET: "bg-green-500",
  RAISE: "bg-emerald-600",
};
