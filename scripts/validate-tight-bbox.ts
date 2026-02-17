/**
 * Test: Find card boundary → extract rank/suit zones → tight bounding box → compare.
 *
 * Improvement over validate-glyph-extract: after extracting proportional zones
 * and binarizing, find the tight bounding box of black pixels (the actual glyph)
 * and crop to just that content. This eliminates white background that kills
 * discrimination between different cards.
 *
 * Usage: bun run scripts/validate-tight-bbox.ts
 */

import sharp from "sharp";
import { mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";

const CORNERS_DIR = "test/extracted-corners";
const OUTPUT_DIR = "test/tight-bbox";
const RANK_W = 32;
const RANK_H = 48;
const SUIT_W = 32;
const SUIT_H = 32;

mkdirSync(join(OUTPUT_DIR, "rank"), { recursive: true });
mkdirSync(join(OUTPUT_DIR, "suit"), { recursive: true });

/**
 * Find the card boundary within a corner crop.
 * Cards have a white/bright background; table felt is dark.
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

  return { left, top, right: width, bottom: height };
}

/**
 * Find the tight bounding box of black pixels in a single-channel binary buffer.
 * Returns the extent of non-white (value === 0) pixels.
 */
function tightBBox(
  pixels: Buffer,
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } | null {
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] === 0) {
        // Black pixel (glyph content)
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  if (!found) return null;

  // Add 1px padding to avoid clipping
  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(width - 1, maxX + 1);
  maxY = Math.min(height - 1, maxY + 1);

  return { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 };
}

/**
 * Extract rank and suit zones with tight bounding box.
 * 1. Resize to working size
 * 2. Find card boundary (where white begins)
 * 3. Extract proportional rank/suit regions
 * 4. Binarize each region
 * 5. Find tight bounding box of black pixels
 * 6. Crop to tight box and resize to standard dimensions
 */
async function extractZones(
  inputPath: string,
): Promise<{ rank: Buffer; suit: Buffer } | null> {
  const WORK_W = 120;
  const WORK_H = 180;

  // Step 1: Get pixel data for card boundary detection
  const { data } = await sharp(inputPath)
    .resize(WORK_W, WORK_H)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bounds = findCardBounds(data, WORK_W, WORK_H, 3);
  const cardW = bounds.right - bounds.left;
  const cardH = bounds.bottom - bounds.top;

  if (cardW < 20 || cardH < 30) return null;

  // Step 2: Proportional regions
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

  // Step 3: Resize source to working size
  const resizedBuf = await sharp(inputPath).resize(WORK_W, WORK_H).toBuffer();

  // Step 4: Extract and binarize rank zone
  const { data: rankBinary, info: rankInfo } = await sharp(resizedBuf)
    .extract(rankRegion)
    .greyscale()
    .normalise()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Step 5: Tight bbox on rank
  const rankBBox = tightBBox(rankBinary, rankInfo.width, rankInfo.height);
  if (!rankBBox) return null;

  // Step 6: Crop tight rank and resize to standard
  const rankCropped = await sharp(rankBinary, {
    raw: { width: rankInfo.width, height: rankInfo.height, channels: 1 },
  })
    .extract({
      left: rankBBox.left,
      top: rankBBox.top,
      width: rankBBox.right - rankBBox.left,
      height: rankBBox.bottom - rankBBox.top,
    })
    .resize(RANK_W, RANK_H, { fit: "fill" })
    .raw()
    .toBuffer();

  // Repeat for suit zone
  const { data: suitBinary, info: suitInfo } = await sharp(resizedBuf)
    .extract(suitRegion)
    .greyscale()
    .normalise()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const suitBBox = tightBBox(suitBinary, suitInfo.width, suitInfo.height);
  if (!suitBBox) return null;

  const suitCropped = await sharp(suitBinary, {
    raw: { width: suitInfo.width, height: suitInfo.height, channels: 1 },
  })
    .extract({
      left: suitBBox.left,
      top: suitBBox.top,
      width: suitBBox.right - suitBBox.left,
      height: suitBBox.bottom - suitBBox.top,
    })
    .resize(SUIT_W, SUIT_H, { fit: "fill" })
    .raw()
    .toBuffer();

  return { rank: rankCropped, suit: suitCropped };
}

