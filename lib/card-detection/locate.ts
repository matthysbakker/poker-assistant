import sharp from "sharp";
import type { LocatedCard } from "./types";

/** Target width for the downscaled analysis image. */
const ANALYSIS_WIDTH = 480;

/** Gaussian blur sigma before thresholding (smooths card interior details). */
const BLUR_SIGMA = 3;

/** Greyscale threshold after blur to isolate bright card pixels. */
const BRIGHTNESS_THRESHOLD = 150;

/** Minimum blob area at analysis scale (filters noise/small UI elements). */
const MIN_AREA = 200;

/** Minimum blob height at analysis scale. */
const MIN_HEIGHT = 14;

/** Maximum aspect ratio for blobs (width/height). Wider = buttons/text. */
const MAX_BLOB_ASPECT = 3.0;

/** Minimum fill ratio (bright pixels / bounding box area). */
const MIN_FILL_RATIO = 0.50;

/**
 * Horizontal center constraint: cards are centered on the table.
 * Hero cards at relX ≈ 0.50, community at 0.36–0.63.
 * This filters buttons (relX > 0.85) and opponent cards (relX ≈ 0.33).
 */
const MIN_REL_X = 0.35;
const MAX_REL_X = 0.65;

/** Expected single card aspect ratio (width/height). */
const SINGLE_CARD_ASPECT = 0.70;

/** Threshold: blobs wider than this (w/h) are multi-card groups to split. */
const SPLIT_ASPECT_THRESHOLD = 0.90;

/** Corner crop: fraction of card width and height for rank/suit region. */
const CORNER_WIDTH_FRAC = 0.35;
const CORNER_HEIGHT_FRAC = 0.50;

/**
 * Locate card rectangles in a poker screenshot.
 *
 * Pipeline:
 * 1. Downscale to ~480px width, greyscale, blur
 * 2. Threshold → binary mask of bright regions
 * 3. Connected component labeling via flood fill
 * 4. Filter by size, aspect ratio, fill ratio
 * 5. Split wide blobs (hero cards merge at this scale)
 * 6. Classify by vertical position (bottom = hero, middle = community)
 * 7. Compute corner crop regions for rank/suit detection
 */
export async function locateCards(
  imageBuffer: Buffer,
): Promise<LocatedCard[]> {
  const metadata = await sharp(imageBuffer).metadata();
  const origWidth = metadata.width!;
  const origHeight = metadata.height!;

  const scale = ANALYSIS_WIDTH / origWidth;
  const analysisHeight = Math.round(origHeight * scale);

  // Two passes: blurred for blob detection, un-blurred for verification
  const [blurred, unblurred] = await Promise.all([
    sharp(imageBuffer)
      .resize(ANALYSIS_WIDTH, analysisHeight)
      .greyscale()
      .blur(BLUR_SIGMA)
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(imageBuffer)
      .resize(ANALYSIS_WIDTH, analysisHeight)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);

  const data = blurred.data;
  const w = blurred.info.width;
  const h = blurred.info.height;
  const rawData = unblurred.data;

  // Binary mask from blurred image (smooths card interiors)
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) {
    mask[i] = data[i] > BRIGHTNESS_THRESHOLD ? 1 : 0;
  }

  // Connected component labeling (flood fill)
  const labels = new Int32Array(w * h);
  let nextLabel = 1;

  interface Component {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    area: number;
  }

  const components: Component[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] === 1 && labels[idx] === 0) {
        const label = nextLabel++;
        let minX = x,
          minY = y,
          maxX = x,
          maxY = y;
        let area = 0;

        const queue = [idx];
        labels[idx] = label;

        while (queue.length > 0) {
          const ci = queue.pop()!;
          const cx = ci % w;
          const cy = (ci - cx) / w;
          area++;

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          // 4-connected neighbors
          const neighbors = [
            [cx - 1, cy],
            [cx + 1, cy],
            [cx, cy - 1],
            [cx, cy + 1],
          ];
          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const ni = ny * w + nx;
              if (mask[ni] === 1 && labels[ni] === 0) {
                labels[ni] = label;
                queue.push(ni);
              }
            }
          }
        }

        components.push({ minX, minY, maxX, maxY, area });
      }
    }
  }

  // Filter and classify blobs
  const invScale = origWidth / ANALYSIS_WIDTH;
  const cards: LocatedCard[] = [];

  for (const comp of components) {
    const bw = comp.maxX - comp.minX + 1;
    const bh = comp.maxY - comp.minY + 1;
    const aspect = bw / bh;
    const fillRatio = comp.area / (bw * bh);

    // Size and shape filters
    if (comp.area < MIN_AREA) continue;
    if (bh < MIN_HEIGHT) continue;
    if (aspect > MAX_BLOB_ASPECT) continue;
    if (fillRatio < MIN_FILL_RATIO) continue;

    // Horizontal center filter (cards are centered, buttons/opponent cards aren't)
    const centerX = (comp.minX + comp.maxX) / 2;
    const relX = centerX / w;
    if (relX < MIN_REL_X || relX > MAX_REL_X) continue;

    // Classify by vertical position
    const centerY = (comp.minY + comp.maxY) / 2;
    const relY = centerY / h;
    let group: "hero" | "community";
    if (relY > 0.55) {
      group = "hero";
    } else if (relY > 0.25) {
      group = "community";
    } else {
      continue; // Top UI elements
    }

    // Check if blob is a multi-card group that needs splitting
    if (aspect > SPLIT_ASPECT_THRESHOLD) {
      // Hero always has exactly 2 cards in Hold'em
      const numCards = group === "hero" ? 2 : Math.max(2, Math.round(aspect / SINGLE_CARD_ASPECT));
      const cardWidthAnalysis = bw / numCards;

      for (let i = 0; i < numCards; i++) {
        const cardMinX = comp.minX + Math.round(i * cardWidthAnalysis);
        const cardMaxX = comp.minX + Math.round((i + 1) * cardWidthAnalysis) - 1;
        const cw = cardMaxX - cardMinX + 1;
        if (isBrightInOriginal(rawData, w, cardMinX, comp.minY, cw, bh)) {
          addCard(cards, rawData, w, cardMinX, comp.minY, cw, bh, group, invScale);
        }
      }
    } else {
      if (isBrightInOriginal(rawData, w, comp.minX, comp.minY, bw, bh)) {
        addCard(cards, rawData, w, comp.minX, comp.minY, bw, bh, group, invScale);
      }
    }
  }

  // Sort: community first (left-to-right), then hero (left-to-right)
  cards.sort((a, b) => {
    if (a.group !== b.group) return a.group === "community" ? -1 : 1;
    return a.x - b.x;
  });

  return cards;
}

