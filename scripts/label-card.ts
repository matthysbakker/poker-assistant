/**
 * Label a card corner crop as a specific card reference.
 *
 * Usage: bun run cards:label <image.png> <card>
 *        bun run cards:label test/extracted-corners/heroL_xxx.png Kc
 *
 * Copies the image to data/card-references/<card>.png
 * If a reference already exists, it will be overwritten.
 */

import { copyFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const REFERENCES_DIR = "data/card-references";

const VALID_RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const VALID_SUITS = ["c", "d", "h", "s"];

const [imagePath, cardCode] = process.argv.slice(2);

if (!imagePath || !cardCode) {
  console.error("Usage: bun run cards:label <image.png> <card>");
  console.error("  card format: <rank><suit> where rank=2-10,J,Q,K,A and suit=c,d,h,s");
  console.error("  Example: bun run cards:label test/extracted-corners/heroL_xxx.png Kc");
  process.exit(1);
}

// Validate card code
const suit = cardCode.slice(-1);
const rank = cardCode.slice(0, -1);

if (!VALID_RANKS.includes(rank) || !VALID_SUITS.includes(suit)) {
  console.error(`Invalid card code: ${cardCode}`);
  console.error(`  Rank must be one of: ${VALID_RANKS.join(", ")}`);
  console.error(`  Suit must be one of: c (clubs), d (diamonds), h (hearts), s (spades)`);
  process.exit(1);
}

if (!existsSync(imagePath)) {
  console.error(`File not found: ${imagePath}`);
  process.exit(1);
}

mkdirSync(REFERENCES_DIR, { recursive: true });

const destPath = join(REFERENCES_DIR, `${cardCode}.png`);
const existed = existsSync(destPath);

copyFileSync(imagePath, destPath);

console.log(`${existed ? "Updated" : "Created"}: ${destPath}`);
console.log(`Card: ${rank}${suit === "c" ? "♣" : suit === "d" ? "♦" : suit === "h" ? "♥" : "♠"}`);