/** Save extracted zones with tight bbox for visual inspection. */
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

  // Rank: binarize → tight bbox → resize → save
  const { data: rankBinary, info: rankInfo } = await sharp(resizedBuf)
    .extract(rankRegion)
    .greyscale()
    .normalise()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rankBBox = tightBBox(rankBinary, rankInfo.width, rankInfo.height);
  if (rankBBox) {
    await sharp(rankBinary, {
      raw: { width: rankInfo.width, height: rankInfo.height, channels: 1 },
    })
      .extract({
        left: rankBBox.left,
        top: rankBBox.top,
        width: rankBBox.right - rankBBox.left,
        height: rankBBox.bottom - rankBBox.top,
      })
      .resize(RANK_W, RANK_H, { fit: "fill" })
      .toFile(join(OUTPUT_DIR, "rank", baseName));
  }

  // Suit: binarize → tight bbox → resize → save
  const { data: suitBinary, info: suitInfo } = await sharp(resizedBuf)
    .extract(suitRegion)
    .greyscale()
    .normalise()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const suitBBox = tightBBox(suitBinary, suitInfo.width, suitInfo.height);
  if (suitBBox) {
    await sharp(suitBinary, {
      raw: { width: suitInfo.width, height: suitInfo.height, channels: 1 },
    })
      .extract({
        left: suitBBox.left,
        top: suitBBox.top,
        width: suitBBox.right - suitBBox.left,
        height: suitBBox.bottom - suitBBox.top,
      })
      .resize(SUIT_W, SUIT_H, { fit: "fill" })
      .toFile(join(OUTPUT_DIR, "suit", baseName));
  }
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
console.log("Extracting rank/suit zones with tight bounding box...\n");
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
console.log("=== CROSS-POSITION (tight bbox) ===\n");

let crossPosTests = 0;
let crossPosPass = 0;

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
    crossPosTests++;
    if (rankScore > 0.80 && suitScore > 0.80) crossPosPass++;

    const rStatus = rankScore > 0.90 ? "GREAT" : rankScore > 0.80 ? "OK   " : "FAIL ";
    const sStatus = suitScore > 0.90 ? "GREAT" : suitScore > 0.80 ? "OK   " : "FAIL ";
    console.log(
      `  ${card.padEnd(4)} rank ${rStatus} ${(rankScore * 100).toFixed(1)}%  ` +
      `suit ${sStatus} ${(suitScore * 100).toFixed(1)}%  ` +
      `(${h.region} vs ${c.region})`
    );
  } catch {
    console.log(`  ${card.padEnd(4)} ERROR`);
  }
}

console.log(`\n  Cross-position: ${crossPosPass}/${crossPosTests} passed (rank>80% AND suit>80%)\n`);

// --- Cross-resolution comparison ---
console.log("=== CROSS-RESOLUTION (tight bbox) ===\n");

let crossResTests = 0;
let crossResPass = 0;

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
    crossResTests++;
    if (rankScore > 0.80 && suitScore > 0.80) crossResPass++;

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

console.log(`\n  Cross-resolution: ${crossResPass}/${crossResTests} passed\n`);

// --- Same-position same-resolution (sanity check) ---
console.log("=== SAME-POS SAME-RES (tight bbox) ===\n");

let sameTests = 0;
let samePass = 0;

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
      sameTests++;
      if (rankScore > 0.90) samePass++;
      const status = rankScore > 0.95 ? "GREAT" : rankScore > 0.90 ? "OK   " : "FAIL ";
      console.log(`  ${card.padEnd(4)} rank ${status} ${(rankScore * 100).toFixed(1)}%  (${a.region}, ${a.resolution})`);
    } catch {}
  }
}

console.log(`\n  Same-pos/same-res: ${samePass}/${sameTests} passed (>90%)\n`);

// --- Different-card RANK discrimination ---
console.log("=== RANK DISCRIMINATION (tight bbox) ===\n");

const allCards = [...cardInstances.entries()];
let discTests = 0;
let discPass = 0;

