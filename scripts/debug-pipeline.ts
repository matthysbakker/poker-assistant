/**
 * Debug: trace the full detection pipeline on a single capture.
 */
import { readFileSync } from "fs";
import sharp from "sharp";
import { locateCards } from "../lib/card-detection/locate";
import { cropCorner, matchCard } from "../lib/card-detection/match";
import { preprocessCrop } from "../lib/card-detection/preprocess";

const file = process.argv[2];
if (!file) {
  console.error("Usage: bun run scripts/debug-pipeline.ts <capture.png>");
  process.exit(1);
}

const imageBuffer = readFileSync(file);
const meta = await sharp(imageBuffer).metadata();
console.log(`Image: ${meta.width}x${meta.height}\n`);

// Step 1: Locate cards
const cards = await locateCards(imageBuffer);
console.log(`locateCards() returned ${cards.length} cards:`);
for (const card of cards) {
  console.log(`  ${card.group}: pos=(${card.x},${card.y}) size=${card.width}x${card.height}`);
  console.log(`    corner: (${card.corner.x},${card.corner.y}) ${card.corner.width}x${card.corner.height}`);
}

if (cards.length === 0) {
  console.log("\nNo cards located. Debugging threshold sensitivity...");

  // Try lower thresholds
  for (const threshold of [150, 130, 110, 90]) {
    const analysisWidth = 480;
    const scale = analysisWidth / meta.width!;
    const analysisHeight = Math.round(meta.height! * scale);

    const { data } = await sharp(imageBuffer)
      .resize(analysisWidth, analysisHeight)
      .greyscale()
      .blur(3)
      .raw()
      .toBuffer({ resolveWithObject: true });

    let brightCount = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] > threshold) brightCount++;
    }
    console.log(`  threshold=${threshold}: ${brightCount} bright pixels (${((brightCount / data.length) * 100).toFixed(1)}%)`);
  }
  process.exit(0);
}

// Step 2: Process each card
console.log("\nProcessing each located card:\n");
for (const card of cards) {
  console.log(`--- ${card.group} card at (${card.x},${card.y}) ---`);

  try {
    const cornerCrop = await cropCorner(imageBuffer, card);
    console.log(`  cropCorner: ${cornerCrop.length} bytes`);

    // Save corner crop for visual inspection
    const idx = cards.indexOf(card);
    await sharp(cornerCrop).toFile(`test/debug-corner-${idx}.png`);
    console.log(`  Saved to test/debug-corner-${idx}.png`);

    const preprocessed = await preprocessCrop(cornerCrop);
    if (!preprocessed) {
      console.log("  preprocessCrop: returned null (crop likely empty/blank)");
      continue;
    }
    console.log(`  preprocessCrop: ${preprocessed.length} bytes`);

    const match = matchCard(preprocessed, card.group);
    console.log(`  matchCard: card=${match.card ?? "null"} confidence=${match.confidence} score=${(match.matchScore * 100).toFixed(1)}% gap=${(match.gap * 100).toFixed(1)}%`);
  } catch (e: any) {
    console.log(`  ERROR: ${e.message}`);
  }
}