/**
 * Verify a candidate card region is bright in the un-blurred image.
 * Prevents blur artifacts from being detected as cards.
 */
function isBrightInOriginal(
  rawData: Buffer,
  width: number,
  ax: number,
  ay: number,
  aw: number,
  ah: number,
): boolean {
  // Sample the center portion of the region in the un-blurred image
  const margin = Math.floor(Math.min(aw, ah) * 0.2);
  const x0 = ax + margin;
  const y0 = ay + margin;
  const x1 = ax + aw - margin;
  const y1 = ay + ah - margin;

  let bright = 0;
  let total = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      total++;
      if (rawData[y * width + x] > 180) bright++;
    }
  }

  // A real card should have at least 20% bright pixels in un-blurred image
  return total > 0 && bright / total > 0.20;
}

/**
 * Create a LocatedCard from analysis-scale coordinates.
 * Refines the top-left corner using the un-blurred image for precise alignment.
 */
function addCard(
  cards: LocatedCard[],
  rawData: Buffer,
  imgWidth: number,
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  group: "hero" | "community",
  invScale: number,
): void {
  // Refine the top-left corner: scan from the blob edge inward to find
  // the precise card boundary (brightness transition in un-blurred image)
  const EDGE_THRESHOLD = 180;

  // Find precise left edge: scan columns from left until we find one with enough bright pixels
  let refinedX = ax;
  for (let x = ax; x < ax + aw; x++) {
    let bright = 0;
    for (let y = ay + 2; y < ay + ah - 2; y++) {
      if (rawData[y * imgWidth + x] > EDGE_THRESHOLD) bright++;
    }
    if (bright > (ah - 4) * 0.3) {
      refinedX = x;
      break;
    }
  }

  // Find precise top edge
  let refinedY = ay;
  for (let y = ay; y < ay + ah; y++) {
    let bright = 0;
    for (let x = refinedX + 2; x < ax + aw - 2; x++) {
      if (rawData[y * imgWidth + x] > EDGE_THRESHOLD) bright++;
    }
    if (bright > (aw - 4) * 0.3) {
      refinedY = y;
      break;
    }
  }

  // Scale to original coordinates
  const x = Math.round(refinedX * invScale);
  const y = Math.round(refinedY * invScale);
  const width = Math.round(aw * invScale);
  const height = Math.round(ah * invScale);

  const cornerW = Math.round(width * CORNER_WIDTH_FRAC);
  // Derive corner height from card WIDTH (not blob height) for consistency.
  // Blob height varies ±4px between sessions due to shadow/reflection detection,
  // but width is stable. Use expected card aspect ratio to estimate true height.
  const expectedHeight = Math.round(width / SINGLE_CARD_ASPECT);
  const cornerH = Math.round(expectedHeight * CORNER_HEIGHT_FRAC);

  cards.push({
    group,
    x,
    y,
    width,
    height,
    corner: { x, y, width: cornerW, height: cornerH },
  });
}

