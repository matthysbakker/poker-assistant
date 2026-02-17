import sharp from "sharp";

/** Working size for binarization (before tight bbox). */
const WORK_W = 80;
const WORK_H = 120;

/** Output size after tight bbox crop. All comparisons use this size. */
export const OUTPUT_W = 32;
export const OUTPUT_H = 48;

/**
 * Find the tight bounding box of black pixels (value === 0) in a
 * single-channel binary buffer. Returns null if no black pixels found.
 */
function tightBBox(
  pixels: Buffer,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] === 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  if (!found) return null;

  // 1px padding to avoid clipping glyph edges
  const left = Math.max(0, minX - 1);
  const top = Math.max(0, minY - 1);
  const right = Math.min(width, maxX + 2);
  const bottom = Math.min(height, maxY + 2);

  const w = right - left;
  const h = bottom - top;
  if (w < 3 || h < 3) return null;

  return { left, top, width: w, height: h };
}

/**
 * Preprocess a card corner crop for template matching.
 *
 * Pipeline: resize → greyscale → normalise → threshold → tight bbox → resize
 *
 * Input: PNG buffer of the raw card corner crop (any size).
 * Output: Raw single-channel binary buffer at OUTPUT_W × OUTPUT_H,
 *         or null if the crop has no meaningful content.
 */
export async function preprocessCrop(cropPng: Buffer): Promise<Buffer | null> {
  // Step 1: Binarize at working size
  const { data, info } = await sharp(cropPng)
    .resize(WORK_W, WORK_H)
    .greyscale()
    .normalise()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Step 2: Find tight bounding box of black pixels
  const bbox = tightBBox(data, info.width, info.height);
  if (!bbox) return null;

  // Step 3: Crop to tight bbox and resize to standard output size
  const result = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 1 },
  })
    .extract(bbox)
    .resize(OUTPUT_W, OUTPUT_H, { fit: "fill" })
    .raw()
    .toBuffer();

  return result;
}

/**
 * Compare two preprocessed binary buffers.
 * Returns the fraction of matching pixels (0.0 to 1.0).
 */
export function compareBinary(a: Buffer, b: Buffer): number {
  let matching = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) matching++;
  }
  return matching / len;
}
