/**
 * Sample pixel colors at known dealer button locations.
 *
 * For each annotated capture, extract pixels from the expected seat zone
 * and report HSV values. This helps calibrate the HSV filter.
 *
 * Usage: bun run scripts/sample-dealer-colors.ts
 */

import { readFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { DEALER_GROUND_TRUTH } from "../test/dealer-ground-truth";

const CAPTURES_DIR = "test/captures";
const ANALYSIS_WIDTH = 640;

// Approximate relative positions where the D button sits for each seat
// These are rough estimates — the button is near the player's seat area
const SEAT_REGIONS: Record<number, { minX: number; maxX: number; minY: number; maxY: number }> = {
  0: { minX: 0.42, maxX: 0.58, minY: 0.62, maxY: 0.78 }, // hero (bottom)
  1: { minX: 0.12, maxX: 0.30, minY: 0.52, maxY: 0.70 }, // bottom-left
  2: { minX: 0.08, maxX: 0.25, minY: 0.18, maxY: 0.40 }, // top-left
  3: { minX: 0.38, maxX: 0.62, minY: 0.08, maxY: 0.25 }, // top-center
  4: { minX: 0.75, maxX: 0.92, minY: 0.18, maxY: 0.40 }, // top-right
  5: { minX: 0.70, maxX: 0.88, minY: 0.52, maxY: 0.70 }, // bottom-right
};

function rgbToHsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const sat = max === 0 ? 0 : delta / max;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: sat, v: max };
}

async function sampleCapture(ts: string, seat: number) {
  const buf = readFileSync(join(CAPTURES_DIR, `${ts}.png`));
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) return;

  const scale = ANALYSIS_WIDTH / meta.width;
  const h = Math.round(meta.height * scale);
  const w = ANALYSIS_WIDTH;

  const { data } = await sharp(buf)
    .resize(w, h)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const region = SEAT_REGIONS[seat];
  if (!region) return;

  const x1 = Math.round(region.minX * w);
  const x2 = Math.round(region.maxX * w);
  const y1 = Math.round(region.minY * h);
  const y2 = Math.round(region.maxY * h);

  // Find the brightest yellow/green pixel in the seat region
  // The D button should be the most saturated bright pixel
  let bestPixel: { x: number; y: number; r: number; g: number; b: number; h: number; s: number; v: number } | null = null;
  let bestScore = 0;

  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const i = (y * w + x) * 3;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const hsv = rgbToHsv(r, g, b);

      // Score: prefer bright, saturated, yellowish pixels
      // Yellow hue is around 40-80
      const hueScore = (hsv.h >= 30 && hsv.h <= 100) ? 1 : 0;
      const score = hsv.s * (hsv.v / 255) * hueScore;

      if (score > bestScore) {
        bestScore = score;
        bestPixel = { x, y, r, g, b, ...hsv };
      }
    }
  }

  if (bestPixel && bestScore > 0.1) {
    return bestPixel;
  }
  return null;
}

async function main() {
  const entries = Object.entries(DEALER_GROUND_TRUTH);
  const hues: number[] = [];
  const sats: number[] = [];
  const vals: number[] = [];

  console.log("Sampling D button colors from annotated captures...\n");

  for (const [ts, seat] of entries) {
    const pixel = await sampleCapture(ts, seat);
    if (pixel) {
      hues.push(pixel.h);
      sats.push(pixel.s);
      vals.push(pixel.v);
      console.log(
        `${ts} seat=${seat}: RGB(${pixel.r},${pixel.g},${pixel.b}) ` +
          `H=${pixel.h.toFixed(1)}° S=${pixel.s.toFixed(3)} V=${pixel.v} ` +
          `at (${(pixel.x / ANALYSIS_WIDTH).toFixed(3)}, ${(pixel.y / 332).toFixed(3)})`,
      );
    } else {
      console.log(`${ts} seat=${seat}: no bright yellow pixel found in region`);
    }
  }

  if (hues.length > 0) {
    hues.sort((a, b) => a - b);
    sats.sort((a, b) => a - b);
    vals.sort((a, b) => a - b);

    console.log(`\n--- HSV Statistics (${hues.length} samples) ---`);
    console.log(`Hue:  min=${hues[0].toFixed(1)}° max=${hues[hues.length - 1].toFixed(1)}° median=${hues[Math.floor(hues.length / 2)].toFixed(1)}°`);
    console.log(`Sat:  min=${sats[0].toFixed(3)} max=${sats[sats.length - 1].toFixed(3)} median=${sats[Math.floor(sats.length / 2)].toFixed(3)}`);
    console.log(`Val:  min=${vals[0]} max=${vals[vals.length - 1]} median=${vals[Math.floor(vals.length / 2)]}`);

    // Recommend thresholds with some margin
    const p5 = (arr: number[]) => arr[Math.floor(arr.length * 0.05)];
    const p95 = (arr: number[]) => arr[Math.floor(arr.length * 0.95)];
    console.log(`\n--- Recommended Thresholds (5th-95th percentile) ---`);
    console.log(`Hue:  ${p5(hues).toFixed(0)}° - ${p95(hues).toFixed(0)}°`);
    console.log(`Sat:  >= ${p5(sats).toFixed(3)}`);
    console.log(`Val:  >= ${p5(vals)}`);
  }
}

main().catch(console.error);
