/**
 * Debug: visualize preprocessed binary patterns for a capture vs references.
 */
import { readFileSync } from "fs";
import sharp from "sharp";
import { locateCards } from "../lib/card-detection/locate";
import { cropCorner } from "../lib/card-detection/match";
import { preprocessCrop, OUTPUT_W, OUTPUT_H, compareBinary } from "../lib/card-detection/preprocess";

const file = process.argv[2];
if (!file) {
  console.error("Usage: bun run scripts/debug-binary.ts <capture.png>");
  process.exit(1);
}

const imageBuffer = readFileSync(file);
const cards = await locateCards(imageBuffer);
console.log(`Found ${cards.length} cards\n`);

for (let i = 0; i < cards.length; i++) {
  const card = cards[i];
  console.log(`Card ${i}: ${card.group} at (${card.x},${card.y}) ${card.width}x${card.height}`);
  console.log(`  Corner: ${card.corner.width}x${card.corner.height}`);

  const cornerCrop = await cropCorner(imageBuffer, card);
  const preprocessed = await preprocessCrop(cornerCrop);
  if (!preprocessed) {
    console.log("  Preprocessed: null\n");
    continue;
  }

  // Save as PNG for visual inspection
  await sharp(preprocessed, { raw: { width: OUTPUT_W, height: OUTPUT_H, channels: 1 } })
    .resize(OUTPUT_W * 4, OUTPUT_H * 4, { kernel: "nearest" })
    .png()
    .toFile(`test/debug-binary-test-${i}.png`);
  console.log(`  Saved test binary to test/debug-binary-test-${i}.png`);

  // Load matching reference and save it too
  const { readdirSync } = await import("fs");
  const { join } = await import("path");
  const refDir = join("data/card-references-v2", card.group);

  try {
    const refs = readdirSync(refDir).filter((f) => f.endsWith(".bin"));
    // Find top 3 best matching refs
    const scores: { file: string; score: number }[] = [];
    for (const refFile of refs) {
      const refBuf = readFileSync(join(refDir, refFile));
      const score = compareBinary(preprocessed, refBuf);
      scores.push({ file: refFile, score });
    }
    scores.sort((a, b) => b.score - a.score);
    console.log(`  Top matches from ${refDir}:`);
    for (const s of scores.slice(0, 5)) {
      console.log(`    ${s.file}: ${(s.score * 100).toFixed(1)}%`);
    }

    // Save top reference as PNG for comparison
    if (scores.length > 0) {
      const topRefBuf = readFileSync(join(refDir, scores[0].file));
      await sharp(topRefBuf, { raw: { width: OUTPUT_W, height: OUTPUT_H, channels: 1 } })
        .resize(OUTPUT_W * 4, OUTPUT_H * 4, { kernel: "nearest" })
        .png()
        .toFile(`test/debug-binary-ref-${i}.png`);
      console.log(`  Saved best ref binary to test/debug-binary-ref-${i}.png`);
    }
  } catch (e) {
    console.log(`  No refs in ${refDir}`);
  }
  console.log();
}
