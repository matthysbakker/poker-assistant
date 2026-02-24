/**
 * Hand-strength / equity mismatch detection.
 *
 * Detects when a hero's made hand has lower equity than a draw suggests,
 * indicating either a dominated hand or a situation requiring caution.
 */

import type { HandTier } from "../hand-evaluator";

export interface StrengthMismatch {
  dominated: boolean;
  reason: string;
}

/**
 * Detect if the hero is likely dominated (e.g. top pair vs flush draw on
 * a wet board where opponent range crushes the hero's made hand).
 *
 * This is a conservative heuristic — when in doubt, flag as potential mismatch
 * and let the confidence system fall back to Claude.
 */
export function detectStrengthEquityMismatch(
  heroTier: HandTier,
  boardWet: boolean,
  activePlayers: number,
  facingBet: boolean,
): StrengthMismatch {
  // Weak hands facing a bet on wet boards are likely dominated
  if (heroTier === "weak" && boardWet && facingBet) {
    return { dominated: true, reason: "Weak hand facing bet on wet board" };
  }

  // Medium pair in multiway pot is often dominated
  if ((heroTier === "medium" || heroTier === "weak") && activePlayers >= 3 && facingBet) {
    return { dominated: true, reason: "Medium/weak hand in multiway pot facing bet" };
  }

  // Top pair on very wet board facing a check-raise (unusual aggression)
  if (heroTier === "top_pair_gk" && boardWet && activePlayers >= 2 && facingBet) {
    return { dominated: true, reason: "TPTK facing pressure on wet board — range uncertainty" };
  }

  return { dominated: false, reason: "" };
}
