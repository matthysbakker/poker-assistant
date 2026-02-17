/**
 * Calibration script: crops all card regions from a capture for visual inspection.
 *
 * Usage: bun run cards:calibrate <capture.png>
 *        bun run cards:calibrate  (uses first capture in test/captures/)
 *
 * Output: test/calibration/<regionName>.png for each hero + community position
 */

import sharp from "sharp";
import { mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";
import { getRegions } from "../lib/card-detection/regions";
import { cropRegionToFile } from "../lib/card-detection/match";

const OUTPUT_DIR = "test/calibration";
mkdirSync(OUTPUT_DIR, { recursive: true });

// Resolve input file
let inputFile = process.argv[2];
if (!inputFile) {
  const captures = readdirSync("test/captures")
    .filter((f) => f.endsWith(".png"))
    .sort();
  if (captures.length === 0) {
    console.error("No captures found in test/captures/");
    process.exit(1);
  }
  inputFile = join("test/captures", captures[0]);
  console.log(`No file specified, using: ${inputFile}`);
}

const metadata = await sharp(inputFile).metadata();
const width = metadata.width!;
const height = metadata.height!;
console.log(`Image: ${width}x${height}`);

const { hero, community } = getRegions(width, height);
const allRegions = [...hero, ...community];

const imageBuffer = await sharp(inputFile).toBuffer();
const tag = basename(inputFile, ".png");

for (const region of allRegions) {
  const outPath = join(OUTPUT_DIR, `${region.name}_${tag}.png`);
  await cropRegionToFile(imageBuffer, region, outPath);
  console.log(`  ${region.name}: left=${region.left} top=${region.top} → ${outPath}`);
}

console.log(`\nCropped ${allRegions.length} regions to ${OUTPUT_DIR}/`);
console.log("Inspect each crop — the card rank+suit should be clearly visible and centered.");
