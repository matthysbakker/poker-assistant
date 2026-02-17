/**
 * Test: Find card boundary → extract rank/suit zones proportionally → compare.
 *
 * The hypothesis: once we find the card's white area, the rank and suit
 * are at consistent PROPORTIONAL positions regardless of card size.
 * Extracting by proportion then resizing normalizes the scale.
 *
 * Usage: bun run scripts/validate-glyph-extract.ts
 */

import sharp from "sharp";
import { mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";

const CORNERS_DIR = "test/extracted-corners";
const OUTPUT_DIR = "test/glyph-validation";
const RANK_W = 50;
const RANK_H = 70;
const SUIT_W = 40;
const SUIT_H = 40;

mkdirSync(join(OUTPUT_DIR, "rank"), { recursive: true });
mkdirSync(join(OUTPUT_DIR, "suit"), { recursive: true });

/**
 * Find the card boundary within a corner crop.
 * Cards have a white/bright background; table felt is dark.
 * Returns the pixel coordinates of the card area.
 */
function findCardBounds(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
): { left: number; top: number; right: number; bottom: number } {
  const brightness = (x: number, y: number) => {
    const i = (y * width + x) * channels;
    return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
  };

  const BRIGHT_THRESHOLD = 170;

  // Find left edge: first column where >40% of pixels are bright
  let left = 0;
  for (let x = 0; x < width; x++) {
    let bright = 0;
    for (let y = 0; y < height; y++) {
      if (brightness(x, y) > BRIGHT_THRESHOLD) bright++;
    }
    if (bright / height > 0.4) {
      left = x;
      break;
    }
  }

  // Find top edge: first row where >40% of pixels are bright
  let top = 0;
  for (let y = 0; y < height; y++) {
    let bright = 0;
    for (let x = left; x < width; x++) {
      if (brightness(x, y) > BRIGHT_THRESHOLD) bright++;
    }
    if (bright / (width - left) > 0.4) {
      top = y;
      break;
    }
  }

  // Right and bottom: use full extent (card extends to crop edge)
  return { left, top, right: width, bottom: height };
}

/**
 * Extract rank and suit zones from a card corner crop.
 * 1. Find the card boundary (where white area begins)
 * 2. Take proportional sub-regions for rank and suit
 * 3. Binarize and resize to standard dimensions
 */
async function extractZones(
  inputPath: string,
): Promise<{ rank: Buffer; suit: Buffer } | null> {
  // Load original at a consistent working size
  const WORK_W = 120;
  const WORK_H = 180;
  const { data, info } = await sharp(inputPath)
    .resize(WORK_W, WORK_H)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bounds = findCardBounds(data, WORK_W, WORK_H, 3);
  const cardW = bounds.right - bounds.left;
  const cardH = bounds.bottom - bounds.top;

  if (cardW < 20 || cardH < 30) return null; // Too small, probably empty

  // Rank zone: top 55% of card area, full width
  const rankRegion = {
    left: bounds.left,
    top: bounds.top,
    width: Math.min(cardW, WORK_W - bounds.left),
    height: Math.round(cardH * 0.55),
  };

  // Suit zone: bottom 45% of card area, left half (suit symbol is left-aligned)
  const suitTop = bounds.top + Math.round(cardH * 0.5);
  const suitRegion = {
    left: bounds.left,
    top: suitTop,
    width: Math.min(Math.round(cardW * 0.6), WORK_W - bounds.left),
    height: Math.min(Math.round(cardH * 0.45), WORK_H - suitTop),
  };

  // Two-step: resize first (sharp applies extract BEFORE resize in pipeline)
  const resizedBuf = await sharp(inputPath).resize(WORK_W, WORK_H).toBuffer();

  // Extract rank zone: binarize and resize
  const { data: rankData } = await sharp(resizedBuf)
    .extract(rankRegion)
    .greyscale()
    .normalise()
    .threshold(128)
    .resize(RANK_W, RANK_H)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Extract suit zone: binarize and resize
  const { data: suitData } = await sharp(resizedBuf)
    .extract(suitRegion)
    .greyscale()
    .normalise()
    .threshold(128)
    .resize(SUIT_W, SUIT_H)
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { rank: rankData, suit: suitData };
}

/** Save extracted zones as PNGs for inspection. */
async function saveZones(inputPath: string, baseName: string): Promise<void> {
  const WORK_W = 120;
  const WORK_H = 180;
  const { data } = await sharp(inputPath)
    .resize(WORK_W, WORK_H)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bounds = findCardBounds(data, WORK_W, WORK_H, 3);
  const cardW = bounds.right - bounds.left;
  const cardH = bounds.bottom - bounds.top;

  if (cardW < 20 || cardH < 30) return;

  const rankRegion = {
    left: bounds.left,
    top: bounds.top,
    width: Math.min(cardW, WORK_W - bounds.left),
    height: Math.round(cardH * 0.55),
  };

  const suitTop = bounds.top + Math.round(cardH * 0.5);
  const suitRegion = {
    left: bounds.left,
    top: suitTop,
    width: Math.min(Math.round(cardW * 0.6), WORK_W - bounds.left),
    height: Math.min(Math.round(cardH * 0.45), WORK_H - suitTop),
  };

  const resizedBuf = await sharp(inputPath).resize(WORK_W, WORK_H).toBuffer();

  await sharp(resizedBuf)
    .extract(rankRegion)
    .greyscale()
    .normalise()
    .threshold(128)
    .resize(RANK_W, RANK_H)
    .toFile(join(OUTPUT_DIR, "rank", baseName));

  await sharp(resizedBuf)
    .extract(suitRegion)
    .greyscale()
    .normalise()
    .threshold(128)
    .resize(SUIT_W, SUIT_H)
    .toFile(join(OUTPUT_DIR, "suit", baseName));
}

function compareBinary(a: Buffer, b: Buffer): number {
  let matching = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) matching++;
  }
  return matching / len;
}

