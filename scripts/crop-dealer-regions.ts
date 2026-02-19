/**
 * Extract small crops around expected D button positions for visual inspection.
 *
 * Usage: bun run scripts/crop-dealer-regions.ts [timestamp seat]
 *   No args: run default samples
 *   With args: crop specific capture at specific seat region
 */

import { readFileSync, mkdirSync } from "fs";
import { join } from "path";
import sharp from "sharp";

const CAPTURES_DIR = "test/captures";
const OUT_DIR = "test/debug-dealer-crops";

const SEAT_REGIONS: Record<number, { x1: number; y1: number; x2: number; y2: number }> = {
  0: { x1: 0.35, y1: 0.55, x2: 0.65, y2: 0.75 },
  1: { x1: 0.15, y1: 0.50, x2: 0.45, y2: 0.72 },
  2: { x1: 0.08, y1: 0.25, x2: 0.38, y2: 0.50 },
  3: { x1: 0.30, y1: 0.10, x2: 0.70, y2: 0.35 },
  4: { x1: 0.62, y1: 0.25, x2: 0.92, y2: 0.50 },
  5: { x1: 0.55, y1: 0.50, x2: 0.85, y2: 0.72 },
};

async function cropCapture(ts: string, seat: number) {
  const buf = readFileSync(join(CAPTURES_DIR, `${ts}.png`));
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) return;

  const region = SEAT_REGIONS[seat];
  const left = Math.round(region.x1 * meta.width);
  const top = Math.round(region.y1 * meta.height);
  const width = Math.round((region.x2 - region.x1) * meta.width);
  const height = Math.round((region.y2 - region.y1) * meta.height);

  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = join(OUT_DIR, `seat${seat}-${ts}.png`);
  await sharp(buf)
    .extract({ left, top, width, height })
    .resize(width * 2, height * 2, { kernel: "nearest" })
    .png()
    .toFile(outFile);

  console.log(`Saved ${outFile} (${width}x${height} → ${width * 2}x${height * 2})`);
}

async function main() {
  const [ts, seatStr] = process.argv.slice(2);
  if (ts && seatStr) {
    await cropCapture(ts, parseInt(seatStr));
  } else {
    // Default samples
    const samples: [string, number][] = [
      ["2026-02-18T10-48-45-232Z", 0],
      ["2026-02-18T10-44-19-671Z", 1],
      ["2026-02-18T10-49-46-086Z", 2],
      ["2026-02-18T10-45-53-473Z", 3],
      ["2026-02-18T10-46-34-098Z", 4],
      ["2026-02-18T10-47-29-405Z", 5],
    ];
    for (const [t, s] of samples) await cropCapture(t, s);
  }
}

main().catch(console.error);
