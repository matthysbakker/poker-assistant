/**
 * Report which of the 52 reference cards are collected vs missing.
 *
 * Usage: bun run cards:status
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";

const REFERENCES_DIR = "data/card-references";

const RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS = ["s", "h", "d", "c"];
const SUIT_SYMBOLS: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

let collected = 0;
let missing = 0;

console.log("Card Reference Status");
console.log("=====================\n");

// Header
console.log("       " + SUITS.map((s) => ` ${SUIT_SYMBOLS[s]}  `).join(""));
console.log("      " + "----".repeat(SUITS.length));

for (const rank of RANKS) {
  const cells: string[] = [];
  for (const suit of SUITS) {
    const file = join(REFERENCES_DIR, `${rank}${suit}.png`);
    if (existsSync(file)) {
      cells.push(" ✓  ");
      collected++;
    } else {
      cells.push(" ·  ");
      missing++;
    }
  }
  const paddedRank = rank.padStart(4);
  console.log(`${paddedRank} |${cells.join("")}`);
}

console.log();
console.log(`Collected: ${collected}/52`);
console.log(`Missing:   ${missing}/52`);

if (collected > 0) {
  // List collected cards
  try {
    const files = readdirSync(REFERENCES_DIR)
      .filter((f) => f.endsWith(".png"))
      .map((f) => f.replace(".png", ""))
      .sort();
    console.log(`\nReferences: ${files.join(", ")}`);
  } catch {
    // Directory doesn't exist yet
  }
}

if (missing > 0 && collected === 0) {
  console.log("\nNo references yet. Run:");
  console.log("  bun run cards:extract    # Extract corners from captures");
  console.log("  bun run cards:label <image> <card>  # Label each corner");
}
