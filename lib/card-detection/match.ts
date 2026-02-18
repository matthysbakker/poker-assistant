import sharp from "sharp";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { CardCode, CardGroup, CardMatch, LocatedCard } from "./types";
import {
  preprocessCrop,
  compareBinary,
  OUTPUT_W,
  OUTPUT_H,
} from "./preprocess";
import { getResolutionBucket } from "./locate";

const REFERENCES_DIR = join(process.cwd(), "data/card-references-v2");

/**
 * Reference cache: group → bucket → cardCode → preprocessed buffer variants.
 * Each card can have multiple reference variants (from different board positions).
 * Populated lazily on first match for each group/bucket combination.
 */
const refCache = new Map<string, Map<CardCode, Buffer[]>>();

/** Cache key for a group + bucket. */
function cacheKey(group: CardGroup, bucket: string): string {
  return `${group}/${bucket}`;
}

/** Get the directory path for a specific group/bucket's references. */
function refDir(group: CardGroup, bucket: string): string {
  return join(REFERENCES_DIR, group, bucket);
}

/** Load preprocessed references for a specific group and resolution bucket. */
function loadRefs(group: CardGroup, bucket: string): Map<CardCode, Buffer[]> {
  const key = cacheKey(group, bucket);
  if (refCache.has(key)) return refCache.get(key)!;

  const refs = new Map<CardCode, Buffer[]>();
  const dir = refDir(group, bucket);

  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => f.endsWith(".bin"));
    for (const file of files) {
      // Files are named <card>_<idx>.bin (e.g. "Jc_0.bin", "10h_1.bin")
      const card = file.replace(/_\d+\.bin$/, "") as CardCode;
      if (!refs.has(card)) refs.set(card, []);
      refs.get(card)!.push(readFileSync(join(dir, file)));
    }
  }

  refCache.set(key, refs);
  return refs;
}

/** Invalidate the reference cache (call after adding new references). */
export function clearReferenceCache() {
  refCache.clear();
}

/** Crop a card's corner from an image. */
export async function cropCorner(
  imageBuffer: Buffer,
  card: LocatedCard,
): Promise<Buffer> {
  return sharp(imageBuffer)
    .extract({
      left: card.corner.x,
      top: card.corner.y,
      width: card.corner.width,
      height: card.corner.height,
    })
    .toBuffer();
}

/**
 * Match a preprocessed card crop against group-based references.
 *
 * Confidence levels (tuned for greyscale comparison):
 *   HIGH:   match > 90% AND gap to second-best > 7%
 *   MEDIUM: match > 85% AND gap > 3%
 *   LOW:    match > 75% (possible match but uncertain)
 *   NONE:   no references or no match above threshold
 */
export function matchCard(
  preprocessed: Buffer,
  group: CardGroup,
  cardWidth: number,
): CardMatch {
  const bucket = getResolutionBucket(cardWidth);
  const refs = loadRefs(group, bucket);

  if (refs.size === 0) {
    return {
      region: group,
      card: null,
      confidence: "NONE",
      matchScore: 0,
      gap: 0,
    };
  }

  // Find best score per card (across all variants of that card)
  const cardBestScores = new Map<CardCode, number>();
  for (const [card, refBufs] of refs) {
    let cardBest = 0;
    for (const refBuf of refBufs) {
      const score = compareBinary(preprocessed, refBuf);
      if (score > cardBest) cardBest = score;
    }
    cardBestScores.set(card, cardBest);
  }

  // Find best and second-best cards (gap = distance between different cards)
  let bestCard: CardCode | null = null;
  let bestScore = 0;
  let secondBestScore = 0;

  for (const [card, score] of cardBestScores) {
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestCard = card;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  const gap = bestScore - secondBestScore;
  let confidence: CardMatch["confidence"];

  if (bestScore > 0.90 && gap > 0.07) {
    confidence = "HIGH";
  } else if (bestScore > 0.85 && gap > 0.03) {
    confidence = "MEDIUM";
  } else if (bestScore > 0.75) {
    confidence = "LOW";
  } else {
    confidence = "NONE";
  }

  return {
    region: group,
    card: confidence !== "NONE" ? bestCard : null,
    confidence,
    matchScore: Math.round(bestScore * 1000) / 1000,
    gap: Math.round(gap * 1000) / 1000,
  };
}

/**
 * Save a preprocessed crop as a reference variant for a specific group and resolution.
 * Multiple variants per card are supported (from different board positions).
 * Files are named <card>_<idx>.bin (e.g. "Jc_0.bin", "Jc_1.bin").
 */
export function saveReference(
  preprocessed: Buffer,
  group: CardGroup,
  cardWidth: number,
  cardCode: CardCode,
): void {
  const bucket = getResolutionBucket(cardWidth);
  const dir = refDir(group, bucket);
  mkdirSync(dir, { recursive: true });

  // Find next available variant index for this card
  const existing = readdirSync(dir).filter(
    (f) => f.startsWith(`${cardCode}_`) && f.endsWith(".bin"),
  );
  const idx = existing.length;

  const filePath = join(dir, `${cardCode}_${idx}.bin`);
  writeFileSync(filePath, preprocessed);

  // Invalidate cache
  const key = cacheKey(group, bucket);
  refCache.delete(key);
}

export { preprocessCrop, OUTPUT_W, OUTPUT_H };