for (let i = 0; i < Math.min(allCards.length, 15); i++) {
  for (let j = i + 1; j < Math.min(allCards.length, 15); j++) {
    const [cardA, insA] = allCards[i];
    const [cardB, insB] = allCards[j];
    const rankA = cardA.slice(0, -1);
    const rankB = cardB.slice(0, -1);
    if (rankA === rankB) continue; // Same rank should match

    const a = insA[0];
    const b = insB[0];
    if (a.resolution !== b.resolution) continue;

    try {
      const aZones = await extractZones(a.path);
      const bZones = await extractZones(b.path);
      if (!aZones || !bZones) continue;

      const rankScore = compareBinary(aZones.rank, bZones.rank);
      discTests++;
      if (rankScore < 0.80) discPass++;

      const status = rankScore < 0.80 ? "GOOD " : rankScore < 0.85 ? "CLOSE" : "BAD  ";
      console.log(`  ${rankA.padEnd(2)} vs ${rankB.padEnd(2)} ${status} ${(rankScore * 100).toFixed(1)}%  (${cardA} vs ${cardB})`);
    } catch {}
  }
}

console.log(`\n  Rank discrimination: ${discPass}/${discTests} clearly different (<80%)\n`);

// --- Different-card SUIT discrimination ---
console.log("=== SUIT DISCRIMINATION (tight bbox) ===\n");

let suitDiscTests = 0;
let suitDiscPass = 0;

for (let i = 0; i < Math.min(allCards.length, 15); i++) {
  for (let j = i + 1; j < Math.min(allCards.length, 15); j++) {
    const [cardA, insA] = allCards[i];
    const [cardB, insB] = allCards[j];
    const suitA = cardA.slice(-1);
    const suitB = cardB.slice(-1);
    if (suitA === suitB) continue; // Same suit should match

    const a = insA[0];
    const b = insB[0];
    if (a.resolution !== b.resolution) continue;

    try {
      const aZones = await extractZones(a.path);
      const bZones = await extractZones(b.path);
      if (!aZones || !bZones) continue;

      const suitScore = compareBinary(aZones.suit, bZones.suit);
      suitDiscTests++;
      if (suitScore < 0.80) suitDiscPass++;

      const status = suitScore < 0.80 ? "GOOD " : suitScore < 0.85 ? "CLOSE" : "BAD  ";
      console.log(`  ${suitA} vs ${suitB} ${status} ${(suitScore * 100).toFixed(1)}%  (${cardA} vs ${cardB})`);
    } catch {}
  }
}

console.log(`\n  Suit discrimination: ${suitDiscPass}/${suitDiscTests} clearly different (<80%)\n`);

// --- Same-rank cross-card (should match) ---
console.log("=== SAME-RANK VERIFICATION (tight bbox) ===\n");

let sameRankTests = 0;
let sameRankPass = 0;

for (let i = 0; i < allCards.length; i++) {
  for (let j = i + 1; j < allCards.length; j++) {
    const [cardA, insA] = allCards[i];
    const [cardB, insB] = allCards[j];
    const rankA = cardA.slice(0, -1);
    const rankB = cardB.slice(0, -1);
    if (rankA !== rankB) continue;

    const a = insA[0];
    const b = insB[0];
    if (a.resolution !== b.resolution || a.region.startsWith("hero") !== b.region.startsWith("hero")) continue;

    try {
      const aZones = await extractZones(a.path);
      const bZones = await extractZones(b.path);
      if (!aZones || !bZones) continue;

      const rankScore = compareBinary(aZones.rank, bZones.rank);
      sameRankTests++;
      if (rankScore > 0.85) sameRankPass++;

      const status = rankScore > 0.90 ? "GREAT" : rankScore > 0.85 ? "OK   " : "FAIL ";
      console.log(`  ${rankA.padEnd(2)} ${status} ${(rankScore * 100).toFixed(1)}%  (${cardA} ${a.region} vs ${cardB} ${b.region})`);
    } catch {}
  }
}

console.log(`\n  Same-rank verification: ${sameRankPass}/${sameRankTests} passed (>85%)\n`);

console.log("Inspect tight-bbox crops in test/tight-bbox/rank/ and suit/");
