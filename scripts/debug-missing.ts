import sharp from "sharp";
import { readFileSync } from "fs";
import { locateCards } from "../lib/card-detection/locate";
import { cropCorner, matchCard, clearReferenceCache } from "../lib/card-detection/match";
import { preprocessCrop } from "../lib/card-detection/preprocess";

clearReferenceCache();

async function debugCapture(filename: string, expected: string) {
  const buf = readFileSync(`test/captures/${filename}.png`);
  const cards = await locateCards(buf);
  const comm = cards.filter((c) => c.group === "community");

  console.log(`\n=== ${filename} (expected: ${expected}) ===`);
  for (const c of comm) {
    const corner = await cropCorner(buf, c);
    const preprocessed = await preprocessCrop(corner);
    if (preprocessed === null) {
      console.log(`  ${c.width}px at x=${c.x}: preprocessed=NULL`);
      continue;
    }
    const match = matchCard(preprocessed, c.group, c.width);
    console.log(
      `  ${c.width}px at x=${c.x}: ${match.card || "NONE"} ${match.confidence} score=${(match.matchScore * 100).toFixed(1)}% gap=${(match.gap * 100).toFixed(1)}%`,
    );
  }
}

await debugCapture("2026-02-17T13-39-46-183Z", "Jc 5c 2s 3d");
await debugCapture("2026-02-17T13-41-08-096Z", "Kc 4h 9h");
await debugCapture("2026-02-17T14-26-56-012Z", "Qc 10h 5h");
