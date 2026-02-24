/**
 * Preflop facing-raise decision engine.
 *
 * Covers the case where hero faces a single open raise and must decide to
 * 3-bet, call, or fold. The RFI persona charts handle open-raising; this
 * handles the re-raise / defend decision.
 *
 * Based on GTO approximations for 6-max NL10/NL20 cash games.
 * Position is hero's position (not the raiser's position).
 */

import { toHandNotation } from "./hand-notation";
import type { LocalDecision } from "./types";

/** Hands that 3-bet for value from any position. */
const ALWAYS_3BET = new Set([
  "AA", "KK", "QQ", "JJ",
  "AKs", "AKo",
]);

/**
 * Hands that 3-bet when in position (BTN/CO), call when OOP.
 * Strong enough to play for stacks but gain value from position.
 */
const IP_3BET_ELSE_CALL = new Set([
  "TT",
  "AQs", "AQo",
]);

/**
 * Hands that call in position (BTN/CO/SB heads-up-ish), fold OOP.
 * Rely on post-flop edges and implied odds.
 */
const CALL_IP_ONLY = new Set([
  "99", "88", "77",
  "AJs", "AJo",
  "KQs", "KJs",
  "QJs", "JTs", "T9s", "98s", "87s", "76s", "65s", "54s",
]);

/**
 * Hands that call from any position (strong enough for OOP too).
 */
const CALL_ANY = new Set([
  "99", "88",
  "AQs", "AJs",
]);

/**
 * BB gets ~3:1 immediate odds against a standard 3BB open, so defends much wider.
 * These hands call from BB but fold from other OOP positions (UTG/MP/SB).
 */
const BB_EXTRA_CALLS = new Set([
  "77", "66", "55", "44", "33", "22",
  "AQo", "AJo", "ATo", "A9s",
  "KQo", "KJs", "KTs",
  "QJs", "QTs",
  "JTs", "J9s",
  "T9s", "T8s",
  "98s", "97s",
  "87s", "86s",
  "76s", "75s",
  "65s", "64s",
  "54s", "53s",
]);

function isInPosition(position: string): boolean {
  const pos = position.toUpperCase();
  return pos === "BTN" || pos === "CO";
}

/**
 * Decide action when hero faces a single preflop open raise.
 *
 * Returns null when the hand notation can't be parsed (callers should fold).
 */
export function facingRaiseDecision(
  heroCards: string[],
  position: string,
  callAmount: number,
  pot: number,
): LocalDecision | null {
  const handKey = toHandNotation(heroCards.join(" "));
  if (!handKey) return null;

  const ip = isInPosition(position);
  const pos = position.toUpperCase();
  const isBB = pos === "BB";
  const isSB = pos === "SB";

  // Pot odds: used for reasoning string
  const potOdds = pot > 0 ? callAmount / (pot + callAmount) : 0;
  const oddsStr = `(call ${callAmount.toFixed(2)} into ${pot.toFixed(2)}, ${(potOdds * 100).toFixed(0)}% odds)`;

  // ── 3-bet ──────────────────────────────────────────────────────────────
  if (ALWAYS_3BET.has(handKey)) {
    const amount = Math.round(callAmount * 3 * 100) / 100; // ~3x the open
    return {
      action: "RAISE",
      amount,
      confidence: 0.92,
      reasoning: `${handKey} — premium 3-bet from ${pos}`,
    };
  }

  if (IP_3BET_ELSE_CALL.has(handKey)) {
    if (ip) {
      const amount = Math.round(callAmount * 3 * 100) / 100;
      return {
        action: "RAISE",
        amount,
        confidence: 0.82,
        reasoning: `${handKey} in position — 3-bet for value`,
      };
    }
    // OOP: call (strong enough, but don't bloat OOP)
    return {
      action: "CALL",
      amount: null,
      confidence: 0.75,
      reasoning: `${handKey} OOP — flatting ${oddsStr}`,
    };
  }

  // ── Call ───────────────────────────────────────────────────────────────
  if (CALL_ANY.has(handKey)) {
    return {
      action: "CALL",
      amount: null,
      confidence: 0.78,
      reasoning: `${handKey} — calling from ${pos} ${oddsStr}`,
    };
  }

  if (ip && CALL_IP_ONLY.has(handKey)) {
    return {
      action: "CALL",
      amount: null,
      confidence: 0.74,
      reasoning: `${handKey} in position — calling with implied odds ${oddsStr}`,
    };
  }

  if (isBB && BB_EXTRA_CALLS.has(handKey)) {
    return {
      action: "CALL",
      amount: null,
      confidence: 0.71,
      reasoning: `${handKey} from BB — defending wide ${oddsStr}`,
    };
  }

  // SB can defend a bit wider than UTG/MP but narrower than BB
  if (isSB && CALL_ANY.has(handKey)) {
    return {
      action: "CALL",
      amount: null,
      confidence: 0.72,
      reasoning: `${handKey} SB — calling ${oddsStr}`,
    };
  }

  // ── Fold ───────────────────────────────────────────────────────────────
  return {
    action: "FOLD",
    amount: null,
    confidence: 0.80,
    reasoning: `${handKey} from ${pos} — folding to raise`,
  };
}
