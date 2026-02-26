/**
 * VillainRange — maps a VPIP percentage to a preflop hand range.
 *
 * Used by the equity engine (/api/equity) to compute hero equity vs
 * a villain whose range is parameterised by their observed VPIP.
 */

export interface VillainRange {
  combos: string[];       // e.g. ["AAs", "KKs", ..., "72o"]
  vpipSource: number;     // VPIP% this was derived from (for debugging)
  confidence: number;     // 0-1, based on sample size
  source: "vpip_derived" | "default_random";
}

// ── Preflop hand ordering by strength (standard equity ranking, 169 combos) ──
// Pairs descend by rank; then suited broadways; then suited connectors; then offsuit.
// This list drives vpipToRange(): top N entries constitute the range.
// Each entry represents a hand class. Suited hands get 4 combos, pairs 6, offsuit 12.
const HAND_ORDER: Array<[string, number]> = [
  // Pairs (6 combos each)
  ["AA", 6], ["KK", 6], ["QQ", 6], ["JJ", 6], ["TT", 6],
  ["99", 6], ["88", 6], ["77", 6], ["66", 6], ["55", 6],
  ["44", 6], ["33", 6], ["22", 6],
  // Premium suited broadways (4 combos each)
  ["AKs", 4], ["AQs", 4], ["AJs", 4], ["ATs", 4],
  ["KQs", 4], ["KJs", 4], ["KTs", 4],
  ["QJs", 4], ["QTs", 4], ["JTs", 4],
  // Premium offsuit broadways (12 combos each)
  ["AKo", 12], ["AQo", 12], ["AJo", 12],
  // Suited connectors and one-gappers
  ["T9s", 4], ["98s", 4], ["87s", 4], ["76s", 4], ["65s", 4],
  ["54s", 4], ["A9s", 4], ["A8s", 4], ["A7s", 4], ["A6s", 4],
  ["A5s", 4], ["A4s", 4], ["A3s", 4], ["A2s", 4],
  ["KQo", 12], ["KJo", 12], ["QJo", 12], ["ATo", 12],
  ["K9s", 4], ["Q9s", 4], ["J9s", 4], ["T8s", 4], ["97s", 4],
  ["86s", 4], ["75s", 4], ["64s", 4], ["53s", 4],
  ["KTo", 12], ["QTo", 12], ["JTo", 12], ["ATo", 12],
  ["K8s", 4], ["K7s", 4], ["K6s", 4], ["K5s", 4], ["K4s", 4],
  ["K3s", 4], ["K2s", 4],
  ["Q8s", 4], ["J8s", 4], ["T7s", 4], ["96s", 4], ["85s", 4],
  ["74s", 4], ["63s", 4], ["52s", 4], ["43s", 4],
  ["KTo", 12], ["QTo", 12], ["JTo", 12],
  ["K9o", 12], ["Q9o", 12], ["J9o", 12], ["T9o", 12],
  ["Q7s", 4], ["Q6s", 4], ["Q5s", 4], ["Q4s", 4], ["Q3s", 4], ["Q2s", 4],
  ["J7s", 4], ["J6s", 4], ["J5s", 4], ["J4s", 4], ["J3s", 4], ["J2s", 4],
  ["A9o", 12], ["A8o", 12], ["A7o", 12], ["A6o", 12],
  ["98o", 12], ["87o", 12], ["76o", 12], ["65o", 12],
  ["T6s", 4], ["95s", 4], ["84s", 4], ["73s", 4], ["62s", 4],
  ["42s", 4], ["32s", 4],
  ["A5o", 12], ["A4o", 12], ["A3o", 12], ["A2o", 12],
  ["K8o", 12], ["K7o", 12], ["K6o", 12], ["K5o", 12],
  ["Q8o", 12], ["J8o", 12], ["T8o", 12], ["97o", 12],
  ["86o", 12], ["75o", 12], ["64o", 12], ["53o", 12], ["43o", 12],
  // Junk / very weak hands
  ["K4o", 12], ["K3o", 12], ["K2o", 12],
  ["Q7o", 12], ["Q6o", 12], ["Q5o", 12], ["Q4o", 12], ["Q3o", 12], ["Q2o", 12],
  ["J7o", 12], ["J6o", 12], ["J5o", 12], ["J4o", 12], ["J3o", 12], ["J2o", 12],
  ["T7o", 12], ["T6o", 12], ["T5o", 12], ["T4o", 12], ["T3o", 12], ["T2o", 12],
  ["96o", 12], ["95o", 12], ["94o", 12], ["93o", 12], ["92o", 12],
  ["85o", 12], ["84o", 12], ["83o", 12], ["82o", 12],
  ["74o", 12], ["73o", 12], ["72o", 12],
  ["63o", 12], ["62o", 12], ["52o", 12], ["42o", 12], ["32o", 12],
];

// Total combos in a full 1326-combo deck (sanity check: pairs 6×13=78, suited 4×78=312,
// offsuit 12×78=936; total = 78+312+936=1326)

// Build flat array of combo strings ordered by strength (precomputed)
let _orderedCombos: string[] | null = null;

function getOrderedCombos(): string[] {
  if (_orderedCombos) return _orderedCombos;
  const result: string[] = [];
  for (const [hand, count] of HAND_ORDER) {
    // Expand hand notation into combo strings.
    // Each combo string is just the hand class notation (e.g. "AKs") × count.
    // The equity API receives these and uses them as range identifiers.
    for (let i = 0; i < count; i++) {
      result.push(hand);
    }
  }
  _orderedCombos = result;
  return result;
}

/**
 * Map a VPIP percentage to a VillainRange.
 *
 * @param vpip       VPIP as 0–100 (e.g. 25 for 25%)
 * @param confidence 0–1 confidence in the estimate (based on sample size)
 */
export function vpipToRange(vpip: number, confidence: number): VillainRange {
  const ordered = getOrderedCombos();
  const totalCombos = 1326;
  const targetCount = Math.round((vpip / 100) * totalCombos);
  const combos = ordered.slice(0, Math.max(1, targetCount));

  return {
    combos,
    vpipSource: vpip,
    confidence,
    source: "vpip_derived",
  };
}

/** Default villain range: all hands (random). Used when no history available. */
export const DEFAULT_VILLAIN_RANGE: VillainRange = {
  combos: getOrderedCombos(),
  vpipSource: 100,
  confidence: 0.5,
  source: "default_random",
};

/**
 * Scale confidence based on sample size.
 * Below 8 hands: confidence < 0.5 (should fall back to default range).
 * 30+ hands: full confidence.
 */
export function sampleConfidence(handsObserved: number): number {
  if (handsObserved <= 0) return 0;
  if (handsObserved >= 30) return 1.0;
  return handsObserved / 30;
}
