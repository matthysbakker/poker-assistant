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
  // Strip currency symbols and thousands separators, then normalise decimal comma → dot.
  // European format: "€28,99" → "28.99"  (comma is the decimal separator)
  // US format:       "$1,234.56" → "1234.56" (comma is thousands separator)
  // Heuristic: if the string has a comma but no dot, treat the comma as decimal.
  let cleaned = s.replace(/[€$£]/g, "").trim();
  if (cleaned.includes(",") && !cleaned.includes(".")) {
    // Only a comma present — it's the decimal separator (e.g. "28,99")
    cleaned = cleaned.replace(",", ".");
  } else {
    // Dot present, or no comma — strip commas as thousands separators
    cleaned = cleaned.replace(/,/g, "");
  }
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}
