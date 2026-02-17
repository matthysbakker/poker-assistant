/**
 * End-to-end test of the new pipeline: preprocess → match against per-slot refs.
 *
 * Tests all extracted corners against the per-slot reference library
 * and compares results to ground truth.
 *
 * Usage: bun run scripts/test-new-pipeline.ts
 */

import sharp from "sharp";
import { readdirSync } from "fs";
import { join, basename } from "path";
import { preprocessCrop } from "../lib/card-detection/preprocess";
import { matchCard, clearReferenceCache } from "../lib/card-detection/match";
import type { CardCode } from "../lib/card-detection/types";

const CORNERS_DIR = "test/extracted-corners";

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

// Ensure fresh cache
clearReferenceCache();

const files = readdirSync(CORNERS_DIR).filter((f) => f.endsWith(".png")).sort();

let correct = 0;
let incorrect = 0;
let noMatch = 0;
let total = 0;
let highConf = 0;
let medConf = 0;

for (const file of files) {
  const base = basename(file, ".png");
  const idx = base.indexOf("_");
  if (idx === -1) continue;

  const slot = base.substring(0, idx);
  const timestamp = base.substring(idx + 1);
  const truth = GROUND_TRUTH[timestamp];
  if (!truth || !truth[slot]) continue;

  const expectedCard = truth[slot] as CardCode;
  const resolution = timestamp.startsWith("2026-02-17T13-") ? "high" : "low";
  const imageWidth = RESOLUTION_WIDTHS[resolution];

  try {
    const cropPng = await sharp(join(CORNERS_DIR, file)).toBuffer();
    const preprocessed = await preprocessCrop(cropPng);
    if (!preprocessed) {
      console.log(`  SKIP ${file} — preprocess returned null`);
      continue;
    }

    const match = matchCard(preprocessed, slot, imageWidth);
    total++;

    if (match.card === expectedCard) {
      correct++;
      if (match.confidence === "HIGH") highConf++;
      if (match.confidence === "MEDIUM") medConf++;
      const icon = match.confidence === "HIGH" ? "✓" : match.confidence === "MEDIUM" ? "~" : "?";
      console.log(
        `  ${icon} ${slot.padEnd(5)} ${expectedCard.padEnd(4)} ` +
        `${match.confidence.padEnd(6)} score=${(match.matchScore * 100).toFixed(1)}% gap=${(match.gap * 100).toFixed(1)}%`
      );
    } else if (match.card === null) {
      noMatch++;
      console.log(
        `  ✗ ${slot.padEnd(5)} expected=${expectedCard.padEnd(4)} got=NONE ` +
        `score=${(match.matchScore * 100).toFixed(1)}% gap=${(match.gap * 100).toFixed(1)}%`
      );
    } else {
      incorrect++;
      console.log(
        `  ✗ ${slot.padEnd(5)} expected=${expectedCard.padEnd(4)} got=${match.card!.padEnd(4)} ` +
        `${match.confidence.padEnd(6)} score=${(match.matchScore * 100).toFixed(1)}% gap=${(match.gap * 100).toFixed(1)}%`
      );
    }
  } catch (e: any) {
    console.log(`  ERROR ${file}: ${e.message}`);
  }
}

console.log(`\n=== RESULTS ===`);
console.log(`Total:     ${total}`);
console.log(`Correct:   ${correct} (${((correct / total) * 100).toFixed(1)}%)`);
console.log(`  HIGH:    ${highConf}`);
console.log(`  MEDIUM:  ${medConf}`);
console.log(`Incorrect: ${incorrect}`);
console.log(`No match:  ${noMatch}`);
console.log(`Accuracy:  ${((correct / total) * 100).toFixed(1)}%`);
