/**
 * GTO key serialization.
 *
 * Key format: `"${posIp}_${street}_ws${wetScore}${paired}_${handTier}_${facingBet}"`
 *
 * Examples:
 *   "IP_flop_ws0_top_pair_gk_nobet"
 *   "OOP_turn_ws2_draw_bet"
 *   "IP_river_ws0p_nut_nobet"  (p suffix = paired board)
 */

import type { BoardTexture } from "../board-analyzer";
import type { HandTier } from "../hand-evaluator";

/** IP = In Position (last to act post-flop), OOP = Out of Position */
export type IpOop = "IP" | "OOP";

/**
 * Derive IP/OOP from hero's position string.
 * BTN and CO are in position vs blinds; all others are OOP vs BTN/CO.
 */
export function deriveIpOop(position: string): IpOop {
  const upper = position.toUpperCase();
  return upper === "BTN" || upper === "CO" || upper === "BTN/SB" ? "IP" : "OOP";
}

/** Build the normalized GTO lookup key. */
export function buildGtoKey(
  ipOop: IpOop,
  board: BoardTexture,
  handTier: HandTier,
  facingBet: boolean,
): string {
  const pairedSuffix = board.paired ? "p" : "";
  const facingStr = facingBet ? "bet" : "nobet";
  return `${ipOop}_${board.street}_ws${board.wetScore}${pairedSuffix}_${handTier}_${facingStr}`;
}
