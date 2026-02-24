/**
 * Out counting — exact, not approximate.
 * Returns clean out counts per draw type for use in equity calculations.
 */

import type { Card } from "./card";

export interface OutAnalysis {
  flushOuts: number;      // 0 / 9 (flush draw) / 2 (backdoor)
  oesd: number;           // 0 / 8 (open-ended straight draw)
  gutshot: number;        // 0 / 4 (gutshot straight draw)
  totalRawOuts: number;   // sum before dirty-out discounts
  description: string;    // human-readable draw description
}

const _suitCounts = new Uint8Array(4);
const _rankCounts = new Uint8Array(15);

/** Count flush outs from all 5-7 cards. */
function countFlushOuts(cards: Card[]): number {
  _suitCounts.fill(0);
  for (const c of cards) _suitCounts[c.suit]++;
  let max = 0;
  for (let i = 0; i < 4; i++) if (_suitCounts[i] > max) max = _suitCounts[i];
  if (max >= 5) return 0;  // already a flush
  if (max === 4) return 9; // flush draw
  if (max === 3) return 2; // backdoor flush (~2 effective outs across 2 streets)
  return 0;
}

/** Count straight outs. Returns { oesd, gutshot }. */
function countStraightOuts(cards: Card[]): { oesd: number; gutshot: number } {
  _rankCounts.fill(0);
  for (const c of cards) _rankCounts[c.rank]++;

  let bits = 0;
  for (let r = 2; r <= 14; r++) if (_rankCounts[r] > 0) bits |= (1 << r);
  if (_rankCounts[14] > 0) bits |= 2; // A as wheel low

  let oesd = 0, gutshot = 0;
  for (let low = 1; low <= 10; low++) {
    let filled = 0;
    for (let r = low; r < low + 5; r++) {
      if (bits & (1 << r)) filled++;
    }
    if (filled === 5) return { oesd: 0, gutshot: 0 }; // already a straight
    if (filled === 4) {
      // Distinguish OESD (both ends open = 8 outs) from gutshot (internal gap = 4 outs)
      const isOpen = !(bits & (1 << low)) || !(bits & (1 << (low + 4)));
      if (isOpen) oesd = 8;
      else if (gutshot === 0) gutshot = 4;
    }
    // filled === 3 → backdoor straight (2 cards needed) — not counted as single-street outs
  }
  return { oesd, gutshot };
}

/**
 * Analyse draws for a hero holding hole cards with community cards.
 * Pass all cards (hero + community) together.
 */
export function analyzeOuts(allCards: Card[]): OutAnalysis {
  const flushOuts = countFlushOuts(allCards);
  const { oesd, gutshot } = countStraightOuts(allCards);
  const totalRawOuts = flushOuts + oesd + gutshot;

  const parts: string[] = [];
  if (flushOuts === 9) parts.push("flush draw (9 outs)");
  else if (flushOuts === 2) parts.push("backdoor flush");
  if (oesd === 8) parts.push("open-ended straight draw (8 outs)");
  if (gutshot === 4) parts.push("gutshot (4 outs)");

  return {
    flushOuts,
    oesd,
    gutshot,
    totalRawOuts,
    description: parts.length > 0 ? parts.join(" + ") : "no draw",
  };
}
