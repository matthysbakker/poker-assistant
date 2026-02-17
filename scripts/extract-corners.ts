/**
 * Extract card corners from all captures for labeling.
 *
 * Usage: bun run cards:extract
 *
 * Output: test/extracted-corners/<regionName>_<timestamp>.png
 * Then use `cards:label` to label each corner as a specific card.
 */

import sharp from "sharp";
import { mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";
import { getRegions } from "../lib/card-detection/regions";
import { cropRegion, cropRegionToFile, isEmptyRegion } from "../lib/card-detection/match";

const CAPTURES_DIR = "test/captures";
const OUTPUT_DIR = "test/extracted-corners";

mkdirSync(OUTPUT_DIR, { recursive: true });

const files = readdirSync(CAPTURES_DIR)
  .filter((f) => f.endsWith(".png"))
  .sort();

if (files.length === 0) {
  console.error("No captures found in test/captures/");
  process.exit(1);
}

console.log(`Processing ${files.length} captures...\n`);

let extracted = 0;
let skippedEmpty = 0;

for (const file of files) {
  const filePath = join(CAPTURES_DIR, file);
  const imageBuffer = await sharp(filePath).toBuffer();
  const metadata = await sharp(imageBuffer).metadata();
  const { hero, community } = getRegions(metadata.width!, metadata.height!);
  const tag = basename(file, ".png");

  for (const region of [...hero, ...community]) {
    const pixels = await cropRegion(imageBuffer, region);

    if (isEmptyRegion(pixels)) {
      skippedEmpty++;
      continue;
    }

    const outPath = join(OUTPUT_DIR, `${region.name}_${tag}.png`);
    await cropRegionToFile(imageBuffer, region, outPath);
    extracted++;
  }
}

console.log(`Extracted: ${extracted} card corners`);
console.log(`Skipped:   ${skippedEmpty} empty positions`);
console.log(`Output:    ${OUTPUT_DIR}/`);
console.log(`\nNext: inspect each image, then label with:`);
console.log(`  bun run cards:label <image.png> <card>`);
console.log(`  Example: bun run cards:label test/extracted-corners/heroL_xxx.png Kc`);
