/**
 * Test dealer button detection accuracy against ground truth.
 *
 * Usage: bun run scripts/test-dealer-detection.ts
 */

import { readFileSync } from "fs";
import { join } from "path";
import { detectDealerButton } from "../lib/card-detection/dealer-button";
import { heroPosition } from "../lib/card-detection/position";
import { DEALER_GROUND_TRUTH } from "../test/dealer-ground-truth";

const CAPTURES_DIR = "test/captures";
const SEAT_NAMES = [
  "hero (bottom)",
  "bottom-left",
  "top-left",
  "top-center",
  "top-right",
  "bottom-right",
];

async function main() {
  const entries = Object.entries(DEALER_GROUND_TRUTH);
  console.log(`Testing ${entries.length} annotated captures...\n`);

  let correct = 0;
  let wrong = 0;
  let notFound = 0;
  const errors: string[] = [];

  for (const [ts, expectedSeat] of entries) {
    const file = `${ts}.png`;
    const buf = readFileSync(join(CAPTURES_DIR, file));
    const result = await detectDealerButton(buf);

    if (!result) {
      notFound++;
      errors.push(
        `  MISS  ${ts}: expected seat ${expectedSeat} (${SEAT_NAMES[expectedSeat]}), got: NOT FOUND`,
      );
    } else if (result.seat !== expectedSeat) {
      wrong++;
      errors.push(
        `  WRONG ${ts}: expected seat ${expectedSeat} (${SEAT_NAMES[expectedSeat]}), ` +
          `got seat ${result.seat} (${SEAT_NAMES[result.seat]}) ` +
          `conf=${result.confidence.toFixed(2)} pos=(${result.relX.toFixed(3)}, ${result.relY.toFixed(3)})`,
      );
    } else {
      correct++;
      const pos = heroPosition(result.seat);
      console.log(
        `  OK    ${ts}: seat ${result.seat} (${SEAT_NAMES[result.seat]}) → ${pos} ` +
          `conf=${result.confidence.toFixed(2)}`,
      );
    }
  }

  if (errors.length > 0) {
    console.log(`\n--- Errors ---`);
    for (const e of errors) console.log(e);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total:     ${entries.length}`);
  console.log(`Correct:   ${correct} (${((correct / entries.length) * 100).toFixed(1)}%)`);
  console.log(`Wrong:     ${wrong} (${((wrong / entries.length) * 100).toFixed(1)}%)`);
  console.log(`Not found: ${notFound} (${((notFound / entries.length) * 100).toFixed(1)}%)`);
}

main().catch(console.error);
