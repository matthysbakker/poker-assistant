/**
 * Test: Full-corner tight bbox matching (no rank/suit splitting).
 *
 * The simplest approach that works:
 * 1. Binarize the full corner crop (greyscale → normalise → threshold)
 * 2. Find tight bounding box of all black pixels
 * 3. Crop to tight bbox, resize with aspect-ratio preservation
 * 4. Compare binary pixels
 *
 * No zone splitting = no fragility from proportional region estimation.
 * Position-specific refs = avoids the impossible cross-position problem.
 *
 * Usage: bun run scripts/validate-full-corner-bbox.ts
 */

import sharp from "sharp";
import { readdirSync } from "fs";
import { join, basename } from "path";

const CORNERS_DIR = "test/extracted-corners";
const COMPARE_W = 32;
const COMPARE_H = 48;

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
  return {
    left: Math.max(0, minX - 1),
    top: Math.max(0, minY - 1),
    right: Math.min(width, maxX + 2),
    bottom: Math.min(height, maxY + 2),
  };
}

async function processCorner(inputPath: string): Promise<Buffer | null> {
  // Step 1: Binarize at a consistent working size
  const WORK_W = 80;
  const WORK_H = 120;

  const { data, info } = await sharp(inputPath)
    .resize(WORK_W, WORK_H)
    .greyscale()
    .normalise()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Step 2: Tight bbox
  const bbox = tightBBox(data, info.width, info.height);
  if (!bbox) return null;

  const bboxW = bbox.right - bbox.left;
  const bboxH = bbox.bottom - bbox.top;
  if (bboxW < 3 || bboxH < 3) return null;

  // Step 3: Crop to tight bbox → resize with aspect preservation
  const cropped = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 1 },
  })
    .extract({ left: bbox.left, top: bbox.top, width: bboxW, height: bboxH })
    .resize(COMPARE_W, COMPARE_H, { fit: "fill" })
    .raw()
    .toBuffer();

  return cropped;
}

function compareBinary(a: Buffer, b: Buffer): number {
  let matching = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) matching++;
  }
  return matching / len;
}

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
  posType: "hero" | "comm";
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
  const posType = region.startsWith("hero") ? "hero" : "comm";
  if (!cardInstances.has(card)) cardInstances.set(card, []);
  cardInstances.get(card)!.push({ file, path: join(CORNERS_DIR, file), region, timestamp, resolution, posType });
}

// === Test 1: Same-position, same-resolution (should be near-perfect) ===
console.log("=== SAME-POS SAME-RES (full corner bbox) ===\n");

let sameTests = 0, samePass = 0;

