/**
 * Hand Evaluator — rank-counting tier classifier for the local poker engine.
 *
 * Classifies any 5-7 card set into one of 9 HandTier values.
 * Uses pre-allocated Uint8Arrays to stay under 0.005ms per call.
 * Results are cached by input key for repeated calls within the same tick.
 *
 * Card format: "<rank><suit>" where rank ∈ {2-9, 10, J, Q, K, A} and suit ∈ {h,d,c,s}
 * e.g. "Ah", "10s", "Kd", "2c"
 */

import { parseCard, type Card as ParsedCard } from "./equity/card";

export type HandTier =
  | "nut"           // straight flush, quads, nut flush (A-high)
  | "strong"        // flush, straight, full house, set
  | "top_pair_gk"  // TPTK / overpair
  | "medium"        // middle pair, top pair weak kicker
  | "weak"          // bottom pair, underpair
  | "strong_draw"   // 12+ outs (flush draw + pair, combo draw)
  | "draw"          // 8-9 outs (flush draw, open-ended straight draw)
  | "weak_draw"     // 4 outs (gutshot)
  | "air";          // nothing

export interface HandEvaluation {
  tier: HandTier;
  /** 0.0–1.0 relative hand strength within the tier — used for kicker decisions */
  strength: number;
  description: string;
}

// ── Card Parsing — delegated to equity/card.ts ────────────────────────────────
// parseCard and ParsedCard (= Card) are imported at the top of the file.

// ── Pre-allocated counters (avoids GC pressure in hot path) ─────────────────

const _rankCounts = new Uint8Array(15); // index 2-14
const _suitCounts = new Uint8Array(4);  // h/d/c/s

// ── Draw Detection ───────────────────────────────────────────────────────────
//
// TODO: align flushOutCount / straightOutCount with lib/poker/equity/outs.ts.
// They cannot be directly replaced yet: straightOutCount here returns a plain
// number (max outs for a single-street draw), while countStraightOuts in
// outs.ts returns { oesd, gutshot } for equity calculations. The calling
// code in _classify() uses the combined number directly, so merging requires
// updating the call sites too.

/** Count outs for flush draw. Returns number of remaining suited cards to complete. */
function flushOutCount(cards: ParsedCard[]): number {
  _suitCounts.fill(0);
  for (const c of cards) _suitCounts[c.suit]++;
  let maxSuit = 0;
  for (let i = 0; i < 4; i++) if (_suitCounts[i] > maxSuit) maxSuit = _suitCounts[i];
  if (maxSuit === 4) return 9; // flush draw: 9 outs
  if (maxSuit === 3) return 2; // backdoor flush: ~2 effective outs
  return 0;
}

/** Count outs for straight draws. Returns outs: 0, 4 (gutshot), 8 (OESD). */
function straightOutCount(ranks: Uint8Array): number {
  // Build bitmask of present ranks (A counts as both 1 and 14)
  let bits = 0;
  for (let r = 2; r <= 14; r++) if (ranks[r] > 0) bits |= (1 << r);
  if (ranks[14] > 0) bits |= 2; // A as 1 for wheel

  let maxOuts = 0;
  // Check each possible 5-card window for how many cards are already present
  for (let low = 1; low <= 10; low++) {
    let filled = 0;
    for (let r = low; r < low + 5; r++) {
      if (bits & (1 << r)) filled++;
    }
    if (filled === 5) return 0; // already a straight
    if (filled === 4) {
      // Distinguish OESD (both ends open) from gutshot (internal gap)
      const isOpen = !(bits & (1 << low)) || !(bits & (1 << (low + 4)));
      if (isOpen) maxOuts = 8;
      else if (maxOuts < 4) maxOuts = 4;
    }
    // filled === 3 → backdoor (2 cards needed) — not counted as single-street outs
  }
  return maxOuts;
}

