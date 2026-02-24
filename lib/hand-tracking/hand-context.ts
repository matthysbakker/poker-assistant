/**
 * Parses DOM-scraped card data from the handContext string.
 * The poker client renders cards as SVG filenames — 100% accurate ground truth.
 * Format: "Hero holds: 6d Qs" and "Board: Jh Qd 5c"
 *
 * IMPORTANT: Keep in sync with buildHandContext in use-hand-tracker.ts
 */
export function parseDomCards(handContext: string | undefined): {
  heroCards: string[];
  communityCards: string[];
} {
  if (!handContext) return { heroCards: [], communityCards: [] };

  const heroMatch = handContext.match(/Hero holds:\s+([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?)/);
  const boardMatch = handContext.match(/Board:\s+([A-Za-z0-9 ]+?)(?:\s*\n|$)/m);

  return {
    heroCards: heroMatch ? heroMatch[1].trim().split(/\s+/).filter(Boolean) : [],
    communityCards: boardMatch ? boardMatch[1].trim().split(/\s+/).filter(Boolean) : [],
  };
}
