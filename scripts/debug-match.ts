/**
 * Debug matching for a specific capture — shows verbose scores for each located card.
 * Usage: bun run scripts/debug-match.ts <capture.png>
 */
import { readFileSync } from "fs";
import { locateCards } from "../lib/card-detection/locate";
import { cropCorner, matchCard } from "../lib/card-detection/match";
import { preprocessCrop, compareBinary, OUTPUT_W, OUTPUT_H } from "../lib/card-detection/preprocess";
import sharp from "sharp";
import { readdirSync } from "fs";
import { join } from "path";
import type { CardCode, CardGroup } from "../lib/card-detection/types";

const REFS_DIR = join(process.cwd(), "data/card-references-v2");

const file = process.argv[2];
if (!file) {
  console.error("Usage: bun run scripts/debug-match.ts <capture.png>");
  process.exit(1);
}

const buf = readFileSync(file);
const cards = await locateCards(buf);

console.log(`Located ${cards.length} cards:\n`);

for (let i = 0; i < cards.length; i++) {
  const card = cards[i];
  console.log(`--- Card ${i} (${card.group}, w=${card.width}px) ---`);
  console.log(`    Corner: x=${card.corner.x} y=${card.corner.y} w=${card.corner.width} h=${card.corner.height}`);

  // Crop corner
  const cornerCrop = await cropCorner(buf, card);
  const cornerMeta = await sharp(cornerCrop).metadata();
  console.log(`    Corner crop: ${cornerMeta.width}x${cornerMeta.height}`);

  // Save corner crop for visual inspection
  await sharp(cornerCrop).toFile(`test/debug-match-corner-${i}.png`);

  // Preprocess
  const preprocessed = await preprocessCrop(cornerCrop);
  if (!preprocessed) {
    console.log(`    ❌ Preprocess returned null (no dark pixels found)`);
    continue;
  }

  // Save preprocessed for visual inspection
  await sharp(preprocessed, { raw: { width: OUTPUT_W, height: OUTPUT_H, channels: 1 } })
    .toFile(`test/debug-match-preprocessed-${i}.png`);

  // Match result
  const match = matchCard(preprocessed, card.group);
  console.log(`    Match: ${match.card ?? "NONE"} (${match.confidence}, score=${(match.matchScore * 100).toFixed(1)}%, gap=${(match.gap * 100).toFixed(1)}%)`);

  // Show top 5 scores against all refs in this group
  const refDir = join(REFS_DIR, card.group);
  const allScores: { card: string; variant: string; score: number }[] = [];

  try {
    const files = readdirSync(refDir).filter(f => f.endsWith(".bin"));
    for (const f of files) {
      const refBuf = readFileSync(join(refDir, f));
      const score = compareBinary(preprocessed, refBuf);
      const cardCode = f.replace(/_\d+\.bin$/, "");
      allScores.push({ card: cardCode, variant: f, score });
    }
  } catch {
    console.log(`    No refs in ${card.group}`);
    continue;
  }

  allScores.sort((a, b) => b.score - a.score);
  console.log(`    Top 10 matches:`);
  for (const s of allScores.slice(0, 10)) {
    console.log(`      ${s.card.padEnd(5)} (${s.variant.padEnd(15)}) = ${(s.score * 100).toFixed(2)}%`);
  }
  console.log();
}