/** Does the current rank distribution form a straight? */
function hasStraight(ranks: Uint8Array): boolean {
  let bits = 0;
  for (let r = 2; r <= 14; r++) if (ranks[r] > 0) bits |= (1 << r);
  if (ranks[14] > 0) bits |= 2; // wheel
  for (let low = 1; low <= 10; low++) {
    const mask = 0b11111 << low;
    if ((bits & mask) === mask) return true;
  }
  return false;
}

/** Is there a flush (5+ same suit)? Returns the flush suit index or -1. */
function hasFlush(cards: ParsedCard[]): number {
  _suitCounts.fill(0);
  for (const c of cards) _suitCounts[c.suit]++;
  for (let i = 0; i < 4; i++) if (_suitCounts[i] >= 5) return i;
  return -1;
}

/** Top rank of community cards (for kicker comparison). */
function topBoardRank(communityCards: ParsedCard[]): number {
  let top = 0;
  for (const c of communityCards) if (c.rank > top) top = c.rank;
  return top;
}

// ── Main Classifier ──────────────────────────────────────────────────────────

const _evalCache = new Map<string, HandEvaluation>();

/**
 * Evaluate hero's hand strength.
 *
 * @param heroCards     2 hero hole cards (["Ah", "Kd"])
 * @param communityCards  3-5 board cards (flop/turn/river)
 * @returns HandEvaluation with tier, relative strength, and description
 */
export function evaluateHand(
  heroCards: string[],
  communityCards: string[],
): HandEvaluation {
  const cacheKey = [...heroCards, "|", ...communityCards].join(" ");
  const cached = _evalCache.get(cacheKey);
  if (cached) return cached;

  const allParsed = [...heroCards, ...communityCards].map(parseCard).filter((c): c is ParsedCard => c !== null);
  const heroParsed = heroCards.map(parseCard).filter((c): c is ParsedCard => c !== null);
  const boardParsed = communityCards.map(parseCard).filter((c): c is ParsedCard => c !== null);

  const result = _classify(allParsed, heroParsed, boardParsed);
  _evalCache.set(cacheKey, result);
  return result;
}

