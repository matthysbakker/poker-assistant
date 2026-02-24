/**
 * Implied odds bonus.
 *
 * Implied odds account for money we can win on future streets when we hit our draw.
 * At micro-stakes (€0.01/€0.02) opponents don't fold often, so implied odds are real.
 *
 * The bonus adjusts the effective equity upward when calling is otherwise marginal.
 */

/**
 * Compute an implied-odds bonus to add to raw equity.
 *
 * Assumptions:
 * - Hidden draws (flush/backdoor flush) get a larger bonus because opponents
 *   can't put us on them easily.
 * - Obvious straight draws get a smaller bonus (opponents can see the board).
 * - SPR matters: deep stacks mean more money to win.
 *
 * @param flushOuts     flush out count (0, 2 backdoor, or 9 flush draw)
 * @param straightOuts  straight out count (0, 4 gutshot, or 8 OESD)
 * @param spr           stack-to-pot ratio
 * @returns  Equity bonus (0.0–0.15) to add to exactOutEquity
 */
export function impliedOddsBonus(flushOuts: number, straightOuts: number, spr: number): number {
  let bonus = 0;

  if (flushOuts === 9) {
    // Flush draw — hidden, good implied odds
    bonus += 0.06;
  } else if (flushOuts === 2) {
    // Backdoor flush — 2 streets, smaller bonus
    bonus += 0.02;
  }

  if (straightOuts === 8) {
    // OESD — visible draw, moderate implied odds
    bonus += 0.04;
  } else if (straightOuts === 4) {
    // Gutshot — harder to hit, but opponents may not suspect it
    bonus += 0.02;
  }

  // Deep stacks multiply implied odds
  const sprFactor = spr >= 10 ? 1.3 : spr >= 6 ? 1.1 : 1.0;
  return Math.min(0.15, bonus * sprFactor);
}
