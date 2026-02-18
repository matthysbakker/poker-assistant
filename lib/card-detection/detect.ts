import sharp from "sharp";
import { locateCards } from "./locate";
import { cropCorner, matchCard } from "./match";
import { preprocessCrop } from "./preprocess";
import { detectActionButtons } from "./buttons";
import type { CardMatch, DetectionResult } from "./types";

/** Detect cards from a base64-encoded screenshot. */
export async function detectCards(base64: string): Promise<DetectionResult> {
  const start = performance.now();
  const imageBuffer = Buffer.from(base64, "base64");

  const isConfident = (m: CardMatch) =>
    m.confidence === "HIGH" || m.confidence === "MEDIUM";

  // Step 1: Locate cards dynamically
  const cards = await locateCards(imageBuffer);

  // Step 2: Process all cards in parallel and detect buttons concurrently.
  // Skip button detection when no hero-group blobs were found.
  const hasHeroBlobs = cards.some((c) => c.group === "hero");

  const [cardResults, heroTurn] = await Promise.all([
    Promise.all(
      cards.map(async (card) => {
        const cornerCrop = await cropCorner(imageBuffer, card);
        const preprocessed = await preprocessCrop(cornerCrop);
        if (!preprocessed) return null;

        const match = matchCard(preprocessed, card.group);
        if (!isConfident(match)) return null;

        return { match, group: card.group };
      }),
    ),
    hasHeroBlobs ? detectActionButtons(imageBuffer) : Promise.resolve(false),
  ]);

  const heroCards: CardMatch[] = [];
  const communityCards: CardMatch[] = [];

  for (const r of cardResults) {
    if (!r) continue;
    if (r.group === "hero") heroCards.push(r.match);
    else communityCards.push(r.match);
  }

  const timing = Math.round(performance.now() - start);

  return {
    heroCards,
    communityCards,
    detectedText: formatDetectedCards(heroCards, communityCards),
    heroTurn,
    timing,
  };
}

/**
 * Format detected cards for Claude's system prompt.
 *
 * Only HIGH/MEDIUM confidence cards are included. Cards that couldn't
 * be matched are omitted — Claude reads them from the image naturally.
 */
function formatDetectedCards(
  hero: CardMatch[],
  community: CardMatch[],
): string {
  if (hero.length === 0 && community.length === 0) return "";

  const parts: string[] = [];

  if (hero.length > 0) {
    parts.push(`Hero: ${hero.map((m) => m.card ?? "[unreadable]").join(" ")}`);
  }

  if (community.length > 0) {
    parts.push(`Board: ${community.map((m) => m.card ?? "[unreadable]").join(" ")}`);
  }

  return parts.join(", ");
}
