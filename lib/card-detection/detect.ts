import sharp from "sharp";
import { locateCards } from "./locate";
import { cropCorner, matchCard } from "./match";
import { preprocessCrop } from "./preprocess";
import { detectActionButtons } from "./buttons";
import { detectDealerButton } from "./dealer-button";
import type { CardMatch, DetectionResult, Position } from "./types";

/**
 * Position labels in clockwise order from dealer button.
 * Index 0 = dealer (BTN), 1 = SB, 2 = BB, 3 = UTG, 4 = MP, 5 = CO.
 */
const POSITIONS_6MAX: Position[] = ["BTN", "SB", "BB", "UTG", "MP", "CO"];

/** Map dealer seat number (0-5) to hero's position label. */
export function heroPosition(dealerSeat: number): Position {
  return POSITIONS_6MAX[(6 - dealerSeat) % 6];
}

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

  const [cardResults, heroTurn, dealerResult] = await Promise.all([
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
    detectDealerButton(imageBuffer),
  ]);

  const heroCards: CardMatch[] = [];
  const communityCards: CardMatch[] = [];

  for (const r of cardResults) {
    if (!r) continue;
    if (r.group === "hero") heroCards.push(r.match);
    else communityCards.push(r.match);
  }

  const timing = Math.round(performance.now() - start);
  const position = dealerResult !== null ? heroPosition(dealerResult) : null;

  return {
    heroCards,
    communityCards,
    detectedText: formatDetectionSummary(heroCards, communityCards, position),
    heroTurn,
    heroPosition: position,
    timing,
  };
}

/**
 * Format detection summary for Claude's system prompt.
 *
 * Includes position, hero cards, and community cards.
 * Only HIGH/MEDIUM confidence cards are included. Cards that couldn't
 * be matched are omitted — Claude reads them from the image naturally.
 */
function formatDetectionSummary(
  hero: CardMatch[],
  community: CardMatch[],
  position: Position | null,
): string {
  if (hero.length === 0 && community.length === 0 && !position) return "";

  const parts: string[] = [];

  if (position) {
    parts.push(`Hero position: ${position}`);
  }

  if (hero.length > 0) {
    parts.push(`Hero: ${hero.map((m) => m.card ?? "[unreadable]").join(" ")}`);
  }

  if (community.length > 0) {
    parts.push(`Board: ${community.map((m) => m.card ?? "[unreadable]").join(" ")}`);
  }

  return parts.join(", ");
}
