/**
 * Debug dealer button detection on test captures.
 *
 * Runs detectDealerButton() on all captures and prints results.
 * Optionally saves HSV mask overlays for visual inspection.
 *
 * Usage: bun run scripts/debug-dealer-button.ts [timestamp]
 *   - No args: run on all captures, print summary
 *   - With timestamp: run on single capture, save debug images
 */

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, basename } from "path";
import sharp from "sharp";
import { detectDealerButton } from "../lib/card-detection/dealer-button";
import { heroPosition } from "../lib/card-detection/position";

const CAPTURES_DIR = "test/captures";
const SEAT_NAMES = [
  "hero (bottom)",
  "bottom-left",
  "top-left",
  "top-center",
  "top-right",
  "bottom-right",
];

async function debugSingle(file: string, verbose = false) {
  const buf = readFileSync(join(CAPTURES_DIR, file));
  const ts = basename(file, ".png");

  if (verbose) {
    await debugAllBlobs(buf, ts);
  }

  const result = await detectDealerButton(buf);

  if (result) {
    const pos = heroPosition(result.seat);
    console.log(
      `${ts}: seat ${result.seat} (${SEAT_NAMES[result.seat]}) → hero is ${pos} ` +
        `| conf=${result.confidence.toFixed(2)} | pos=(${result.relX.toFixed(3)}, ${result.relY.toFixed(3)})`,
    );
  } else {
    console.log(`${ts}: NOT FOUND`);
  }

  return result;
}

/** Show ALL blobs that pass HSV filter with their properties. */
async function debugAllBlobs(buf: Buffer, ts: string) {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) return;

  const ANALYSIS_WIDTH = 640;
  const scale = ANALYSIS_WIDTH / meta.width;
  const analysisHeight = Math.round(meta.height * scale);

  const { data, info } = await sharp(buf)
    .resize(ANALYSIS_WIDTH, analysisHeight)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;

  // Build HSV mask (same params as dealer-button.ts)
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      if (max < 130) continue;
      const sat = max === 0 ? 0 : delta / max;
      if (sat < 0.25) continue;
      let hue = 0;
      if (delta > 0) {
        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * ((b - r) / delta + 2);
        else hue = 60 * ((r - g) / delta + 4);
        if (hue < 0) hue += 360;
      }
      if (hue >= 40 && hue <= 160) mask[y * w + x] = 1;
    }
  }

  // Connected components
  const labels = new Int32Array(w * h);
  let nextLabel = 1;
  interface Blob { minX: number; minY: number; maxX: number; maxY: number; area: number; sumX: number; sumY: number; avgHue: number; }
  const blobs: Blob[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] !== 1 || labels[idx] !== 0) continue;
      const label = nextLabel++;
      let minX = x, minY = y, maxX = x, maxY = y;
      let area = 0, sumX = 0, sumY = 0, hueSum = 0;
      const queue = [idx];
      labels[idx] = label;
      while (queue.length > 0) {
        const ci = queue.pop()!;
        const cx = ci % w, cy = (ci - cx) / w;
        area++; sumX += cx; sumY += cy;
        // Compute hue for this pixel
        const pi = ci * 3;
        const pr = data[pi], pg = data[pi+1], pb = data[pi+2];
        const pmax = Math.max(pr, pg, pb), pmin = Math.min(pr, pg, pb), pd = pmax - pmin;
        let ph = 0;
        if (pd > 0) {
          if (pmax === pr) ph = 60 * (((pg - pb) / pd) % 6);
          else if (pmax === pg) ph = 60 * ((pb - pr) / pd + 2);
          else ph = 60 * ((pr - pg) / pd + 4);
          if (ph < 0) ph += 360;
        }
        hueSum += ph;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]] as const) {
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const ni = ny * w + nx;
            if (mask[ni] === 1 && labels[ni] === 0) { labels[ni] = label; queue.push(ni); }
          }
        }
      }
      blobs.push({ minX, minY, maxX, maxY, area, sumX, sumY, avgHue: hueSum / area });
    }
  }

  // Print all blobs sorted by area descending
  const sorted = blobs.filter(b => b.area >= 5).sort((a, b) => b.area - a.area);
  console.log(`\n=== ${ts}: ${sorted.length} blobs (area >= 5) ===`);
  for (const blob of sorted.slice(0, 20)) {
    const bw = blob.maxX - blob.minX + 1;
    const bh = blob.maxY - blob.minY + 1;
    const relX = (blob.sumX / blob.area) / w;
    const relY = (blob.sumY / blob.area) / h;
    const fill = (blob.area / (bw * bh)).toFixed(2);
    const aspect = (bw / bh).toFixed(2);
    console.log(
      `  area=${blob.area.toString().padStart(4)} | ${bw}x${bh} aspect=${aspect} fill=${fill} ` +
      `| rel=(${relX.toFixed(3)}, ${relY.toFixed(3)}) | avgHue=${blob.avgHue.toFixed(0)}°`,
    );
  }
}

