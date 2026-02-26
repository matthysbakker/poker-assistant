/**
 * Equity buckets — classify hero equity vs villain range into action-driving tiers.
 *
 * Buckets drive both action selection and bet sizing when equity diverges from
 * the GTO table recommendation.
 */

import type { BoardTexture } from "../board-analyzer";

export type EquityBucket =
  | "dominating"   // >65%: value bet large
  | "ahead"        // 50-65%: value bet medium or check
  | "marginal"     // 40-50%: check or thin value
  | "drawing"      // 25-40%: call if odds met, bluff if fold equity
  | "behind";      // <25%: fold or bluff (river)

/** Classify a 0–1 equity value into an EquityBucket. */
export function classifyEquity(equity: number): EquityBucket {
  if (equity > 0.65) return "dominating";
  if (equity > 0.50) return "ahead";
  if (equity > 0.40) return "marginal";
  if (equity > 0.25) return "drawing";
  return "behind";
}

/**
 * Compute bet sizing fraction from equity bucket, board texture, street, and position.
 * Composes equity bucket with the wetness parabola.
 *
 * Returns 0 for check/fold spots.
 */
export function betSizingFromEquity(
  bucket: EquityBucket,
  board: BoardTexture,
  street: "flop" | "turn" | "river",
  position: "IP" | "OOP",
): number {
  // River sizing table
  if (street === "river") {
    switch (bucket) {
      case "dominating": return 0.75;
      case "ahead":      return 0.50;
      case "marginal":   return 0;
      case "drawing":    return 0;
      case "behind":     return 0.66; // bluff with blocker hands
    }
  }

  // Wet score drives sizing (wetness parabola)
  const ws = board.wetScore;

  switch (bucket) {
    case "dominating":
      if (ws === 0 || ws === 1) return 0.33;
      if (ws === 2) return 0.50;
      if (ws === 3) return 0.66;
      return 0.33; // ws4 = monotone
    case "ahead":
      if (ws <= 1) return 0.33;
      if (ws === 2) return 0.33;
      if (ws === 3) return 0.50;
      return 0.33;
    case "marginal":
      return 0; // check
    case "drawing":
      // Semi-bluff: IP bets, OOP checks (river semi-bluffs handled above)
      if (position === "OOP") return 0;
      if (ws <= 1) return 0.50;
      if (ws === 2) return 0.66;
      if (ws === 3) return 0.66;
      return 0.33;
    case "behind":
      return 0; // fold or check — no bet
  }
}
