import sharp from "sharp";
import { locateCards } from "./locate";
import { cropCorner, matchCard } from "./match";
import { preprocessCrop } from "./preprocess";
import type { CardMatch, DetectionResult } from "./types";

/** Detect cards from a base64-encoded screenshot. */
export async function detectCards(base64: string): Promise<DetectionResult> {
  const start = performance.now();
  const imageBuffer = Buffer.from(base64, "base64");

  const isConfident = (m: CardMatch) =>
    m.confidence === "HIGH" || m.confidence === "MEDIUM";

  // Step 1: Locate cards dynamically
  const cards = await locateCards(imageBuffer);

  // Step 2: For each located card, crop corner → preprocess → match
  const heroCards: CardMatch[] = [];
  const communityCards: CardMatch[] = [];

  for (const card of cards) {
    const cornerCrop = await cropCorner(imageBuffer, card);
    const preprocessed = await preprocessCrop(cornerCrop);
    if (!preprocessed) continue;

    const match = matchCard(preprocessed, card.group, card.width);
    if (!isConfident(match)) continue;

    if (card.group === "hero") {
      heroCards.push(match);
    } else {
      communityCards.push(match);
    }
  }

  const timing = Math.round(performance.now() - start);

  return {
    heroCards,
    communityCards,
    detectedText: formatDetectedCards(heroCards, communityCards),
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
