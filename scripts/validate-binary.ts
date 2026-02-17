/**
 * Validate binary preprocessing on existing card corners.
 *
 * Tests: grayscale → normalise → threshold pipeline on extracted corners.
 * Outputs: binary images + comparison scores for same-card cross-resolution pairs.
 *
 * Usage: bun run scripts/validate-binary.ts
 */

import sharp from "sharp";
import { mkdirSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";

const CORNERS_DIR = "test/extracted-corners";
const OUTPUT_DIR = "test/binary-validation";
const COMPARE_WIDTH = 80;
const COMPARE_HEIGHT = 120;

mkdirSync(OUTPUT_DIR, { recursive: true });

/** Apply the binary preprocessing pipeline. Returns raw single-channel buffer. */
async function binarize(input: Buffer | string): Promise<Buffer> {
  const { data } = await sharp(input)
    .resize(COMPARE_WIDTH, COMPARE_HEIGHT)
    .greyscale()
    .normalise()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

/** Save a binarized version of an image for visual inspection. */
async function saveBinary(input: string, output: string): Promise<void> {
  await sharp(input)
    .resize(COMPARE_WIDTH, COMPARE_HEIGHT)
    .greyscale()
    .normalise()
    .threshold(128)
    .toFile(output);
}

/** Compare two single-channel binary buffers. Returns percentage of matching pixels. */
function compareBinary(a: Buffer, b: Buffer): number {
  let matching = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matching++;
  }
  return matching / a.length;
}

// --- Step 1: Binarize all extracted corners ---

const files = readdirSync(CORNERS_DIR)
  .filter((f) => f.endsWith(".png"))
  .sort();

if (files.length === 0) {
  console.error("No extracted corners found. Run: bun run cards:extract");
  process.exit(1);
}

console.log(`Binarizing ${files.length} extracted corners...\n`);

for (const file of files) {
  const inputPath = join(CORNERS_DIR, file);
  const outputPath = join(OUTPUT_DIR, file);
  await saveBinary(inputPath, outputPath);
}
console.log(`Binary images saved to ${OUTPUT_DIR}/\n`);

// --- Step 2: Find same-card pairs across different captures ---
// Group files by region+card identity (we know the cards from the labeling session)

// Known card identities per capture (from visual inspection)
const GROUND_TRUTH: Record<string, Record<string, string>> = {
  // High-res captures (3024px)
  "2026-02-17T13-37-28-840Z": { heroL: "Kc", heroR: "Jd" },
  "2026-02-17T13-37-56-433Z": { heroL: "Kc", heroR: "Jd", comm1: "Ah", comm2: "4h", comm3: "Jc" },
  "2026-02-17T13-38-53-206Z": { heroL: "8c", heroR: "Qc" },
  "2026-02-17T13-39-01-369Z": { heroL: "8c", heroR: "Qc" },
  "2026-02-17T13-39-46-183Z": { heroL: "8c", heroR: "Qc", comm1: "Jc", comm2: "5c", comm3: "2s", comm4: "3d" },
  "2026-02-17T13-40-46-504Z": { heroL: "Qh", heroR: "10h" },
  "2026-02-17T13-41-08-096Z": { heroL: "Qh", heroR: "10h", comm1: "Kc", comm2: "4h", comm3: "9h" },
  "2026-02-17T13-41-25-899Z": { heroL: "Qh", heroR: "10h", comm1: "Kc", comm2: "4h", comm3: "9h", comm4: "Qs" },
  "2026-02-17T13-44-37-752Z": { heroL: "Qd", heroR: "Qs" },
  // Low-res captures (1920px)
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

// Build a map: card identity → list of (file, region, resolution)
interface CardInstance {
  file: string;
  path: string;
  region: string;
  timestamp: string;
  resolution: "high" | "low";
}

const cardInstances = new Map<string, CardInstance[]>();

for (const file of files) {
  // Parse filename: <region>_<timestamp>.png
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
  cardInstances.get(card)!.push({
    file,
    path: join(CORNERS_DIR, file),
    region,
    timestamp,
    resolution,
  });
}

// --- Step 3: Compare same-card pairs (especially cross-resolution) ---

console.log("=== CROSS-RESOLUTION SAME-CARD COMPARISON ===\n");
console.log("Cards that appear in both high-res and low-res captures:\n");

let crossResTests = 0;
let crossResPass = 0;

for (const [card, instances] of cardInstances) {
  const highRes = instances.filter((i) => i.resolution === "high");
  const lowRes = instances.filter((i) => i.resolution === "low");

  if (highRes.length === 0 || lowRes.length === 0) continue;

  // Compare first high-res instance against first low-res instance
  const h = highRes[0];
  const l = lowRes[0];
  const hBin = await binarize(h.path);
  const lBin = await binarize(l.path);
  const score = compareBinary(hBin, lBin);
  crossResTests++;
  if (score > 0.85) crossResPass++;

  const status = score > 0.95 ? "GREAT" : score > 0.85 ? "OK   " : "FAIL ";
  console.log(
    `  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}% match  ` +
    `(${h.region}@high vs ${l.region}@low)`
  );
}

if (crossResTests === 0) {
  console.log("  (No cards found in both resolutions)\n");
} else {
  console.log(`\n  Cross-resolution: ${crossResPass}/${crossResTests} passed (>85% match)\n`);
}

// --- Step 4: Compare cross-position pairs (hero vs community) ---

console.log("=== CROSS-POSITION SAME-CARD COMPARISON ===\n");
console.log("Cards that appear at different table positions:\n");

let crossPosTests = 0;
let crossPosPass = 0;

for (const [card, instances] of cardInstances) {
  const heroes = instances.filter((i) => i.region.startsWith("hero"));
  const comms = instances.filter((i) => i.region.startsWith("comm"));

  if (heroes.length === 0 || comms.length === 0) continue;

  const h = heroes[0];
  const c = comms[0];
  const hBin = await binarize(h.path);
  const cBin = await binarize(c.path);
  const score = compareBinary(hBin, cBin);
  crossPosTests++;
  if (score > 0.85) crossPosPass++;

  const status = score > 0.95 ? "GREAT" : score > 0.85 ? "OK   " : "FAIL ";
  console.log(
    `  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}% match  ` +
    `(${h.region} vs ${c.region}, ${h.resolution}-res)`
  );
}

if (crossPosTests === 0) {
  console.log("  (No cards found at both hero and community positions)\n");
} else {
  console.log(`\n  Cross-position: ${crossPosPass}/${crossPosTests} passed (>85% match)\n`);
}

// --- Step 5: Same-card same-resolution pairs (should be near-perfect) ---

console.log("=== SAME-RESOLUTION SAME-CARD COMPARISON ===\n");

let sameResTests = 0;
let sameResPass = 0;

for (const [card, instances] of cardInstances) {
  if (instances.length < 2) continue;

  // Find pairs at same resolution
  const byRes = { high: [] as CardInstance[], low: [] as CardInstance[] };
  for (const inst of instances) byRes[inst.resolution].push(inst);

  for (const group of [byRes.high, byRes.low]) {
    if (group.length < 2) continue;

    const a = group[0];
    const b = group[1];
    const aBin = await binarize(a.path);
    const bBin = await binarize(b.path);
    const score = compareBinary(aBin, bBin);
    sameResTests++;
    if (score > 0.95) sameResPass++;

    const status = score > 0.95 ? "GREAT" : score > 0.85 ? "OK   " : "FAIL ";
    console.log(
      `  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}% match  ` +
      `(${a.region} vs ${b.region}, both ${a.resolution}-res)`
    );
  }
}

console.log(`\n  Same-resolution: ${sameResPass}/${sameResTests} passed (>95% match)\n`);

// --- Step 6: Different-card comparison (should be low) ---

console.log("=== DIFFERENT-CARD DISCRIMINATION ===\n");
console.log("Random pairs of different cards (should have low match %):\n");

const allCards = [...cardInstances.entries()];
let diffCardTests = 0;
let diffCardDiscriminated = 0;

for (let i = 0; i < Math.min(allCards.length, 10); i++) {
  for (let j = i + 1; j < Math.min(allCards.length, 10); j++) {
    const [cardA, instancesA] = allCards[i];
    const [cardB, instancesB] = allCards[j];

    // Only compare same position type to isolate card discrimination
    const a = instancesA[0];
    const b = instancesB[0];
    if (a.resolution !== b.resolution) continue;

    const aBin = await binarize(a.path);
    const bBin = await binarize(b.path);
    const score = compareBinary(aBin, bBin);
    diffCardTests++;
    if (score < 0.85) diffCardDiscriminated++;

    const status = score < 0.85 ? "GOOD " : score < 0.90 ? "CLOSE" : "BAD  ";
    console.log(
      `  ${cardA.padEnd(4)} vs ${cardB.padEnd(4)} ${status} ${(score * 100).toFixed(1)}% match  ` +
      `(${a.region} vs ${b.region})`
    );
  }
}

console.log(`\n  Discrimination: ${diffCardDiscriminated}/${diffCardTests} clearly different (<85% match)\n`);

console.log("=== SUMMARY ===\n");
console.log("Inspect binary images in test/binary-validation/ to verify visual quality.");
console.log("Key things to check:");
console.log("  - Red suits (hearts, diamonds): do they binarize cleanly as black on white?");
console.log("  - Rank text: is it clearly readable in the binary image?");
console.log("  - Suit symbols: are they distinct shapes after binarization?");