function _classify(
  all: ParsedCard[],
  hero: ParsedCard[],
  board: ParsedCard[],
): HandEvaluation {
  if (hero.length === 0) return { tier: "air", strength: 0, description: "No hero cards" };

  _rankCounts.fill(0);
  for (const c of all) _rankCounts[c.rank]++;

  // Count hand categories
  let quads = 0, trips = 0, pairs = 0, topPairRank = 0;
  for (let r = 14; r >= 2; r--) {
    if (_rankCounts[r] === 4) quads++;
    else if (_rankCounts[r] === 3) trips++;
    else if (_rankCounts[r] === 2) {
      pairs++;
      if (topPairRank === 0) topPairRank = r;
    }
  }

  const flushSuit = hasFlush(all);
  const straight = hasStraight(_rankCounts);

  // ── Nut-tier hands ──
  // Straight flush
  if (flushSuit >= 0 && straight) {
    const suitedCards = all.filter((c) => c.suit === flushSuit).sort((a, b) => b.rank - a.rank);
    const sfRanks = new Uint8Array(15);
    for (const c of suitedCards) sfRanks[c.rank]++;
    if (hasStraight(sfRanks)) {
      return { tier: "nut", strength: 1.0, description: "Straight flush" };
    }
  }
  // Quads
  if (quads > 0) return { tier: "nut", strength: 0.95, description: "Four of a kind" };
  // Nut flush (A-high flush)
  if (flushSuit >= 0) {
    const heroHasFlushSuit = hero.some((c) => c.suit === flushSuit);
    const isNutFlush = heroHasFlushSuit && hero.some((c) => c.suit === flushSuit && c.rank === 14);
    if (isNutFlush) return { tier: "nut", strength: 0.9, description: "Nut flush" };
  }
  // Full house
  if (trips > 0 && pairs > 0) {
    return { tier: "strong", strength: 0.95, description: "Full house" };
  }
  // Non-nut flush
  if (flushSuit >= 0) {
    return { tier: "strong", strength: 0.85, description: "Flush" };
  }
  // Straight
  if (straight) {
    return { tier: "strong", strength: 0.8, description: "Straight" };
  }
  // Set (trips using a hero hole card)
  if (trips > 0) {
    const heroMakesTrips = hero.some((c) => _rankCounts[c.rank] === 3);
    if (heroMakesTrips) return { tier: "strong", strength: 0.75, description: "Set" };
    // Trips on the board — weaker
    return { tier: "medium", strength: 0.65, description: "Trips (board)" };
  }

  // Board texture for pair analysis
  const topBoard = topBoardRank(board);
  const secondBoard = board.length >= 2
    ? board.map((c) => c.rank).sort((a, b) => b - a)[1]
    : 0;

  // Two pair
  if (pairs >= 2) {
    const heroMakesBothPairs = hero.filter((c) => _rankCounts[c.rank] === 2).length >= 1;
    if (!heroMakesBothPairs) {
      // Both pairs on board
      return { tier: "medium", strength: 0.5, description: "Two pair (board)" };
    }
    return { tier: "strong", strength: 0.7, description: "Two pair" };
  }

  // One pair
  if (pairs === 1) {
    const heroPairCard = hero.find((c) => _rankCounts[c.rank] === 2);
    if (!heroPairCard) {
      // Pocket pair that doesn't pair board
      const heroR1 = hero[0]?.rank ?? 0;
      const heroR2 = hero[1]?.rank ?? 0;
      const heroHigh = Math.max(heroR1, heroR2);
      if (heroHigh > topBoard) return { tier: "top_pair_gk", strength: 0.72, description: "Overpair" };
      if (heroHigh > secondBoard) return { tier: "medium", strength: 0.45, description: "Middle underpair" };
      return { tier: "weak", strength: 0.25, description: "Underpair" };
    }

    const pairRank = heroPairCard.rank;
    const kicker = hero.find((c) => c !== heroPairCard)?.rank ?? 0;

    if (pairRank > topBoard) {
      // Pocket pair higher than all board cards → overpair
      return { tier: "top_pair_gk", strength: 0.80 + pairRank / 100, description: "Overpair" };
    }
    if (pairRank === topBoard) {
      // Top pair — kicker boundary: J+ is "good kicker"
      if (kicker >= 11) return { tier: "top_pair_gk", strength: 0.75 + kicker / 100, description: "TPTK" };
      return { tier: "medium", strength: 0.5, description: "Top pair weak kicker" };
    }
    if (pairRank === secondBoard) return { tier: "medium", strength: 0.45, description: "Middle pair" };
    return { tier: "weak", strength: 0.2, description: "Bottom pair" };
  }

  // No made hand — evaluate draws
  const flushOuts = flushOutCount(all);
  const straightOuts = straightOutCount(_rankCounts);
  const totalOuts = flushOuts + straightOuts;

  // Strong draw: 12+ outs (flush draw + pair, combo draw)
  if (totalOuts >= 12 || (flushOuts >= 9 && pairs > 0)) {
    return { tier: "strong_draw", strength: 0.6, description: "Strong draw (12+ outs)" };
  }
  // Standard draw: flush draw (9 outs) or OESD (8 outs)
  if (flushOuts >= 9 || straightOuts >= 8) {
    return { tier: "draw", strength: 0.45, description: flushOuts >= 9 ? "Flush draw" : "Open-ended straight draw" };
  }
  // Weak draw: gutshot (4 outs)
  if (straightOuts >= 4 || flushOuts >= 2) {
    return { tier: "weak_draw", strength: 0.2, description: "Gutshot / backdoor draw" };
  }

  return { tier: "air", strength: 0.0, description: "Air" };
}

/** Clear evaluation cache (call at start of each new hand). */
export function clearEvalCache(): void {
  _evalCache.clear();
}
