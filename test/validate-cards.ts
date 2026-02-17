import sharp from "sharp";
import { readdirSync, mkdirSync } from "fs";
import { join } from "path";

const CAPTURES_DIR = "test/captures";
const CROPS_DIR = "test/card-crops";

mkdirSync(CROPS_DIR, { recursive: true });

const files = readdirSync(CAPTURES_DIR)
  .filter((f) => f.endsWith(".png"))
  .sort();

console.log(`Found ${files.length} captures\n`);

for (const file of files) {
  const img = sharp(join(CAPTURES_DIR, file));
  const meta = await img.metadata();
  const w = meta.width!;
  const h = meta.height!;

  console.log(`${file}: ${w}x${h}`);

  // Hero cards: bottom center
  const heroLeft = Math.round(w * 0.4);
  const heroTop = Math.round(h * 0.62);
  const heroWidth = Math.round(w * 0.2);
  const heroHeight = Math.round(h * 0.18);

  await sharp(join(CAPTURES_DIR, file))
    .extract({ left: heroLeft, top: heroTop, width: heroWidth, height: heroHeight })
    .toFile(join(CROPS_DIR, `hero_${file}`));

  // Community cards: center top area
  const commLeft = Math.round(w * 0.28);
  const commTop = Math.round(h * 0.28);
  const commWidth = Math.round(w * 0.44);
  const commHeight = Math.round(h * 0.14);

  await sharp(join(CAPTURES_DIR, file))
    .extract({ left: commLeft, top: commTop, width: commWidth, height: commHeight })
    .toFile(join(CROPS_DIR, `comm_${file}`));
}

console.log(`\nCrops saved to ${CROPS_DIR}/`);
console.log("Inspect the crops visually to check if card regions are correctly captured.");
