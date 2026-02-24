/**
 * Dirty outs discount.
 *
 * "Dirty outs" are outs that technically complete your draw but also improve
 * your opponent's hand (e.g. a flush draw card pairs the board and gives
 * opponents a full house).
 *
 * This module applies a conservative discount to raw out counts when the
 * board conditions suggest dirty outs are likely.
 */

import type { HandTier } from "../hand-evaluator";

interface DirtyOutsInput {
  flushOuts: number;
  straightOuts: number;
  boardPaired: boolean;
  opponentTier?: HandTier;  // estimated opponent strength (from session data)
  activePlayers: number;    // heads-up vs multiway
}

/**
 * Apply dirty-out discount and return adjusted out count.
 *
 * Rule of thumb:
 * - Paired board: flush outs discounted by ~20% (full house outs)
 * - Multiway (3+): additional -15% (more opponents = more likely to be dominated)
 * - If opponent is estimated at strong+ tier: additional -10%
 */
export function applyDirtyOutsDiscount(input: DirtyOutsInput): number {
  let { flushOuts, straightOuts } = input;

  // Paired board discounts flush outs (board pair can make a full house, beating flush)
  if (input.boardPaired && flushOuts === 9) {
    flushOuts = Math.round(flushOuts * 0.8);
  }

  // Multiway penalty (each extra player beyond 2 reduces effective outs by 15%)
  const extraPlayers = Math.max(0, input.activePlayers - 2);
  const multipwayFactor = Math.max(0.5, 1 - extraPlayers * 0.15);

  // Strong opponent penalty
  const opponentPenalty = (input.opponentTier === "nut" || input.opponentTier === "strong") ? 0.9 : 1.0;

  const adjustedOuts = (flushOuts + straightOuts) * multipwayFactor * opponentPenalty;
  return Math.max(0, Math.round(adjustedOuts));
}
