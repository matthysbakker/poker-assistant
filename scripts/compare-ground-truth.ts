/**
 * Compare card detection results against ground truth.
 * Usage: bun run scripts/compare-ground-truth.ts
 */

import { readFileSync } from "fs";
import { join, basename } from "path";
import { detectCards } from "../lib/card-detection";
import { GROUND_TRUTH } from "../test/ground-truth";

const CAPTURES_DIR = "test/captures";

const entries = Object.entries(GROUND_TRUTH).sort(([a], [b]) =>
  a.localeCompare(b)
);

console.log(`Comparing detection against ${entries.length} ground truth entries...\n`);

let totalHeroExpected = 0;
let totalHeroCorrect = 0;
let totalHeroWrong = 0;
let totalHeroMissed = 0;
let totalHeroExtra = 0;

let totalBoardExpected = 0;
let totalBoardCorrect = 0;
let totalBoardWrong = 0;
let totalBoardMissed = 0;
let totalBoardExtra = 0;

let perfectCaptures = 0;
const errors: string[] = [];

for (const [ts, truth] of entries) {
  const file = join(CAPTURES_DIR, `${ts}.png`);
  const base64 = readFileSync(file).toString("base64");
  const result = await detectCards(base64);

  const detectedHero = result.heroCards
    .filter((m) => m.card)
    .map((m) => m.card!);
  const detectedBoard = result.communityCards
    .filter((m) => m.card)
    .map((m) => m.card!);

  const expectedHero: string[] = [...truth.hero];
  const expectedBoard: string[] = [...truth.community];

  // Compare hero cards (order-independent)
  const heroSet = new Set<string>(detectedHero);
  const boardSet = new Set<string>(detectedBoard);
  const expectedHeroSet = new Set<string>(expectedHero);
  const expectedBoardSet = new Set<string>(expectedBoard);

  const heroCorrect = expectedHero.filter((c) => heroSet.has(c));
  const heroMissed = expectedHero.filter((c) => !heroSet.has(c));
  const heroExtra = detectedHero.filter((c) => !expectedHeroSet.has(c));

  // Compare board cards (order-independent)
  const boardCorrect = expectedBoard.filter((c) => boardSet.has(c));
  const boardMissed = expectedBoard.filter((c) => !boardSet.has(c));
  const boardExtra = detectedBoard.filter((c) => !expectedBoardSet.has(c));

  totalHeroExpected += expectedHero.length;
  totalHeroCorrect += heroCorrect.length;
  totalHeroMissed += heroMissed.length;
  totalHeroExtra += heroExtra.length;

  totalBoardExpected += expectedBoard.length;
  totalBoardCorrect += boardCorrect.length;
  totalBoardMissed += boardMissed.length;
  totalBoardExtra += boardExtra.length;

  const isPerfect =
    heroMissed.length === 0 &&
    heroExtra.length === 0 &&
    boardMissed.length === 0 &&
    boardExtra.length === 0;

  if (isPerfect) {
    perfectCaptures++;
  } else {
    const parts: string[] = [];
    if (heroMissed.length > 0) parts.push(`hero missed: ${heroMissed.join(" ")}`);
    if (heroExtra.length > 0) parts.push(`hero extra: ${heroExtra.join(" ")}`);
    if (boardMissed.length > 0) parts.push(`board missed: ${boardMissed.join(" ")}`);
    if (boardExtra.length > 0) parts.push(`board extra: ${boardExtra.join(" ")}`);

    const line = `${ts}  ${parts.join(" | ")}`;
    errors.push(line);
    console.log(`MISS  ${line}`);
  }
}

const totalExpected = totalHeroExpected + totalBoardExpected;
const totalCorrect = totalHeroCorrect + totalBoardCorrect;
const totalMissed = totalHeroMissed + totalBoardMissed;
const totalExtra = totalHeroExtra + totalBoardExtra;

console.log(`\n${"=".repeat(70)}`);
console.log(`RESULTS: ${entries.length} captures, ${perfectCaptures} perfect (${((perfectCaptures / entries.length) * 100).toFixed(1)}%)\n`);

console.log(`Hero cards:  ${totalHeroCorrect}/${totalHeroExpected} correct (${((totalHeroCorrect / totalHeroExpected) * 100).toFixed(1)}%), ${totalHeroMissed} missed, ${totalHeroExtra} false positives`);
console.log(`Board cards: ${totalBoardCorrect}/${totalBoardExpected} correct (${((totalBoardCorrect / totalBoardExpected) * 100).toFixed(1)}%), ${totalBoardMissed} missed, ${totalBoardExtra} false positives`);
console.log(`Total cards: ${totalCorrect}/${totalExpected} correct (${((totalCorrect / totalExpected) * 100).toFixed(1)}%), ${totalMissed} missed, ${totalExtra} false positives`);

console.log(`\n${errors.length} captures with errors:`);
