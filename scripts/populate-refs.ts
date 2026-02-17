/**
 * Populate per-slot references from existing extracted corners.
 *
 * Uses the ground truth mapping to create preprocessed binary references
 * for each (slot, resolution) combination. This bootstraps the reference
 * library for testing without requiring Claude Vision auto-learning.
 *
 * Usage: bun run scripts/populate-refs.ts
 */

import { readdirSync } from "fs";
import { join, basename } from "path";
import sharp from "sharp";
import { preprocessCrop } from "../lib/card-detection/preprocess";
import { saveReference } from "../lib/card-detection/match";
import type { CardCode } from "../lib/card-detection/types";

const CORNERS_DIR = "test/extracted-corners";

// Image widths for each resolution group
const RESOLUTION_WIDTHS: Record<string, number> = {
  high: 3024,
  low: 1920,
};

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

const files = readdirSync(CORNERS_DIR).filter((f) => f.endsWith(".png")).sort();

let saved = 0;
let skipped = 0;
let errors = 0;

// Track which (slot, width, card) combinations we've already saved
const savedSet = new Set<string>();

for (const file of files) {
  const base = basename(file, ".png");
  const idx = base.indexOf("_");
  if (idx === -1) continue;

  const slot = base.substring(0, idx);
  const timestamp = base.substring(idx + 1);
  const truth = GROUND_TRUTH[timestamp];
  if (!truth || !truth[slot]) continue;

  const card = truth[slot] as CardCode;
  const resolution = timestamp.startsWith("2026-02-17T13-") ? "high" : "low";
  const imageWidth = RESOLUTION_WIDTHS[resolution];
  const key = `${slot}_${imageWidth}_${card}`;

  // Only save first occurrence (avoid overwriting with potentially worse captures)
  if (savedSet.has(key)) {
    skipped++;
    continue;
  }

  try {
    const cropPng = await sharp(join(CORNERS_DIR, file)).toBuffer();
    const preprocessed = await preprocessCrop(cropPng);
    if (!preprocessed) {
      console.log(`  SKIP ${file} — preprocessing returned null`);
      errors++;
      continue;
    }

    saveReference(preprocessed, slot, imageWidth, card);
    savedSet.add(key);
    saved++;
    console.log(`  ✓ ${slot}/${card} @ ${imageWidth}px (${file})`);
  } catch (e: any) {
    console.log(`  ERROR ${file}: ${e.message}`);
    errors++;
  }
}

console.log(`\nDone: ${saved} saved, ${skipped} skipped (duplicate), ${errors} errors`);

// Show summary
const slotCounts = new Map<string, number>();
for (const key of savedSet) {
  const [slot, width] = key.split("_");
  const label = `${slot}@${width}`;
  slotCounts.set(label, (slotCounts.get(label) || 0) + 1);
}
console.log("\nReferences per slot:");
for (const [label, count] of [...slotCounts.entries()].sort()) {
  console.log(`  ${label.padEnd(16)} ${count} cards`);
}
