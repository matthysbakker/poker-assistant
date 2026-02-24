/**
 * Board Analyzer — derives BoardTexture flags from community cards.
 *
 * The key output is `wetScore` (0-4) which drives GTO bet sizing via the
 * Wetness Parabola: dry/paired=0.33, semi-connected=0.50, connected=0.66,
 * monotone=0.33 (counter-intuitive: monotone is small because ranges are polarised).
 *
 * Results are cached by input key for repeated calls within the same tick.
 */

import { parseCard } from "./equity/card";

export interface BoardTexture {
  /** 0=rainbow 1=two-tone 2=monotone */
  suitedness: 0 | 1 | 2;
  /** At least one rank appears twice */
  paired: boolean;
  /** Board cards are connected (max gap ≤ 2 between consecutive ranks) */
  connected: boolean;
  /** Board has some connectivity but not fully connected (gap ≤ 3) */
  semiConnected: boolean;
  /** At least one card is A, K, or Q */
  highCards: boolean;
  /** All cards are 7 or below */
  lowCards: boolean;
  /** Current street */
  street: "flop" | "turn" | "river" | "preflop";
  /**
   * Wetness score 0–4 — drives GTO bet sizing:
   *   0 = dry (paired, rainbow)       → 33% pot
   *   1 = semi-dry                    → 33% pot
   *   2 = semi-wet                    → 50% pot
   *   3 = wet (connected + two-tone)  → 66% pot
   *   4 = monotone                    → 33% pot (polarised — see docs)
   *
   * Use betFractionFromWetScore() to convert to a bet fraction.
   */
  wetScore: 0 | 1 | 2 | 3 | 4;
}

const WET_SCORE_BET_FRACTIONS: Record<number, number> = {
  0: 0.33,
  1: 0.33,
  2: 0.50,
  3: 0.66,
  4: 0.33, // monotone: polarised ranges → smaller sizing
};

/** Convert wetScore to a GTO-informed pot-fraction bet size. */
export function betFractionFromWetScore(wetScore: number): number {
  return WET_SCORE_BET_FRACTIONS[wetScore] ?? 0.50;
}

// ── Cache ────────────────────────────────────────────────────────────────────

const _boardCache = new Map<string, BoardTexture>();

// ── Main Analyzer ────────────────────────────────────────────────────────────

/**
 * Analyse community cards and return a BoardTexture.
 *
 * @param communityCards  Array of card strings, e.g. ["Ah", "Kd", "10s"]
 */
export function analyzeBoard(communityCards: string[]): BoardTexture {
  if (communityCards.length === 0) {
    return {
      suitedness: 0, paired: false, connected: false, semiConnected: false,
      highCards: false, lowCards: false, street: "preflop", wetScore: 0,
    };
  }

  const cacheKey = communityCards.join(" ");
  const cached = _boardCache.get(cacheKey);
  if (cached) return cached;

  const result = _analyze(communityCards);
  _boardCache.set(cacheKey, result);
  return result;
}

function _analyze(communityCards: string[]): BoardTexture {
  // Parse ranks and suits using the shared card parser
  const ranks: number[] = [];
  const suits: number[] = [];

  for (const card of communityCards) {
    const parsed = parseCard(card);
    if (parsed) {
      ranks.push(parsed.rank);
      suits.push(parsed.suit);
    }
  }

  const n = ranks.length;
  const street: BoardTexture["street"] =
    n >= 5 ? "river" : n === 4 ? "turn" : n === 3 ? "flop" : "preflop";

  // Suitedness
  const suitCounts = new Uint8Array(4);
  for (const s of suits) suitCounts[s]++;
  const maxSuit = Math.max(...suitCounts);
  const suitedness: 0 | 1 | 2 =
    maxSuit >= 3 ? 2 : maxSuit === 2 ? 1 : 0;

  // Paired
  const rankCounts = new Uint8Array(15);
  for (const r of ranks) rankCounts[r]++;
  const paired = ranks.some((r) => rankCounts[r] >= 2);

  // Connectivity — sort unique ranks and check gaps
  const sortedRanks = [...new Set(ranks)].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < sortedRanks.length; i++) {
    const gap = sortedRanks[i] - sortedRanks[i - 1];
    if (gap > maxGap) maxGap = gap;
  }
  const connected = sortedRanks.length >= 2 && maxGap <= 2;
  const semiConnected = sortedRanks.length >= 2 && maxGap <= 3;

  // High / low cards
  const highCards = ranks.some((r) => r >= 12); // Q, K, A
  const lowCards = ranks.every((r) => r <= 7);

  // Wet score
  const wetScore = _computeWetScore(suitedness, paired, connected, semiConnected);

  return { suitedness, paired, connected, semiConnected, highCards, lowCards, street, wetScore };
}

function _computeWetScore(
  suitedness: 0 | 1 | 2,
  paired: boolean,
  connected: boolean,
  semiConnected: boolean,
): 0 | 1 | 2 | 3 | 4 {
  // Monotone (3+ same suit): polarised ranges, smaller sizing
  if (suitedness === 2) return 4;
  // Very dry: paired + rainbow
  if (paired && suitedness === 0) return 0;
  // Wet: connected + two-tone
  if (connected && suitedness === 1) return 3;
  // Semi-wet: semi-connected or two-tone
  if (semiConnected || suitedness === 1) return 2;
  // Dry: connected rainbow or paired two-tone
  if (connected || paired) return 1;
  return 0;
}

/** Clear board analysis cache (call at start of each new hand). */
export function clearBoardCache(): void {
  _boardCache.clear();
}
