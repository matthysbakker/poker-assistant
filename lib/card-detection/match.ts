import sharp from "sharp";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { CardCode, CardMatch, CardRegion } from "./types";
import {
  preprocessCrop,
  compareBinary,
  OUTPUT_W,
  OUTPUT_H,
} from "./preprocess";

const REFERENCES_DIR = join(process.cwd(), "data/card-references");

/**
 * Reference cache: imageWidth → slotName → cardCode → preprocessed buffer.
 * Populated lazily on first match for each width/slot combination.
 */
const refCache = new Map<number, Map<string, Map<CardCode, Buffer>>>();

/** Get the directory path for a specific slot's references. */
function slotDir(imageWidth: number, slotName: string): string {
  return join(REFERENCES_DIR, String(imageWidth), slotName);
}

/** Load preprocessed references for a specific slot. */
function loadSlotRefs(
  imageWidth: number,
  slotName: string,
): Map<CardCode, Buffer> {
  // Check cache
  let widthCache = refCache.get(imageWidth);
  if (widthCache?.has(slotName)) return widthCache.get(slotName)!;

  // Load from disk
  const refs = new Map<CardCode, Buffer>();
  const dir = slotDir(imageWidth, slotName);

  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => f.endsWith(".bin"));
    for (const file of files) {
      const card = file.replace(".bin", "") as CardCode;
      refs.set(card, readFileSync(join(dir, file)));
    }
  }

  // Cache
  if (!widthCache) {
    widthCache = new Map();
    refCache.set(imageWidth, widthCache);
  }
  widthCache.set(slotName, refs);

  return refs;
}

/** Invalidate the reference cache (call after adding new references). */
export function clearReferenceCache() {
  refCache.clear();
}

/** Crop a region from an image and return as PNG buffer. */
export async function cropRegion(
  imageBuffer: Buffer,
  region: CardRegion,
): Promise<Buffer> {
  return sharp(imageBuffer)
    .extract({
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
    })
    .toBuffer();
}

/** Crop a region and save as PNG (for calibration/debugging). */
export async function cropRegionToFile(
  imageBuffer: Buffer,
  region: CardRegion,
  outputPath: string,
): Promise<void> {
  await sharp(imageBuffer)
    .extract({
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
    })
    .toFile(outputPath);
}

/** Check if a cropped PNG region is empty (no card present). */
export async function isEmptyRegion(cropPng: Buffer): Promise<boolean> {
  const { data } = await sharp(cropPng)
    .resize(20, 30) // Small size for fast brightness check
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let totalBrightness = 0;
  const pixelCount = data.length / 3;
  for (let i = 0; i < data.length; i += 3) {
    totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }

  return totalBrightness / pixelCount < 80;
}

/**
 * Match a preprocessed card crop against slot-specific references.
 *
 * Confidence levels:
 *   HIGH:   match > 90% AND gap to second-best > 10%
 *   MEDIUM: match > 85% AND gap > 5%
 *   LOW:    match > 75% (possible match but uncertain)
 *   NONE:   no references or no match above threshold
 */
export function matchCard(
  preprocessed: Buffer,
  slotName: string,
  imageWidth: number,
): CardMatch {
  const refs = loadSlotRefs(imageWidth, slotName);

  if (refs.size === 0) {
    return {
      region: slotName,
      card: null,
      confidence: "NONE",
      matchScore: 0,
      gap: 0,
    };
  }

  let bestCard: CardCode | null = null;
  let bestScore = 0;
  let secondBestScore = 0;

  for (const [card, refBuf] of refs) {
    const score = compareBinary(preprocessed, refBuf);
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

  if (bestScore > 0.90 && gap > 0.10) {
    confidence = "HIGH";
  } else if (bestScore > 0.85 && gap > 0.05) {
    confidence = "MEDIUM";
  } else if (bestScore > 0.75) {
    confidence = "LOW";
  } else {
    confidence = "NONE";
  }

  return {
    region: slotName,
    card: confidence !== "NONE" ? bestCard : null,
    confidence,
    matchScore: Math.round(bestScore * 1000) / 1000,
    gap: Math.round(gap * 1000) / 1000,
  };
}

/**
 * Save a preprocessed crop as a reference for a specific slot.
 * Called when Claude Vision identifies a card — auto-learn for future matching.
 */
export function saveReference(
  preprocessed: Buffer,
  slotName: string,
  imageWidth: number,
  cardCode: CardCode,
): void {
  const dir = slotDir(imageWidth, slotName);
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, `${cardCode}.bin`);
  writeFileSync(filePath, preprocessed);

  // Invalidate cache for this slot so it reloads on next match
  const widthCache = refCache.get(imageWidth);
  if (widthCache) widthCache.delete(slotName);
}

export { preprocessCrop, OUTPUT_W, OUTPUT_H };
