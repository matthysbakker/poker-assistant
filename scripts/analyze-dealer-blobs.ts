/**
 * Analyze what the detector actually sees for correct vs incorrect detections.
 * Shows all candidate blobs that pass the HSV+shape filters for each capture.
 *
 * Usage: bun run scripts/analyze-dealer-blobs.ts
 */

import { readFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { DEALER_GROUND_TRUTH } from "../test/dealer-ground-truth";

const CAPTURES_DIR = "test/captures";
const ANALYSIS_WIDTH = 640;

// Match dealer-button.ts thresholds exactly
const MIN_HUE = 35;
const MAX_HUE = 65;
const MIN_SAT = 0.55;
const MIN_BRIGHTNESS = 140;
const MIN_BLOB_AREA = 10;
const MAX_BLOB_AREA = 200;
const MIN_FILL_RATIO = 0.50;
const MAX_ASPECT = 1.8;
const EXCLUDE_CENTER = { minX: 0.38, maxX: 0.62, minY: 0.28, maxY: 0.52 };
const EXCLUDE_BOTTOM_Y = 0.82;
const EXCLUDE_TOP_Y = 0.09;

interface Blob {
  area: number;
  bw: number;
  bh: number;
  relX: number;
  relY: number;
  fill: number;
  aspect: number;
  avgBrightness: number;
  avgSat: number;
}

async function analyzeCapture(ts: string): Promise<Blob[]> {
  const buf = readFileSync(join(CAPTURES_DIR, `${ts}.png`));
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) return [];

  const scale = ANALYSIS_WIDTH / meta.width;
  const h = Math.round(meta.height * scale);
  const w = ANALYSIS_WIDTH;

  const { data } = await sharp(buf)
    .resize(w, h)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // HSV mask
  const mask = new Uint8Array(w * h);
  const pixelBrightness = new Uint8Array(w * h);
  const pixelSat = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const relY = y / h;
    if (relY < EXCLUDE_TOP_Y || relY > EXCLUDE_BOTTOM_Y) continue;
    for (let x = 0; x < w; x++) {
      const relX = x / w;
      if (relX > EXCLUDE_CENTER.minX && relX < EXCLUDE_CENTER.maxX &&
          relY > EXCLUDE_CENTER.minY && relY < EXCLUDE_CENTER.maxY) continue;

      const i = (y * w + x) * 3;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
      if (max < MIN_BRIGHTNESS) continue;
      const sat = max === 0 ? 0 : delta / max;
      if (sat < MIN_SAT) continue;
      let hue = 0;
      if (delta > 0) {
        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * ((b - r) / delta + 2);
        else hue = 60 * ((r - g) / delta + 4);
        if (hue < 0) hue += 360;
      }
      if (hue >= MIN_HUE && hue <= MAX_HUE) {
        mask[y * w + x] = 1;
        pixelBrightness[y * w + x] = max;
        pixelSat[y * w + x] = sat;
      }
    }
  }

  // Connected components
  const labels = new Int32Array(w * h);
  let nextLabel = 1;
  const blobs: Blob[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] !== 1 || labels[idx] !== 0) continue;
      const label = nextLabel++;
      let minX = x, minY = y, maxX = x, maxY = y;
      let area = 0, sumX = 0, sumY = 0, sumBright = 0, sumSat = 0;
      const queue = [idx];
      labels[idx] = label;
      while (queue.length > 0) {
        const ci = queue.pop()!;
        const cx = ci % w, cy = (ci - cx) / w;
        area++; sumX += cx; sumY += cy;
        sumBright += pixelBrightness[ci];
        sumSat += pixelSat[ci];
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]] as const) {
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const ni = ny * w + nx;
            if (mask[ni] === 1 && labels[ni] === 0) { labels[ni] = label; queue.push(ni); }
          }
        }
      }

      if (area < MIN_BLOB_AREA || area > MAX_BLOB_AREA) continue;
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      const aspect = bw / bh;
      if (aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT) continue;
      const fill = area / (bw * bh);
      if (fill < MIN_FILL_RATIO) continue;

      blobs.push({
        area, bw, bh,
        relX: (sumX / area) / w,
        relY: (sumY / area) / h,
        fill, aspect,
        avgBrightness: sumBright / area,
        avgSat: sumSat / area,
      });
    }
  }

  return blobs;
}

async function main() {
  // Track all blobs across all captures to find persistent false positives
  const blobPositions: Map<string, { count: number; totalArea: number; avgBright: number }> = new Map();

  const entries = Object.entries(DEALER_GROUND_TRUTH);

  for (const [ts, expectedSeat] of entries) {
    const blobs = await analyzeCapture(ts);

    for (const b of blobs) {
      // Round position to find clusters
      const key = `${b.relX.toFixed(2)},${b.relY.toFixed(2)}`;
      const existing = blobPositions.get(key) || { count: 0, totalArea: 0, avgBright: 0 };
      existing.count++;
      existing.totalArea += b.area;
      existing.avgBright += b.avgBrightness;
      blobPositions.set(key, existing);
    }
  }

  // Show persistent blobs (appear in >10 captures = likely UI elements)
  console.log("=== Persistent blobs (appear in >10 of 72 captures) ===");
  console.log("These are likely UI elements, not the D button:\n");

  const persistent = [...blobPositions.entries()]
    .filter(([_, v]) => v.count > 10)
    .sort((a, b) => b[1].count - a[1].count);

  for (const [pos, stats] of persistent) {
    console.log(
      `  pos=(${pos}) count=${stats.count}/${entries.length} ` +
      `avgArea=${(stats.totalArea / stats.count).toFixed(0)} ` +
      `avgBright=${(stats.avgBright / stats.count).toFixed(0)}`
    );
  }

  // Now show blobs in a specific failing capture
  console.log("\n=== Detailed blob analysis for sample captures ===\n");

  // One where D is at seat 1
  for (const ts of ["2026-02-18T10-44-19-671Z", "2026-02-17T13-37-28-840Z", "2026-02-18T15-58-57-934Z"]) {
    const seat = DEALER_GROUND_TRUTH[ts];
    const blobs = await analyzeCapture(ts);
    console.log(`${ts} (D at seat ${seat}): ${blobs.length} blobs`);
    for (const b of blobs.sort((a, c) => c.area - a.area)) {
      console.log(
        `  area=${b.area.toString().padStart(3)} ${b.bw}x${b.bh} aspect=${b.aspect.toFixed(2)} fill=${b.fill.toFixed(2)} ` +
        `pos=(${b.relX.toFixed(3)}, ${b.relY.toFixed(3)}) bright=${b.avgBrightness.toFixed(0)} sat=${b.avgSat.toFixed(2)}`
      );
    }
    console.log();
  }
}

main().catch(console.error);
