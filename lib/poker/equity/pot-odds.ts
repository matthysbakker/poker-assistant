/**
 * Pot odds calculation.
 * Returns the minimum equity needed to profitably call.
 */

/**
 * Compute pot odds as the break-even equity to call a bet.
 *
 * @param callAmount  Amount hero must call (in €)
 * @param potAfterCall  Total pot after hero calls (pot + bet + call)
 * @returns Required equity (0–1) to break even on the call
 */
export function computePotOdds(callAmount: number, potBeforeCall: number): number {
  if (callAmount <= 0) return 0;
  const potAfterCall = potBeforeCall + callAmount;
  return callAmount / potAfterCall;
}

/**
 * Parse a currency string like "€0.06" or "0.06" into a number.
 * Returns 0 for empty/invalid strings.
 */
export function parseCurrency(s: string | null | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[€$£,]/g, ""));
  return isNaN(n) ? 0 : n;
}
