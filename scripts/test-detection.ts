/**
 * Run card detection on all captures and report results.
 *
 * Usage: bun run cards:test [<capture.png>]
 */

import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import { detectCards } from "../lib/card-detection";

const CAPTURES_DIR = "test/captures";

let files: string[];

if (process.argv[2]) {
  files = [process.argv[2]];
} else {
  files = readdirSync(CAPTURES_DIR)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => join(CAPTURES_DIR, f));
}

if (files.length === 0) {
  console.error("No captures found.");
  process.exit(1);
}

console.log(`Testing detection on ${files.length} capture(s)...\n`);

for (const file of files) {
  const base64 = readFileSync(file).toString("base64");
  const result = await detectCards(base64);

  console.log(`--- ${basename(file)} ---`);

  if (result.heroCards.length > 0) {
    console.log("  Hero:");
    for (const m of result.heroCards) {
      const conf = m.confidence.padEnd(6);
      const card = m.card ?? "[none]";
      console.log(`    ${m.region}: ${card} (${conf} score=${(m.matchScore * 100).toFixed(1)}% gap=${(m.gap * 100).toFixed(1)}%)`);
    }
  } else {
    console.log("  Hero: (no cards detected)");
  }

  if (result.communityCards.length > 0) {
    console.log("  Board:");
    for (const m of result.communityCards) {
      const conf = m.confidence.padEnd(6);
      const card = m.card ?? "[none]";
      console.log(`    ${m.region}: ${card} (${conf} score=${(m.matchScore * 100).toFixed(1)}% gap=${(m.gap * 100).toFixed(1)}%)`);
    }
  } else {
    console.log("  Board: (empty / preflop)");
  }

  if (result.detectedText) {
    console.log(`  → ${result.detectedText}`);
  }

  console.log(`  Timing: ${result.timing}ms\n`);
}
