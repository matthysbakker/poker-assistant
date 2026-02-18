/**
 * Populate group-based references from test captures using the card locator.
 *
 * Saves multiple reference variants per card from different board positions
 * and captures to improve cross-position matching accuracy.
 *
 * Usage: bun run scripts/populate-refs.ts
 */

import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import { locateCards } from "../lib/card-detection/locate";
import { cropCorner, saveReference } from "../lib/card-detection/match";
import { preprocessCrop } from "../lib/card-detection/preprocess";
import type { CardCode } from "../lib/card-detection/types";

const CAPTURES_DIR = "test/captures";

// Ground truth: timestamp → expected cards (hero left-to-right, community left-to-right)
const GROUND_TRUTH: Record<string, { hero: string[]; community: string[] }> = {
  "2026-02-17T13-37-28-840Z": { hero: ["Kc", "Jd"], community: [] },
  "2026-02-17T13-37-56-433Z": { hero: ["Kc", "Jd"], community: ["Ah", "4h", "Jc"] },
  "2026-02-17T13-38-53-206Z": { hero: ["8c", "Qc"], community: [] },
  "2026-02-17T13-39-01-369Z": { hero: ["8c", "Qc"], community: [] },
  "2026-02-17T13-39-46-183Z": { hero: ["8c", "Qc"], community: ["Jc", "5c", "2s", "3d"] },
  "2026-02-17T13-40-46-504Z": { hero: ["Qh", "10h"], community: [] },
  "2026-02-17T13-41-08-096Z": { hero: ["Qh", "10h"], community: ["Kc", "4h", "9h"] },
  "2026-02-17T13-41-25-899Z": { hero: ["Qh", "10h"], community: ["Kc", "4h", "9h", "Qs"] },
  "2026-02-17T13-44-37-752Z": { hero: ["Qd", "Qs"], community: [] },
  "2026-02-17T14-25-45-727Z": { hero: ["3d", "5c"], community: [] },
  "2026-02-17T14-26-05-475Z": { hero: ["Ah", "Jd"], community: [] },
  "2026-02-17T14-26-56-012Z": { hero: ["Ah", "Jd"], community: ["Qc", "10h", "5h"] },
  "2026-02-17T14-27-22-803Z": { hero: ["Ah", "Jd"], community: ["Qc", "10h", "5h", "Kh"] },
  "2026-02-17T14-28-23-356Z": { hero: ["4s", "3s"], community: [] },
  "2026-02-17T14-31-56-491Z": { hero: ["4c", "7h"], community: [] },
  "2026-02-17T14-35-15-232Z": { hero: ["Kh", "6h"], community: ["2c", "4d", "3s", "9d"] },
  "2026-02-17T14-36-28-902Z": { hero: ["Ks", "Kd"], community: [] },
  "2026-02-17T22-03-53-545Z": { hero: ["Qc", "3c"], community: [] },
  "2026-02-17T23-34-25-924Z": { hero: ["Ad", "9d"], community: [] },
  "2026-02-17T23-36-03-587Z": { hero: ["10s", "Qs"], community: [] },
  "2026-02-17T23-36-29-216Z": { hero: ["Ad", "10h"], community: [] },
  // 2026-02-18 session — 1920x1057 captures
  "2026-02-18T10-37-19-292Z": { hero: ["2d", "8h"], community: [] },
  "2026-02-18T10-37-28-999Z": { hero: ["6d", "As"], community: [] },
  "2026-02-18T10-38-07-553Z": { hero: ["Ad", "3s"], community: [] },
  "2026-02-18T10-39-09-673Z": { hero: ["Ad", "3s"], community: ["3d", "5s", "3c", "Kd", "10h"] },
  "2026-02-18T10-40-46-393Z": { hero: ["Kd", "7h"], community: [] },
  "2026-02-18T10-41-50-700Z": { hero: ["10c", "7s"], community: [] },
  "2026-02-18T10-42-29-143Z": { hero: ["Kc", "3d"], community: [] },
  // 2026-02-18 session — 1920x1003 captures
  "2026-02-18T10-43-46-462Z": { hero: ["4d", "9h"], community: [] },
  "2026-02-18T10-44-19-671Z": { hero: ["Ah", "7c"], community: [] },
  "2026-02-18T10-44-42-297Z": { hero: ["Ah", "7c"], community: ["5s", "6c", "9c", "3s"] },
  "2026-02-18T10-45-07-857Z": { hero: ["Ah", "7c"], community: ["5s", "6c", "9c", "3s", "8h"] },
  "2026-02-18T10-45-53-473Z": { hero: ["4c", "6d"], community: [] },
  "2026-02-18T10-46-34-098Z": { hero: ["10h", "6d"], community: [] },
  "2026-02-18T10-48-10-309Z": { hero: ["6s", "Js"], community: [] },
  "2026-02-18T10-48-45-232Z": { hero: ["6s", "Js"], community: ["Qs", "Jc", "7d"] },
  "2026-02-18T10-49-35-186Z": { hero: ["4d", "7s"], community: [] },
  "2026-02-18T10-49-46-086Z": { hero: ["Kh", "2c"], community: [] },
  "2026-02-18T10-50-08-775Z": { hero: ["Qh", "Kh"], community: [] },
  "2026-02-18T10-50-50-026Z": { hero: ["Qh", "Kh"], community: ["4h", "2c", "3c", "3d", "5s"] },
  "2026-02-18T10-51-06-252Z": { hero: ["6d", "Kc"], community: [] },
  "2026-02-18T10-51-40-478Z": { hero: ["7d", "9c"], community: [] },
};

const files = readdirSync(CAPTURES_DIR).filter((f) => f.endsWith(".png")).sort();

let saved = 0;
let skipped = 0;
let errors = 0;

for (const file of files) {
  const ts = basename(file, ".png");
  const truth = GROUND_TRUTH[ts];
  if (!truth) continue;

  const buf = readFileSync(join(CAPTURES_DIR, file));
  const cards = await locateCards(buf);

  const heroCards = cards.filter((c) => c.group === "hero");
  const commCards = cards.filter((c) => c.group === "community");

  // Save hero card references
  for (let i = 0; i < Math.min(heroCards.length, truth.hero.length); i++) {
    const card = heroCards[i];
    const cardCode = truth.hero[i] as CardCode;

    try {
      const cornerCrop = await cropCorner(buf, card);
      const preprocessed = await preprocessCrop(cornerCrop);
      if (!preprocessed) {
        errors++;
        continue;
      }

      saveReference(preprocessed, "hero", card.width, cardCode);
      saved++;
      console.log(`  hero/${cardCode} (w=${card.width}px) from ${ts}`);
    } catch (e: any) {
      console.log(`  ERROR hero ${cardCode}: ${e.message}`);
      errors++;
    }
  }

  // Save community card references
  for (let i = 0; i < Math.min(commCards.length, truth.community.length); i++) {
    const card = commCards[i];
    const cardCode = truth.community[i] as CardCode;

    try {
      const cornerCrop = await cropCorner(buf, card);
      const preprocessed = await preprocessCrop(cornerCrop);
      if (!preprocessed) {
        errors++;
        continue;
      }

      saveReference(preprocessed, "community", card.width, cardCode);
      saved++;
      console.log(`  community/${cardCode} (w=${card.width}px) from ${ts}`);
    } catch (e: any) {
      console.log(`  ERROR community ${cardCode}: ${e.message}`);
      errors++;
    }
  }
}

console.log(`\nDone: ${saved} saved, ${errors} errors`);