// Ground truth
const GROUND_TRUTH: Record<string, Record<string, string>> = {
  "2026-02-17T13-37-28-840Z": { heroL: "Kc", heroR: "Jd" },
  "2026-02-17T13-37-56-433Z": { heroL: "Kc", heroR: "Jd", comm1: "Ah", comm2: "4h", comm3: "Jc" },
  "2026-02-17T13-38-53-206Z": { heroL: "8c", heroR: "Qc" },
  "2026-02-17T13-39-01-369Z": { heroL: "8c", heroR: "Qc" },
  "2026-02-17T13-39-46-183Z": { heroL: "8c", heroR: "Qc", comm1: "Jc", comm2: "5c", comm3: "2s", comm4: "3d" },
  "2026-02-17T13-40-46-504Z": { heroL: "Qh", heroR: "10h" },
  "2026-02-17T13-41-08-096Z": { heroL: "Qh", heroR: "10h", comm1: "Kc", comm2: "4h", comm3: "9h" },
  "2026-02-17T13-41-25-899Z": { heroL: "Qh", heroR: "10h", comm1: "Kc", comm2: "4h", comm3: "9h", comm4: "Qs" },
  "2026-02-17T13-44-37-752Z": { heroL: "Qd", heroR: "Qs" },
  "2026-02-17T14-25-45-727Z": { heroL: "3d", heroR: "5c" },
  "2026-02-17T14-26-05-475Z": { heroL: "Ah", heroR: "Jd" },
  "2026-02-17T14-26-56-012Z": { heroL: "Ah", heroR: "Jd", comm1: "Qc", comm2: "10h", comm3: "5h" },
  "2026-02-17T14-27-22-803Z": { heroL: "Ah", heroR: "Jd", comm1: "Qc", comm2: "10h", comm3: "5h", comm4: "Kh" },
  "2026-02-17T14-28-23-356Z": { heroL: "4s", heroR: "3s" },
  "2026-02-17T14-31-56-491Z": { heroL: "4c", heroR: "7h" },
  "2026-02-17T14-35-15-232Z": { heroL: "Kh", heroR: "6h", comm1: "2c", comm2: "4d", comm3: "3s" },
  "2026-02-17T14-36-28-902Z": { heroL: "Ks", heroR: "Kd" },
  "2026-02-17T22-03-53-545Z": { heroL: "Qc", heroR: "3c" },
};

interface CardInstance {
  file: string;
  path: string;
  region: string;
  timestamp: string;
  resolution: "high" | "low";
}

const files = readdirSync(CORNERS_DIR).filter((f) => f.endsWith(".png")).sort();
const cardInstances = new Map<string, CardInstance[]>();

for (const file of files) {
  const base = basename(file, ".png");
  const underscoreIdx = base.indexOf("_");
  if (underscoreIdx === -1) continue;
  const region = base.substring(0, underscoreIdx);
  const timestamp = base.substring(underscoreIdx + 1);
  const truth = GROUND_TRUTH[timestamp];
  if (!truth || !truth[region]) continue;
  const card = truth[region];
  const resolution = timestamp.startsWith("2026-02-17T13-") ? "high" : "low";
  if (!cardInstances.has(card)) cardInstances.set(card, []);
  cardInstances.get(card)!.push({ file, path: join(CORNERS_DIR, file), region, timestamp, resolution });
}

// Save zone crops for inspection
console.log("Extracting rank/suit zones...\n");
let saved = 0;
let errors = 0;

for (const file of files) {
  try {
    await saveZones(join(CORNERS_DIR, file), file);
    saved++;
  } catch (e: any) {
    errors++;
  }
}
console.log(`Saved: ${saved}, Errors: ${errors}\n`);

// --- Cross-position comparison (the critical test) ---
console.log("=== CROSS-POSITION: RANK ZONE ===\n");