for (const [card, instances] of cardInstances) {
  const byKey = new Map<string, CardInstance[]>();
  for (const inst of instances) {
    const key = `${inst.region}_${inst.resolution}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(inst);
  }

  for (const [, group] of byKey) {
    if (group.length < 2) continue;
    try {
      const a = await processCorner(group[0].path);
      const b = await processCorner(group[1].path);
      if (!a || !b) continue;
      const score = compareBinary(a, b);
      sameTests++;
      if (score > 0.95) samePass++;
      const status = score > 0.95 ? "GREAT" : score > 0.85 ? "OK   " : "FAIL ";
      console.log(`  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%  (${group[0].region}, ${group[0].resolution})`);
    } catch {}
  }
}
console.log(`\n  Same-pos/same-res: ${samePass}/${sameTests} passed (>95%)\n`);

// === Test 2: Same-position-TYPE, same-resolution discrimination ===
// This tests: can we tell apart different cards at the same position type?
console.log("=== DISCRIMINATION within position type (full corner bbox) ===\n");

const allCards = [...cardInstances.entries()];

// Group by position type + resolution
for (const posType of ["hero", "comm"] as const) {
  for (const res of ["high", "low"] as const) {
    const cards: [string, CardInstance][] = [];
    for (const [card, instances] of allCards) {
      const match = instances.find((i) => i.posType === posType && i.resolution === res);
      if (match) cards.push([card, match]);
    }

    if (cards.length < 2) continue;
    console.log(`  --- ${posType} @ ${res}-res ---`);

    let discTests = 0, discPass = 0;
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const [cardA, instA] = cards[i];
        const [cardB, instB] = cards[j];

        try {
          const a = await processCorner(instA.path);
          const b = await processCorner(instB.path);
          if (!a || !b) continue;

          const score = compareBinary(a, b);
          discTests++;
          if (score < 0.85) discPass++;

          if (score >= 0.80) {
            // Only print close/failing pairs
            const status = score < 0.85 ? "CLOSE" : "BAD  ";
            console.log(`  ${cardA.padEnd(4)} vs ${cardB.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%`);
          }
        } catch {}
      }
    }
    console.log(`  Discrimination: ${discPass}/${discTests} clearly different (<85%)\n`);
  }
}

// === Test 3: Same-card across heroL/heroR (should match — same position type) ===
console.log("=== heroL vs heroR SAME CARD (full corner bbox) ===\n");

for (const [card, instances] of cardInstances) {
  const heroL = instances.filter((i) => i.region === "heroL");
  const heroR = instances.filter((i) => i.region === "heroR");
  if (heroL.length === 0 || heroR.length === 0) continue;

  // Same resolution
  for (const res of ["high", "low"] as const) {
    const l = heroL.find((i) => i.resolution === res);
    const r = heroR.find((i) => i.resolution === res);
    if (!l || !r) continue;

    try {
      const lBuf = await processCorner(l.path);
      const rBuf = await processCorner(r.path);
      if (!lBuf || !rBuf) continue;

      const score = compareBinary(lBuf, rBuf);
      const status = score > 0.90 ? "GREAT" : score > 0.80 ? "OK   " : "FAIL ";
      console.log(`  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%  (heroL vs heroR, ${res})`);
    } catch {}
  }
}

// === Test 4: Same-card across comm positions (should match — same position type) ===
console.log("\n=== comm1 vs comm2 vs comm3 SAME CARD (full corner bbox) ===\n");

for (const [card, instances] of cardInstances) {
  const comms = instances.filter((i) => i.posType === "comm");
  if (comms.length < 2) continue;

  // Compare pairs at same resolution
  for (let i = 0; i < comms.length; i++) {
    for (let j = i + 1; j < comms.length; j++) {
      if (comms[i].resolution !== comms[j].resolution) continue;
      if (comms[i].region === comms[j].region) continue; // Different comm positions

      try {
        const aBuf = await processCorner(comms[i].path);
        const bBuf = await processCorner(comms[j].path);
        if (!aBuf || !bBuf) continue;

        const score = compareBinary(aBuf, bBuf);
        const status = score > 0.90 ? "GREAT" : score > 0.80 ? "OK   " : "FAIL ";
        console.log(`  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%  (${comms[i].region} vs ${comms[j].region}, ${comms[i].resolution})`);
      } catch {}
    }
  }
}

// === Test 5: Cross-resolution at same position (the remaining challenge) ===
console.log("\n=== CROSS-RESOLUTION same position (full corner bbox) ===\n");

for (const [card, instances] of cardInstances) {
  const byRegion = new Map<string, CardInstance[]>();
  for (const inst of instances) {
    if (!byRegion.has(inst.region)) byRegion.set(inst.region, []);
    byRegion.get(inst.region)!.push(inst);
  }

  for (const [region, group] of byRegion) {
    const high = group.find((i) => i.resolution === "high");
    const low = group.find((i) => i.resolution === "low");
    if (!high || !low) continue;

    try {
      const hBuf = await processCorner(high.path);
      const lBuf = await processCorner(low.path);
      if (!hBuf || !lBuf) continue;

      const score = compareBinary(hBuf, lBuf);
      const status = score > 0.85 ? "GREAT" : score > 0.75 ? "OK   " : "FAIL ";
      console.log(`  ${card.padEnd(4)} ${status} ${(score * 100).toFixed(1)}%  (${region}@high vs ${region}@low)`);
    } catch {}
  }
}

console.log("\n=== SUMMARY ===");
console.log("Full-corner tight-bbox matching tests position-specific reference viability.");
console.log("Key question: can we tell cards apart within the same position type?");
