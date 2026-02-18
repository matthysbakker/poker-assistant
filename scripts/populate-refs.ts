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
