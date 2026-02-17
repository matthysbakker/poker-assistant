/**
 * Test: Projection histogram matching for cross-position robustness.
 *
 * Instead of comparing 2D pixel grids (fragile to scale/position),
 * project the binary image onto 1D row and column profiles:
 *   row_profile[y] = count of black pixels in row y
 *   col_profile[x] = count of black pixels in column x
 *
 * Then compare profiles using correlation. This is robust to:
 *   - Stroke thickness differences (hero vs community cards)
 *   - Slight positional shifts
 *   - Aspect ratio variations
 *
 * Also tests very small comparison sizes (8x12, 12x18, 16x24)
 * to see if aggressive downscaling blurs away scale differences.
 *
 * Usage: bun run scripts/validate-projections.ts
 */

import sharp from "sharp";
import { mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";

const CORNERS_DIR = "test/extracted-corners";

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

  let left = 0;
  for (let x = 0; x < width; x++) {
    let bright = 0;
    for (let y = 0; y < height; y++) {
      if (brightness(x, y) > 170) bright++;
    }
    if (bright / height > 0.4) { left = x; break; }
  }

  let top = 0;
  for (let y = 0; y < height; y++) {
    let bright = 0;
    for (let x = left; x < width; x++) {
      if (brightness(x, y) > 170) bright++;
    }
    if (bright / (width - left) > 0.4) { top = y; break; }
  }

  return { left, top, right: width, bottom: height };
}

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
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  if (!found) return null;
  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(width - 1, maxX + 1);
  maxY = Math.min(height - 1, maxY + 1);

  return { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 };
}

interface ZoneResult {
  /** Raw binary pixels at various sizes for pixel comparison */
  pixels: Map<string, Buffer>;
  /** Row projection profile (normalized) */
  rowProfile: number[];
  /** Column projection profile (normalized) */
  colProfile: number[];
}

async function extractZone(
  inputPath: string,
  zone: "rank" | "suit",
): Promise<ZoneResult | null> {
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
  if (cardW < 20 || cardH < 30) return null;

  // Zone regions
  let region;
  if (zone === "rank") {
    region = {
      left: bounds.left,
      top: bounds.top,
      width: Math.min(cardW, WORK_W - bounds.left),
      height: Math.round(cardH * 0.55),
    };
  } else {
    const suitTop = bounds.top + Math.round(cardH * 0.5);
    region = {
      left: bounds.left,
      top: suitTop,
      width: Math.min(Math.round(cardW * 0.6), WORK_W - bounds.left),
      height: Math.min(Math.round(cardH * 0.45), WORK_H - suitTop),
    };
  }

  const resizedBuf = await sharp(inputPath).resize(WORK_W, WORK_H).toBuffer();

  // Binarize the zone
  const { data: binary, info } = await sharp(resizedBuf)
    .extract(region)
    .greyscale()
    .normalise()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Tight bbox
  const bbox = tightBBox(binary, info.width, info.height);
  if (!bbox) return null;

  const bboxW = bbox.right - bbox.left;
  const bboxH = bbox.bottom - bbox.top;
  if (bboxW < 3 || bboxH < 3) return null;

  // Create raw buffer from tight bbox
  const croppedBuf = await sharp(binary, {
    raw: { width: info.width, height: info.height, channels: 1 },
  })
    .extract({ left: bbox.left, top: bbox.top, width: bboxW, height: bboxH })
    .toBuffer();

  // Generate pixels at multiple sizes (using contain to preserve aspect ratio)
  const sizes = zone === "rank"
    ? [
        { name: "8x12", w: 8, h: 12 },
        { name: "12x18", w: 12, h: 18 },
        { name: "16x24", w: 16, h: 24 },
        { name: "24x36", w: 24, h: 36 },
        { name: "32x48", w: 32, h: 48 },
      ]
    : [
        { name: "8x8", w: 8, h: 8 },
        { name: "12x12", w: 12, h: 12 },
        { name: "16x16", w: 16, h: 16 },
        { name: "24x24", w: 24, h: 24 },
        { name: "32x32", w: 32, h: 32 },
      ];

  const pixels = new Map<string, Buffer>();
  for (const { name, w, h } of sizes) {
    // Use "contain" to preserve aspect ratio, pad with white (255)
    const buf = await sharp(croppedBuf, {
      raw: { width: bboxW, height: bboxH, channels: 1 },
    })
      .resize(w, h, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .raw()
      .toBuffer();
    pixels.set(name, buf);
  }

  // Generate projection profiles at a standard size (24x36 for rank, 24x24 for suit)
  const profileW = 24;
  const profileH = zone === "rank" ? 36 : 24;
  const profileBuf = await sharp(croppedBuf, {
    raw: { width: bboxW, height: bboxH, channels: 1 },
  })
    .resize(profileW, profileH, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .raw()
    .toBuffer();

  // Row profile: fraction of black pixels in each row
  const rowProfile: number[] = [];
  for (let y = 0; y < profileH; y++) {
    let black = 0;
    for (let x = 0; x < profileW; x++) {
      if (profileBuf[y * profileW + x] === 0) black++;
    }
    rowProfile.push(black / profileW);
  }

  // Column profile: fraction of black pixels in each column
  const colProfile: number[] = [];
  for (let x = 0; x < profileW; x++) {
    let black = 0;
    for (let y = 0; y < profileH; y++) {
      if (profileBuf[y * profileW + x] === 0) black++;
    }
    colProfile.push(black / profileH);
  }

  return { pixels, rowProfile, colProfile };
}

function compareBinary(a: Buffer, b: Buffer): number {
  let matching = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) matching++;
  }
  return matching / len;
}

