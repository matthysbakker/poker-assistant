/**
 * Converts hero card strings (e.g. "Ah Kd") to standard hand notation (e.g. "AKo")
 * for preflop chart lookups.
 *
 * The 169 unique starting hands use this notation:
 * - Pairs: "AA", "KK", ..., "22"
 * - Suited: "AKs", "AQs", ..., "32s"
 * - Offsuit: "AKo", "AQo", ..., "32o"
 */

const RANK_ORDER = "AKQJT98765432";

/** Map card rank from AI format to chart format. "10" → "T", everything else stays. */
function normalizeRank(rank: string): string {
  return rank === "10" ? "T" : rank;
}

/** Parse a card code like "Ah" or "10d" into { rank, suit }. */
function parseCard(code: string): { rank: string; suit: string } | null {
  const match = code.match(/^(10|[2-9AKQJT])([cdhs])$/i);
  if (!match) return null;
  return { rank: normalizeRank(match[1].toUpperCase()), suit: match[2].toLowerCase() };
}

/**
 * Convert hero cards string to standard hand notation.
 *
 * @example toHandNotation("Ah Kd") → "AKo"
 * @example toHandNotation("10h 9s") → "T9o"
 * @example toHandNotation("As Ac") → "AA"
 */
export function toHandNotation(heroCards: string): string | null {
  const parts = heroCards.trim().split(/\s+/);
  if (parts.length !== 2) return null;

  const card1 = parseCard(parts[0]);
  const card2 = parseCard(parts[1]);
  if (!card1 || !card2) return null;

  const idx1 = RANK_ORDER.indexOf(card1.rank);
  const idx2 = RANK_ORDER.indexOf(card2.rank);
  if (idx1 === -1 || idx2 === -1) return null;

  // Sort so higher rank comes first
  const [high, low] = idx1 <= idx2 ? [card1, card2] : [card2, card1];

  // Pair — no suffix
  if (high.rank === low.rank) {
    return `${high.rank}${low.rank}`;
  }

  // Suited or offsuit
  const suffix = high.suit === low.suit ? "s" : "o";
  return `${high.rank}${low.rank}${suffix}`;
}

/** All 169 unique hand keys in standard order. */
export function allHandKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < RANK_ORDER.length; i++) {
    for (let j = i; j < RANK_ORDER.length; j++) {
      if (i === j) {
        keys.push(`${RANK_ORDER[i]}${RANK_ORDER[j]}`);
      } else {
        keys.push(`${RANK_ORDER[i]}${RANK_ORDER[j]}s`);
        keys.push(`${RANK_ORDER[i]}${RANK_ORDER[j]}o`);
      }
    }
  }
  return keys;
}
