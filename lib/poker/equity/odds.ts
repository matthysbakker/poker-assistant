/**
 * Exact out equity calculation using the standard rule-of-2/4 approximation
 * refined to match actual combinatorial probabilities.
 *
 * Exact formula:
 *   1 street remaining:  outs / (52 - seen_cards)
 *   2 streets remaining: 1 - ((52-seen-outs)/52-seen) * ((51-seen-outs)/(51-seen))
 */

/**
 * Compute exact equity (probability of hitting) for a given number of outs.
 *
 * @param outs          Number of clean outs
 * @param cardsSeenCount  Number of cards already seen (hero 2 + community)
 * @param streetsLeft   1 (river) or 2 (turn+river)
 */
export function exactOutEquity(outs: number, cardsSeenCount: number, streetsLeft: 1 | 2): number {
  if (outs <= 0) return 0;
  const remaining = 52 - cardsSeenCount;
  if (remaining <= 0) return 0;

  if (streetsLeft === 1) {
    return Math.min(1, outs / remaining);
  }

  // Two streets: exact probability = 1 - P(miss turn) * P(miss river | missed turn)
  const missTurn = (remaining - outs) / remaining;
  const missRiver = (remaining - 1 - outs) / (remaining - 1);
  return Math.min(1, 1 - missTurn * missRiver);
}
