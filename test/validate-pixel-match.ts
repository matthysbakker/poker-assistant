import sharp from "sharp";
import { readdirSync, mkdirSync } from "fs";
import { join } from "path";

const CAPTURES_DIR = "test/captures";
const CORNERS_DIR = "test/card-corners";

mkdirSync(CORNERS_DIR, { recursive: true });

const files = readdirSync(CAPTURES_DIR)
  .filter((f) => f.endsWith(".png"))
  .sort();

// At 3024x1566, hero cards are centered at bottom.
// The rank+suit indicator is in the top-left corner of each card.
// Hero left card top-left corner (rank+suit area):
// Approximate card positions from the crops we saw:

// Hero card region: left=40%, top=62%, width=20%, height=18%
// Each card is roughly half that width = 10% of image width
// The rank+suit corner is in the top ~30% of the card, left ~40% of the card

const W = 3024;
const H = 1566;

// Hero left card: approximately x=1210-1410, y=970-1100 (the full card)
// Hero right card: approximately x=1510-1710, y=970-1100

// Let's be more precise. From the crops:
// Hero region starts at x=1210 (40% of 3024), y=971 (62% of 1566)
// Hero region is 605w x 282h
// Left card occupies roughly left half: x=1210-1510
// Right card: x=1510-1810

// The rank+suit corner is top-left of each card, roughly 60x90 pixels

interface CardCrop {
  name: string;
  file: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const crops: CardCrop[] = [];

// For each capture, extract hero left card corner and hero right card corner
for (const file of files) {
  // Hero left card rank+suit corner
  crops.push({
    name: `heroL`,
    file,
    left: 1230,
    top: 975,
    width: 80,
    height: 120,
  });

  // Hero right card rank+suit corner
  crops.push({
    name: `heroR`,
    file,
    left: 1530,
    top: 975,
    width: 80,
    height: 120,
  });
}

// Extract all corners
for (const crop of crops) {
  const outName = `${crop.name}_${crop.file}`;
  await sharp(join(CAPTURES_DIR, crop.file))
    .extract({
      left: crop.left,
      top: crop.top,
      width: crop.width,
      height: crop.height,
    })
    .toFile(join(CORNERS_DIR, outName));
}

console.log(`Extracted ${crops.length} card corners to ${CORNERS_DIR}/`);

// Now compare corners pixel-by-pixel
console.log("\n--- Pixel comparison ---");

const cornerFiles = readdirSync(CORNERS_DIR)
  .filter((f) => f.endsWith(".png"))
  .sort();

// Load all corner images as raw pixel buffers
const buffers: Map<string, Buffer> = new Map();
for (const f of cornerFiles) {
  const { data } = await sharp(join(CORNERS_DIR, f)).raw().toBuffer({ resolveWithObject: true });
  buffers.set(f, data);
}

// Compare every pair
const compared = new Set<string>();
for (const a of cornerFiles) {
  for (const b of cornerFiles) {
    if (a >= b) continue;
    const key = `${a}|${b}`;
    if (compared.has(key)) continue;
    compared.add(key);

    const bufA = buffers.get(a)!;
    const bufB = buffers.get(b)!;

    if (bufA.length !== bufB.length) continue;

    let diffPixels = 0;
    const totalPixels = bufA.length / 3; // RGB
    for (let i = 0; i < bufA.length; i += 3) {
      const dr = Math.abs(bufA[i] - bufB[i]);
      const dg = Math.abs(bufA[i + 1] - bufB[i + 1]);
      const db = Math.abs(bufA[i + 2] - bufB[i + 2]);
      if (dr + dg + db > 30) diffPixels++;
    }

    const similarity = ((1 - diffPixels / totalPixels) * 100).toFixed(1);
    if (Number(similarity) > 90) {
      console.log(`${similarity}% match: ${a} ↔ ${b}`);
    }
  }
}

console.log("\nDone. High-similarity pairs (>90%) likely show the same card.");