/** Pearson correlation between two arrays of equal length. */
function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
    sumAB += a[i] * b[i];
    sumA2 += a[i] * a[i];
    sumB2 += b[i] * b[i];
  }
  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
  if (den === 0) return 0;
  return num / den;
}

/** Combined score: average of row and column profile correlations. */
function profileScore(a: ZoneResult, b: ZoneResult): number {
  const rowCorr = correlation(a.rowProfile, b.rowProfile);
  const colCorr = correlation(a.colProfile, b.colProfile);
  return (rowCorr + colCorr) / 2;
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

// === APPROACH 1: Pixel matching at various sizes ===

console.log("╔══════════════════════════════════════════════╗");
console.log("║  APPROACH 1: Pixel matching at various sizes ║");
console.log("╚══════════════════════════════════════════════╝\n");

const pixelSizes = ["8x12", "12x18", "16x24", "24x36", "32x48"];

for (const size of pixelSizes) {
  console.log(`--- Cross-position rank @ ${size} ---`);
  let pass = 0, total = 0;

  for (const [card, instances] of cardInstances) {
    const heroes = instances.filter((i) => i.region.startsWith("hero"));
    const comms = instances.filter((i) => i.region.startsWith("comm"));
    if (heroes.length === 0 || comms.length === 0) continue;

    try {
      const hZone = await extractZone(heroes[0].path, "rank");
      const cZone = await extractZone(comms[0].path, "rank");
      if (!hZone || !cZone) continue;

      const hPx = hZone.pixels.get(size)!;
      const cPx = cZone.pixels.get(size)!;
      const score = compareBinary(hPx, cPx);
      total++;
      if (score > 0.75) pass++;

      const status = score > 0.85 ? "GREAT" : score > 0.75 ? "OK   " : "FAIL ";
      console.log(`  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%  (${heroes[0].region} vs ${comms[0].region})`);
    } catch {}
  }
  console.log(`  Result: ${pass}/${total} passed (>75%)\n`);
}

// === APPROACH 2: Projection profile correlation ===

console.log("╔═══════════════════════════════════════════════╗");
console.log("║  APPROACH 2: Projection profile correlation   ║");
console.log("╚═══════════════════════════════════════════════╝\n");

// Cross-position
console.log("--- Cross-position rank (projection profiles) ---");
let projCrossPosPass = 0, projCrossPosTotal = 0;

for (const [card, instances] of cardInstances) {
  const heroes = instances.filter((i) => i.region.startsWith("hero"));
  const comms = instances.filter((i) => i.region.startsWith("comm"));
  if (heroes.length === 0 || comms.length === 0) continue;

  try {
    const hZone = await extractZone(heroes[0].path, "rank");
    const cZone = await extractZone(comms[0].path, "rank");
    if (!hZone || !cZone) continue;

    const score = profileScore(hZone, cZone);
    const rowCorr = correlation(hZone.rowProfile, cZone.rowProfile);
    const colCorr = correlation(hZone.colProfile, cZone.colProfile);
    projCrossPosTotal++;
    if (score > 0.75) projCrossPosPass++;

    const status = score > 0.85 ? "GREAT" : score > 0.75 ? "OK   " : "FAIL ";
    console.log(`  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%  row=${(rowCorr * 100).toFixed(0)}% col=${(colCorr * 100).toFixed(0)}%`);
  } catch {}
}
console.log(`  Result: ${projCrossPosPass}/${projCrossPosTotal} passed (>75%)\n`);

// Cross-resolution
console.log("--- Cross-resolution rank (projection profiles) ---");
let projCrossResPass = 0, projCrossResTotal = 0;

for (const [card, instances] of cardInstances) {
  const highRes = instances.filter((i) => i.resolution === "high");
  const lowRes = instances.filter((i) => i.resolution === "low");
  if (highRes.length === 0 || lowRes.length === 0) continue;

  try {
    const hZone = await extractZone(highRes[0].path, "rank");
    const lZone = await extractZone(lowRes[0].path, "rank");
    if (!hZone || !lZone) continue;

    const score = profileScore(hZone, lZone);
    const rowCorr = correlation(hZone.rowProfile, lZone.rowProfile);
    const colCorr = correlation(hZone.colProfile, lZone.colProfile);
    projCrossResTotal++;
    if (score > 0.75) projCrossResPass++;

    const status = score > 0.85 ? "GREAT" : score > 0.75 ? "OK   " : "FAIL ";
    console.log(`  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%  row=${(rowCorr * 100).toFixed(0)}% col=${(colCorr * 100).toFixed(0)}%`);
  } catch {}
}
console.log(`  Result: ${projCrossResPass}/${projCrossResTotal} passed (>75%)\n`);

// Same-pos same-res
console.log("--- Same-pos/same-res rank (projection profiles) ---");
let projSamePass = 0, projSameTotal = 0;

for (const [card, instances] of cardInstances) {
  if (instances.length < 2) continue;
  const byKey = new Map<string, CardInstance[]>();
  for (const inst of instances) {
    const key = `${inst.region}_${inst.resolution}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(inst);
  }

  for (const [, group] of byKey) {
    if (group.length < 2) continue;
    try {
      const aZone = await extractZone(group[0].path, "rank");
      const bZone = await extractZone(group[1].path, "rank");
      if (!aZone || !bZone) continue;

      const score = profileScore(aZone, bZone);
      projSameTotal++;
      if (score > 0.90) projSamePass++;

      const status = score > 0.95 ? "GREAT" : score > 0.90 ? "OK   " : "FAIL ";
      console.log(`  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%  (${group[0].region}, ${group[0].resolution})`);
    } catch {}
  }
}
console.log(`  Result: ${projSamePass}/${projSameTotal} passed (>90%)\n`);

// Discrimination
console.log("--- Rank discrimination (projection profiles) ---");
const allCards = [...cardInstances.entries()];
let projDiscPass = 0, projDiscTotal = 0;

for (let i = 0; i < Math.min(allCards.length, 15); i++) {
  for (let j = i + 1; j < Math.min(allCards.length, 15); j++) {
    const [cardA, insA] = allCards[i];
    const [cardB, insB] = allCards[j];
    const rankA = cardA.slice(0, -1);
    const rankB = cardB.slice(0, -1);
    if (rankA === rankB) continue;

    const a = insA[0];
    const b = insB[0];
    if (a.resolution !== b.resolution) continue;

    try {
      const aZone = await extractZone(a.path, "rank");
      const bZone = await extractZone(b.path, "rank");
      if (!aZone || !bZone) continue;

      const score = profileScore(aZone, bZone);
      projDiscTotal++;
      if (score < 0.75) projDiscPass++;

      const status = score < 0.65 ? "GOOD " : score < 0.75 ? "OK   " : score < 0.85 ? "CLOSE" : "BAD  ";
      console.log(`  ${rankA.padEnd(2)} vs ${rankB.padEnd(2)} ${status} ${(score * 100).toFixed(1)}%`);
    } catch {}
  }
}
console.log(`  Result: ${projDiscPass}/${projDiscTotal} clearly different (<75%)\n`);
