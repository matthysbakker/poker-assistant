/**
 * Test: binarize → trim black borders → resize → compare.
 *
 * The hypothesis: trimming the table felt (solid black after binarization)
 * isolates just the card content, making crops from different positions comparable.
 *
 * Usage: bun run scripts/validate-binary-trim.ts
 */

import sharp from "sharp";
import { mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";

const CORNERS_DIR = "test/extracted-corners";
const OUTPUT_DIR = "test/binary-trimmed";
const COMPARE_SIZE = 80; // Square for simplicity after trim

mkdirSync(OUTPUT_DIR, { recursive: true });

/** Binarize, trim black borders, resize to standard square. */
async function binarizeAndTrim(input: string): Promise<{ pixels: Buffer; trimmed: sharp.Sharp }> {
  // Step 1: Binarize
  const binarized = sharp(input)
    .resize(160, 240) // Start larger for better trim precision
    .greyscale()
    .normalise()
    .threshold(128);

  // Step 2: Trim black borders (table felt) — keep card content
  const trimmed = binarized.trim({ background: "#000000", threshold: 30 });

  // Step 3: Resize to standard comparison size
  const { data } = await trimmed
    .clone()
    .resize(COMPARE_SIZE, COMPARE_SIZE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { pixels: data, trimmed };
}

/** Save binarized + trimmed image for visual inspection. */
async function saveTrimmed(input: string, output: string): Promise<void> {
  await sharp(input)
    .resize(160, 240)
    .greyscale()
    .normalise()
    .threshold(128)
    .trim({ background: "#000000", threshold: 30 })
    .resize(COMPARE_SIZE, COMPARE_SIZE, { fit: "fill" })
    .toFile(output);
}

function compareBinary(a: Buffer, b: Buffer): number {
  let matching = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) matching++;
  }
  return matching / len;
}

// Ground truth from visual inspection
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

// Save trimmed versions for visual inspection
console.log("Saving binarized + trimmed images...\n");
let saved = 0;
let trimErrors = 0;

for (const file of files) {
  const inputPath = join(CORNERS_DIR, file);
  const outputPath = join(OUTPUT_DIR, file);
  try {
    await saveTrimmed(inputPath, outputPath);
    saved++;
  } catch (e: any) {
    // Trim can fail if the entire image is one color
    trimErrors++;
  }
}
console.log(`Saved: ${saved}, Trim errors: ${trimErrors}\n`);

// --- Cross-position comparison ---
console.log("=== CROSS-POSITION (binarize + trim) ===\n");

let crossPosTests = 0;
let crossPosPass = 0;

for (const [card, instances] of cardInstances) {
  const heroes = instances.filter((i) => i.region.startsWith("hero"));
  const comms = instances.filter((i) => i.region.startsWith("comm"));
  if (heroes.length === 0 || comms.length === 0) continue;

  const h = heroes[0];
  const c = comms[0];

  try {
    const hResult = await binarizeAndTrim(h.path);
    const cResult = await binarizeAndTrim(c.path);
    const score = compareBinary(hResult.pixels, cResult.pixels);
    crossPosTests++;
    if (score > 0.85) crossPosPass++;

    const status = score > 0.95 ? "GREAT" : score > 0.85 ? "OK   " : "FAIL ";
    console.log(`  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%  (${h.region} vs ${c.region}, ${h.resolution})`);
  } catch {
    console.log(`  ${card.padEnd(4)} ERROR  (trim failed)`);
  }
}

console.log(`\n  Cross-position: ${crossPosPass}/${crossPosTests} passed (>85%)\n`);

// --- Cross-resolution comparison ---
console.log("=== CROSS-RESOLUTION (binarize + trim) ===\n");

let crossResTests = 0;
let crossResPass = 0;

for (const [card, instances] of cardInstances) {
  const highRes = instances.filter((i) => i.resolution === "high");
  const lowRes = instances.filter((i) => i.resolution === "low");
  if (highRes.length === 0 || lowRes.length === 0) continue;

  const h = highRes[0];
  const l = lowRes[0];

  try {
    const hResult = await binarizeAndTrim(h.path);
    const lResult = await binarizeAndTrim(l.path);
    const score = compareBinary(hResult.pixels, lResult.pixels);
    crossResTests++;
    if (score > 0.85) crossResPass++;

    const status = score > 0.95 ? "GREAT" : score > 0.85 ? "OK   " : "FAIL ";
    console.log(`  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%  (${h.region}@high vs ${l.region}@low)`);
  } catch {
    console.log(`  ${card.padEnd(4)} ERROR  (trim failed)`);
  }
}

console.log(`\n  Cross-resolution: ${crossResPass}/${crossResTests} passed (>85%)\n`);

// --- Same-position same-resolution comparison ---
console.log("=== SAME-POSITION SAME-RESOLUTION (binarize + trim) ===\n");

let sameTests = 0;
let samePass = 0;

for (const [card, instances] of cardInstances) {
  if (instances.length < 2) continue;
  const byRes = { high: [] as CardInstance[], low: [] as CardInstance[] };
  for (const inst of instances) byRes[inst.resolution].push(inst);

  for (const group of [byRes.high, byRes.low]) {
    if (group.length < 2) continue;
    // Only compare same-position pairs
    const byRegion = new Map<string, CardInstance[]>();
    for (const inst of group) {
      if (!byRegion.has(inst.region)) byRegion.set(inst.region, []);
      byRegion.get(inst.region)!.push(inst);
    }

    for (const [, regionGroup] of byRegion) {
      if (regionGroup.length < 2) continue;
      const a = regionGroup[0];
      const b = regionGroup[1];
      try {
        const aResult = await binarizeAndTrim(a.path);
        const bResult = await binarizeAndTrim(b.path);
        const score = compareBinary(aResult.pixels, bResult.pixels);
        sameTests++;
        if (score > 0.95) samePass++;
        const status = score > 0.95 ? "GREAT" : score > 0.85 ? "OK   " : "FAIL ";
        console.log(`  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%  (${a.region}, ${a.resolution})`);
      } catch {
        console.log(`  ${card.padEnd(4)} ERROR  (trim failed)`);
      }
    }
  }
}

console.log(`\n  Same-pos/same-res: ${samePass}/${sameTests} passed (>95%)\n`);

// --- Discrimination ---
console.log("=== DISCRIMINATION (binarize + trim) ===\n");

const allCards = [...cardInstances.entries()];
let discTests = 0;
let discPass = 0;

for (let i = 0; i < Math.min(allCards.length, 10); i++) {
  for (let j = i + 1; j < Math.min(allCards.length, 10); j++) {
    const [cardA, instancesA] = allCards[i];
    const [cardB, instancesB] = allCards[j];
    const a = instancesA[0];
    const b = instancesB[0];
    if (a.resolution !== b.resolution) continue;

    try {
      const aResult = await binarizeAndTrim(a.path);
      const bResult = await binarizeAndTrim(b.path);
      const score = compareBinary(aResult.pixels, bResult.pixels);
      discTests++;
      if (score < 0.85) discPass++;

      const status = score < 0.85 ? "GOOD " : score < 0.90 ? "CLOSE" : "BAD  ";
      console.log(`  ${cardA.padEnd(4)} vs ${cardB.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%`);
    } catch {
      // skip trim errors
    }
  }
}

console.log(`\n  Discrimination: ${discPass}/${discTests} clearly different (<85%)\n`);