async function saveDebugOverlay(file: string) {
  const buf = readFileSync(join(CAPTURES_DIR, file));
  const ts = basename(file, ".png");
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) return;

  const w = 640;
  const scale = w / meta.width;
  const h = Math.round(meta.height * scale);

  // Get raw RGB at analysis scale
  const { data } = await sharp(buf)
    .resize(w, h)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Build overlay: original with green/yellow pixels highlighted in red
  const overlay = Buffer.alloc(w * h * 3);

  const MIN_HUE = 40;
  const MAX_HUE = 160;
  const MIN_SAT = 0.25;
  const MIN_BRIGHTNESS = 130;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      const saturation = max === 0 ? 0 : delta / max;

      let hue = 0;
      if (delta > 0) {
        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * ((b - r) / delta + 2);
        else hue = 60 * ((r - g) / delta + 4);
        if (hue < 0) hue += 360;
      }

      const isTarget =
        max >= MIN_BRIGHTNESS &&
        saturation >= MIN_SAT &&
        hue >= MIN_HUE &&
        hue <= MAX_HUE;

      // Exclusion zones
      const relX = x / w;
      const relY = y / h;
      const isExcluded =
        relY < 0.04 ||
        relY > 0.82 ||
        (relX > 0.38 && relX < 0.62 && relY > 0.28 && relY < 0.52);

      if (isTarget && !isExcluded) {
        // Highlight in bright red
        overlay[i] = 255;
        overlay[i + 1] = 0;
        overlay[i + 2] = 0;
      } else {
        // Dimmed original
        overlay[i] = Math.round(r * 0.5);
        overlay[i + 1] = Math.round(g * 0.5);
        overlay[i + 2] = Math.round(b * 0.5);
      }
    }
  }

  const outPath = `test/debug-dealer-${ts}.png`;
  await sharp(overlay, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toFile(outPath);
  console.log(`Saved overlay: ${outPath}`);
}

async function main() {
  const target = process.argv[2];

  if (target) {
    // Single capture mode: verbose debug + save overlay
    const file = target.endsWith(".png") ? target : `${target}.png`;
    await debugSingle(file, true);
    await saveDebugOverlay(file);
    return;
  }

  // Batch mode: run on all captures
  const files = readdirSync(CAPTURES_DIR)
    .filter((f) => f.endsWith(".png"))
    .sort();

  let found = 0;
  let notFound = 0;
  const seatCounts: Record<number, number> = {};

  for (const file of files) {
    const result = await debugSingle(file);
    if (result) {
      found++;
      seatCounts[result.seat] = (seatCounts[result.seat] || 0) + 1;
    } else {
      notFound++;
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Found: ${found}/${files.length} (${((found / files.length) * 100).toFixed(1)}%)`);
  console.log(`Not found: ${notFound}`);
  console.log(`Seat distribution:`, seatCounts);
}

main().catch(console.error);
