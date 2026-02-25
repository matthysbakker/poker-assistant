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

// ── Facing a 3-bet ──────────────────────────────────────────────────────────

/** Hands that 4-bet for value from any position vs a 3-bet. */
const ALWAYS_4BET = new Set([
  "AA", "KK", "QQ",
  "AKs", "AKo",
]);

/**
 * Bluff 4-bet hands — block nut flush combos, fold equity vs non-premiums.
 * Only in position.
 */
const IP_4BET_BLUFF = new Set([
  "A5s", "A4s", "A3s",
]);

/** Hands that call a 3-bet in position (BTN/CO). */
const CALL_VS_3BET_IP = new Set([
  "JJ", "TT",
  "AQs", "AQo",
  "KQs",
]);

/** BB defends wider vs 3-bet due to pot odds. */
const BB_CALL_VS_3BET = new Set([
  "JJ", "TT", "99",
  "AQs", "AQo", "AJs",
  "KQs",
]);

/**
 * Decide action when hero opened preflop and now faces a 3-bet.
 *
 * Caller detects this scenario via `preflopFastPathFired` (hero already
 * opened → the new CALL obligation must be a 3-bet).
 *
 * Returns null when hand notation can't be parsed (caller should fold).
 */
export function facing3BetDecision(
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

  const potOdds = pot > 0 ? callAmount / (pot + callAmount) : 0;
  const oddsStr = `(call ${callAmount.toFixed(2)} into ${pot.toFixed(2)}, ${(potOdds * 100).toFixed(0)}% odds)`;

  // ── 4-bet for value ──────────────────────────────────────────────────
  if (ALWAYS_4BET.has(handKey)) {
    const amount = Math.round(callAmount * 3 * 100) / 100;
    return {
      action: "RAISE",
      amount,
      confidence: 0.90,
      reasoning: `${handKey} — 4-bet for value vs 3-bet from ${pos}`,
    };
  }

  // ── 4-bet bluff in position ──────────────────────────────────────────
  if (ip && IP_4BET_BLUFF.has(handKey)) {
    const amount = Math.round(callAmount * 3 * 100) / 100;
    return {
      action: "RAISE",
      amount,
      confidence: 0.72,
      reasoning: `${handKey} in position — 4-bet bluff vs 3-bet`,
    };
  }

  // ── Call ────────────────────────────────────────────────────────────
  if (ip && CALL_VS_3BET_IP.has(handKey)) {
    return {
      action: "CALL",
      amount: null,
      confidence: 0.76,
      reasoning: `${handKey} in position — calling 3-bet ${oddsStr}`,
    };
  }

  if (isBB && BB_CALL_VS_3BET.has(handKey)) {
    return {
      action: "CALL",
      amount: null,
      confidence: 0.78,
      reasoning: `${handKey} from BB — defending vs 3-bet ${oddsStr}`,
    };
  }

  // ── Fold ────────────────────────────────────────────────────────────
  return {
    action: "FOLD",
    amount: null,
    confidence: 0.82,
    reasoning: `${handKey} from ${pos} — folding to 3-bet`,
  };
}

// ── Facing a limp ───────────────────────────────────────────────────────────

/** Hands to iso-raise with in position (BTN/CO/HJ). */
const ISO_RAISE_IP = new Set([
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55",
  "AKs", "AQs", "AJs", "ATs", "AKo", "AQo", "AJo",
  "KQs", "KJs", "KQo",
  "QJs", "JTs", "T9s", "98s",
]);

/** Hands to iso-raise with out of position (SB/UTG/MP). */
const ISO_RAISE_OOP = new Set([
  "AA", "KK", "QQ", "JJ", "TT", "99", "88",
  "AKs", "AQs", "AJs", "AKo", "AQo",
  "KQs",
]);

/**
 * Hands that complete (call) in position — implied odds speculative holdings.
 * Complete rather than iso-raise; not strong enough to fold out limpers.
 */
const COMPLETE_IP = new Set([
  "22", "33", "44",
  "A2s", "A3s", "A4s", "A5s", "A6s", "A7s", "A8s", "A9s",
  "K9s",
  "87s", "76s", "65s", "54s",
]);

/** BB premiums that raise vs a limp for value. */
const BB_RAISE_VS_LIMP = new Set([
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77",
  "AKs", "AQs", "AJs", "ATs", "AKo", "AQo", "AJo",
  "KQs", "KQo",
  "QJs",
]);

/**
 * Decide action when hero faces a single limper (CALL > 0 but callAmount/pot < 0.50).
 *
 * @param callAmount  Cost to call the limp (≈ 1 BB)
 * @param _pot        Total pot (unused — iso size is relative to callAmount)
 *
 * Returns null when hand notation can't be parsed (caller should fold).
 */
export function facingLimpDecision(
  heroCards: string[],
  position: string,
  callAmount: number,
  _pot: number,
): LocalDecision | null {
  const handKey = toHandNotation(heroCards.join(" "));
  if (!handKey) return null;

  const ip = isInPosition(position);
  const pos = position.toUpperCase();
  const isBB = pos === "BB";

  // Iso-raise amount ≈ 4× the limp (1BB), isolating the limper
  const isoAmount = Math.round(callAmount * 4 * 100) / 100;

  // ── BB vs limp ──────────────────────────────────────────────────────
  if (isBB) {
    if (BB_RAISE_VS_LIMP.has(handKey)) {
      return {
        action: "RAISE",
        amount: isoAmount,
        confidence: 0.78,
        reasoning: `${handKey} from BB — raising vs limp`,
      };
    }
    // BB checks behind for free (overridden from FOLD → CHECK by safeExecuteAction)
    return {
      action: "FOLD",
      amount: null,
      confidence: 0.72,
      reasoning: `${handKey} from BB — check vs limp`,
    };
  }

  // ── IP: iso-raise, complete, or fold ────────────────────────────────
  if (ip) {
    if (ISO_RAISE_IP.has(handKey)) {
      return {
        action: "RAISE",
        amount: isoAmount,
        confidence: 0.76,
        reasoning: `${handKey} in position — iso-raise vs limp`,
      };
    }
    if (COMPLETE_IP.has(handKey)) {
      return {
        action: "CALL",
        amount: null,
        confidence: 0.68,
        reasoning: `${handKey} in position — complete vs limp (implied odds)`,
      };
    }
    return {
      action: "FOLD",
      amount: null,
      confidence: 0.72,
      reasoning: `${handKey} from ${pos} — folding vs limp`,
    };
  }

  // ── OOP: iso-raise strong hands, fold rest ───────────────────────────
  if (ISO_RAISE_OOP.has(handKey)) {
    return {
      action: "RAISE",
      amount: isoAmount,
      confidence: 0.74,
      reasoning: `${handKey} OOP — iso-raise vs limp`,
    };
  }

  return {
    action: "FOLD",
    amount: null,
    confidence: 0.72,
    reasoning: `${handKey} from ${pos} — folding vs limp OOP`,
  };
}
