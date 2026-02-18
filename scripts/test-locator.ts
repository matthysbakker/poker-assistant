/**
 * Test the card locator on all captures.
 *
 * Usage: bun run scripts/test-locator.ts
 */

import sharp from "sharp";
import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import { locateCards } from "../lib/card-detection/locate";

const CAPTURES_DIR = "test/captures";
const files = readdirSync(CAPTURES_DIR).filter((f) => f.endsWith(".png")).sort();

// Ground truth for expected card counts
const EXPECTED: Record<string, { hero: number; community: number }> = {
  "2026-02-17T13-37-28-840Z": { hero: 2, community: 0 },
  "2026-02-17T13-37-56-433Z": { hero: 2, community: 3 },
  "2026-02-17T13-38-53-206Z": { hero: 2, community: 0 },
  "2026-02-17T13-39-01-369Z": { hero: 2, community: 0 },
  "2026-02-17T13-39-46-183Z": { hero: 2, community: 4 },
  "2026-02-17T13-40-46-504Z": { hero: 2, community: 0 },
  "2026-02-17T13-41-08-096Z": { hero: 2, community: 3 },
  "2026-02-17T13-41-25-899Z": { hero: 2, community: 4 },
  "2026-02-17T13-44-37-752Z": { hero: 2, community: 0 },
  "2026-02-17T14-25-45-727Z": { hero: 2, community: 0 },
  "2026-02-17T14-26-05-475Z": { hero: 2, community: 0 },
  "2026-02-17T14-26-56-012Z": { hero: 2, community: 3 },
  "2026-02-17T14-27-22-803Z": { hero: 2, community: 4 },
  "2026-02-17T14-28-23-356Z": { hero: 2, community: 0 },
  "2026-02-17T14-31-56-491Z": { hero: 2, community: 0 },
  "2026-02-17T14-35-15-232Z": { hero: 2, community: 4 },
  "2026-02-17T14-36-28-902Z": { hero: 2, community: 0 },
  "2026-02-17T22-03-53-545Z": { hero: 2, community: 0 },
  // New 1920x1003 captures — guessed counts (preflop with 2 hero cards)
  "2026-02-17T23-34-25-924Z": { hero: 2, community: 0 },
  "2026-02-17T23-36-03-587Z": { hero: 2, community: 0 },
  "2026-02-17T23-36-29-216Z": { hero: 2, community: 0 },
};

let pass = 0;
let fail = 0;

for (const file of files) {
  const ts = basename(file, ".png");
  const buf = readFileSync(join(CAPTURES_DIR, file));
  const meta = await sharp(buf).metadata();

  const cards = await locateCards(buf);

  const heroCount = cards.filter((c) => c.group === "hero").length;
  const commCount = cards.filter((c) => c.group === "community").length;

  const expected = EXPECTED[ts];
  const heroOk = expected ? heroCount === expected.hero : true;
  const commOk = expected ? commCount === expected.community : true;

  const status = heroOk && commOk ? "OK" : "FAIL";
  if (status === "OK") pass++;
  else fail++;

  const dims = meta.width + "x" + meta.height;
  const expectedStr = expected
    ? `exp=${expected.hero}h/${expected.community}c`
    : "no truth";
  console.log(
    `${status.padEnd(5)} ${ts} (${dims}) hero=${heroCount} comm=${commCount} [${expectedStr}]`,
  );

  if (status !== "OK") {
    for (const c of cards) {
      console.log(
        `      ${c.group.padEnd(9)} ${c.width}x${c.height} at (${c.x},${c.y}) corner=${c.corner.width}x${c.corner.height}`,
      );
    }
  }
}

console.log(`\nPass: ${pass}/${files.length}, Fail: ${fail}`);
