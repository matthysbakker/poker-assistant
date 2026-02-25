/**
 * RFI fallback — inline open-raise chart for when the persona server is
 * unavailable. Used by Phase 1b in poker-content.ts.
 *
 * Ranges are GTO-approximate for 6-max NL10/NL20 cash games.
 * Position: UTG / MP / CO / BTN / SB / BB
 */

import { toHandNotation } from "./hand-notation";
import type { LocalDecision } from "./types";

// ── Open-raising ranges by position ─────────────────────────────────────────

const RAISE_UTG = new Set([
  "AA", "KK", "QQ", "JJ", "TT",
  "AKs", "AQs", "AKo", "AQo",
  "KQs", "QJs", "JTs",
]);

const RAISE_MP = new Set([
  "AA", "KK", "QQ", "JJ", "TT", "99",
  "AKs", "AQs", "AJs", "AKo", "AQo",
  "KQs", "KJs", "QJs", "JTs", "T9s",
]);

const RAISE_CO = new Set([
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77",
  "AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "AKo", "AQo", "AJo",
  "KQs", "KJs", "KTs", "KQo",
  "QJs", "QTs", "JTs", "T9s", "98s",
]);

const RAISE_BTN = new Set([
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55", "44",
  "AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s",
  "AKo", "AQo", "AJo", "ATo", "A9o", "A8o",
  "KQs", "KJs", "KTs", "K9s", "KQo", "KJo",
  "QJs", "QTs", "Q9s",
  "JTs", "J9s", "T9s", "T8s", "98s", "87s", "76s", "65s",
]);

const RAISE_SB = new Set([
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66",
  "AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s",
  "AKo", "AQo", "AJo", "ATo", "A9o",
  "KQs", "KJs", "KTs", "KQo", "KJo",
  "QJs", "QTs", "JTs", "T9s", "98s", "87s",
]);

// BB folds (BB has already acted or is not in an opening spot).
// safeExecuteAction() overrides FOLD → CHECK when CHECK is available.

// ── Helpers ──────────────────────────────────────────────────────────────────

function raiseSetForPosition(pos: string): Set<string> {
  switch (pos.toUpperCase()) {
    case "UTG": return RAISE_UTG;
    case "MP":  return RAISE_MP;
    case "CO":  return RAISE_CO;
    case "BTN": return RAISE_BTN;
    case "SB":  return RAISE_SB;
    default:    return new Set(); // BB or unknown — don't open-raise
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Decide open-raise vs fold when there is no persona recommendation.
 *
 * @param heroCards  Two card strings, e.g. ["Ah", "Kd"]
 * @param position   Position string: "UTG"|"MP"|"CO"|"BTN"|"SB"|"BB"|"??"
 * @param bbAmount   Size of the big blind in €, used to compute raise amount.
 *                   If 0 or unknown, amount is returned as null.
 *
 * Returns null when hand notation can't be parsed (caller should fold).
 */
export function rfiDecision(
  heroCards: string[],
  position: string,
  bbAmount: number,
): LocalDecision | null {
  const handKey = toHandNotation(heroCards.join(" "));
  if (!handKey) return null;

  const pos = position.toUpperCase();
  const raiseSet = raiseSetForPosition(pos);

  if (raiseSet.has(handKey)) {
    // Late position (BTN/CO): open 2.5×BB; early/mid/SB: open 3×BB
    const multiplier = ["BTN", "CO"].includes(pos) ? 2.5 : 3.0;
    const amount = bbAmount > 0 ? Math.round(bbAmount * multiplier * 100) / 100 : null;
    const bbTag = amount != null && bbAmount > 0 ? ` (${multiplier}BB)` : "";
    return {
      action: "RAISE",
      amount,
      confidence: 0.72,
      reasoning: `RFI fallback: ${handKey} from ${pos} — raise${bbTag}`,
    };
  }

  // Fold everything else (overridden to CHECK by safeExecuteAction when facing no bet)
  return {
    action: "FOLD",
    amount: null,
    confidence: 0.72,
    reasoning: `RFI fallback: ${handKey} from ${pos} — fold/check`,
  };
}
