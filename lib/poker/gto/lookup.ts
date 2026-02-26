/**
 * GTO Lookup — query the pre-populated GTO table for a given spot.
 */

import type { BoardTexture } from "../board-analyzer";
import type { HandEvaluation } from "../hand-evaluator";
import { buildGtoKey, deriveIpOop } from "./key";
import { GTO_TABLE } from "./tables";
import type { GtoTableLookupResult } from "./types";

/**
 * Look up the GTO-recommended action for the current spot.
 *
 * @param position       Hero's position string (e.g. "BTN", "BB", "SB")
 * @param board          BoardTexture from analyzeBoard()
 * @param hand           HandEvaluation from evaluateHand()
 * @param facingBet      Whether hero is facing a bet/raise
 * @returns              Hit with entry, or miss
 */
export function lookupGtoSpot(
  position: string,
  board: BoardTexture,
  hand: HandEvaluation,
  facingBet: boolean,
): GtoTableLookupResult {
  if (board.street === "preflop") return { hit: false };

  const ipOop = deriveIpOop(position);
  const key = buildGtoKey(ipOop, board, hand.tier, facingBet);

  const entry = GTO_TABLE.get(key);
  if (!entry) return { hit: false };

  return { hit: true, entry };
}
