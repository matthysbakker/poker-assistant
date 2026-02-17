import sharp from "sharp";
import { getRegions } from "./regions";
import { cropRegion, isEmptyRegion, matchCard } from "./match";
import { preprocessCrop } from "./preprocess";
import type { CardMatch, DetectionResult } from "./types";

/** Detect cards from a base64-encoded screenshot. */
export async function detectCards(base64: string): Promise<DetectionResult> {
  const start = performance.now();
  const imageBuffer = Buffer.from(base64, "base64");

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  const { hero, community } = getRegions(width, height);

  // Detect hero cards (always 2 positions)
  const heroCards: CardMatch[] = [];
  for (const region of hero) {
    const cropPng = await cropRegion(imageBuffer, region);
    if (await isEmptyRegion(cropPng)) continue;

    const preprocessed = await preprocessCrop(cropPng);
    if (!preprocessed) continue;

    const match = matchCard(preprocessed, region.name, width);
    heroCards.push(match);
  }

  // Detect community cards (up to 5 positions, skip empty slots)
  const communityCards: CardMatch[] = [];
  for (const region of community) {
    const cropPng = await cropRegion(imageBuffer, region);
    if (await isEmptyRegion(cropPng)) continue;

    const preprocessed = await preprocessCrop(cropPng);
    if (!preprocessed) continue;

    const match = matchCard(preprocessed, region.name, width);
    // Skip LOW/NONE — likely empty positions with table graphics
    if (match.confidence === "LOW" || match.confidence === "NONE") continue;
    communityCards.push(match);
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