for (const [card, instances] of cardInstances) {
  const heroes = instances.filter((i) => i.region.startsWith("hero"));
  const comms = instances.filter((i) => i.region.startsWith("comm"));
  if (heroes.length === 0 || comms.length === 0) continue;

  const h = heroes[0];
  const c = comms[0];
  try {
    const hZones = await extractZones(h.path);
    const cZones = await extractZones(c.path);
    if (!hZones || !cZones) continue;

    const rankScore = compareBinary(hZones.rank, cZones.rank);
    const suitScore = compareBinary(hZones.suit, cZones.suit);
    const rank = card.slice(0, -1);
    const suit = card.slice(-1);

    const rStatus = rankScore > 0.90 ? "GREAT" : rankScore > 0.80 ? "OK   " : "FAIL ";
    const sStatus = suitScore > 0.90 ? "GREAT" : suitScore > 0.80 ? "OK   " : "FAIL ";
    console.log(
      `  ${card.padEnd(4)} rank=${rank.padEnd(2)} ${rStatus} ${(rankScore * 100).toFixed(1)}%  ` +
      `suit=${suit} ${sStatus} ${(suitScore * 100).toFixed(1)}%  ` +
      `(${h.region} vs ${c.region})`
    );
  } catch {
    console.log(`  ${card.padEnd(4)} ERROR`);
  }
}

// --- Cross-resolution comparison ---
console.log("\n=== CROSS-RESOLUTION: RANK ZONE ===\n");

for (const [card, instances] of cardInstances) {
  const highRes = instances.filter((i) => i.resolution === "high");
  const lowRes = instances.filter((i) => i.resolution === "low");
  if (highRes.length === 0 || lowRes.length === 0) continue;

  const h = highRes[0];
  const l = lowRes[0];
  try {
    const hZones = await extractZones(h.path);
    const lZones = await extractZones(l.path);
    if (!hZones || !lZones) continue;

    const rankScore = compareBinary(hZones.rank, lZones.rank);
    const suitScore = compareBinary(hZones.suit, lZones.suit);

    const rStatus = rankScore > 0.90 ? "GREAT" : rankScore > 0.80 ? "OK   " : "FAIL ";
    const sStatus = suitScore > 0.90 ? "GREAT" : suitScore > 0.80 ? "OK   " : "FAIL ";
    console.log(
      `  ${card.padEnd(4)} rank ${rStatus} ${(rankScore * 100).toFixed(1)}%  ` +
      `suit ${sStatus} ${(suitScore * 100).toFixed(1)}%  ` +
      `(${h.region}@high vs ${l.region}@low)`
    );
  } catch {
    console.log(`  ${card.padEnd(4)} ERROR`);
  }
}

// --- Same-position same-resolution (sanity check) ---
console.log("\n=== SAME-POS SAME-RES: RANK ZONE ===\n");

for (const [card, instances] of cardInstances) {
  if (instances.length < 2) continue;
  const byRegionRes = new Map<string, CardInstance[]>();
  for (const inst of instances) {
    const key = `${inst.region}_${inst.resolution}`;
    if (!byRegionRes.has(key)) byRegionRes.set(key, []);
    byRegionRes.get(key)!.push(inst);
  }

  for (const [, group] of byRegionRes) {
    if (group.length < 2) continue;
    const a = group[0];
    const b = group[1];
    try {
      const aZones = await extractZones(a.path);
      const bZones = await extractZones(b.path);
      if (!aZones || !bZones) continue;
      const rankScore = compareBinary(aZones.rank, bZones.rank);
      const sStatus = rankScore > 0.95 ? "GREAT" : rankScore > 0.85 ? "OK   " : "FAIL ";
      console.log(`  ${card.padEnd(4)} rank ${sStatus} ${(rankScore * 100).toFixed(1)}%  (${a.region}, ${a.resolution})`);
    } catch {}
  }
}

// --- Different-card discrimination ---
console.log("\n=== DIFFERENT-CARD RANK DISCRIMINATION ===\n");

const allCards = [...cardInstances.entries()];
let discTests = 0;
let discPass = 0;

for (let i = 0; i < Math.min(allCards.length, 12); i++) {
  for (let j = i + 1; j < Math.min(allCards.length, 12); j++) {
    const [cardA, insA] = allCards[i];
    const [cardB, insB] = allCards[j];
    const rankA = cardA.slice(0, -1);
    const rankB = cardB.slice(0, -1);
    if (rankA === rankB) continue; // Same rank, skip (they SHOULD match)

    const a = insA[0];
    const b = insB[0];
    if (a.resolution !== b.resolution) continue;

    try {
      const aZones = await extractZones(a.path);
      const bZones = await extractZones(b.path);
      if (!aZones || !bZones) continue;

      const rankScore = compareBinary(aZones.rank, bZones.rank);
      discTests++;
      if (rankScore < 0.85) discPass++;

      const status = rankScore < 0.85 ? "GOOD " : rankScore < 0.90 ? "CLOSE" : "BAD  ";
      console.log(`  ${rankA.padEnd(2)} vs ${rankB.padEnd(2)} ${status} ${(rankScore * 100).toFixed(1)}%  (${cardA} vs ${cardB})`);
    } catch {}
  }
}

console.log(`\n  Rank discrimination: ${discPass}/${discTests} clearly different (<85%)\n`);

console.log("Inspect zone crops in test/glyph-validation/rank/ and suit/");
