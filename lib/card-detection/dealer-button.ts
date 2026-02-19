import sharp from "sharp";

/**
 * Analysis width for dealer button detection.
 * At 960px, the D button at peripheral seats is ~5-8px — detectable.
 * 640px was too small (only 2-3px at seats 1, 2, 4, 5).
 */
const ANALYSIS_WIDTH = 960;

// --- HSV filter for Playtech dealer button (bright gold/yellow "D" chip) ---
// Calibrated from 73 annotated captures:
//   Real D button: H=38-58°, S=0.74-1.0, V=167-255, avgBrightness=229+
//   Persistent player stats: H=40-55°, S=0.74, V=193-195, avgBrightness<200
const MIN_HUE = 35;
const MAX_HUE = 65;
const MIN_SAT = 0.55;
const MIN_BRIGHTNESS = 140;

// Brightness threshold to separate real D button from persistent stat elements.
// Real D button: avgBrightness 229+. Persistent stats: 193-195. Threshold at 200.
const MIN_AVG_BRIGHTNESS = 200;

// --- Blob size filters at 960px analysis scale ---
const MIN_BLOB_AREA = 5;
const MAX_BLOB_AREA = 450;

// --- Shape filters ---
const MIN_FILL_RATIO = 0.45;
const MAX_ASPECT = 2.0;

// --- Position exclusion zones (relative coordinates) ---
// Center of table: community cards, pot text
const EXCLUDE_CENTER = { minX: 0.40, maxX: 0.60, minY: 0.28, maxY: 0.48 };
// Bottom UI: action buttons, bet slider
const EXCLUDE_BOTTOM_Y = 0.82;
// Top UI: menu bar + icons
const EXCLUDE_TOP_Y = 0.09;

/**
 * Expected D button positions for each seat (relative coordinates).
 * The D button sits on the table rim between the player and the table center.
 * Measured from annotated Playtech 6-max captures using visual crop analysis.
 *
 * Clockwise from hero: 0=hero(bottom), 1=bottom-left, 2=top-left,
 * 3=top-center, 4=top-right, 5=bottom-right.
 */
const SEAT_POSITIONS = [
  { x: 0.44, y: 0.63 }, // Seat 0: hero (bottom center) — large, obvious
  { x: 0.385, y: 0.63 }, // Seat 1: bottom-left — observed at x≈0.387
  { x: 0.36, y: 0.31 }, // Seat 2: top-left — observed at (0.362, 0.313)
  { x: 0.46, y: 0.25 }, // Seat 3: top-center — below player
  { x: 0.64, y: 0.31 }, // Seat 4: top-right — mirror of seat 2
  { x: 0.615, y: 0.63 }, // Seat 5: bottom-right — observed at x≈0.61
];

/** Maximum Euclidean distance (relative coords) to accept a seat match. */
const MAX_SEAT_DISTANCE = 0.12;

// --- Scoring weights for candidate ranking ---
const WEIGHT_PROXIMITY = 0.35;
const WEIGHT_BRIGHTNESS = 0.4;
const WEIGHT_CIRCULARITY = 0.25;

/**
 * Detect the dealer button ("D" chip) in a poker table screenshot.
 *
 * Pipeline:
 * 1. Downscale to 960px, extract raw RGB
 * 2. HSV filter for bright gold/yellow pixels (Playtech D button color)
 * 3. Exclude center (community cards), bottom (action buttons), top (UI)
 * 4. Connected component labeling on filtered mask
 * 5. Filter blobs by area, aspect ratio, fill ratio, brightness
 * 6. Map best candidate to nearest seat via Euclidean distance
 * 7. Score by brightness, proximity, and circularity
 *
 * Returns null if the button is not found (between hands, obscured, wrong client).
 */
export async function detectDealerButton(
  imageBuffer: Buffer,
): Promise<number | null> {
  const { data, info } = await sharp(imageBuffer)
    .resize(ANALYSIS_WIDTH, null)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;

  // Build binary mask from HSV filter
  const mask = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    const relY = y / h;
    if (relY < EXCLUDE_TOP_Y || relY > EXCLUDE_BOTTOM_Y) continue;

    for (let x = 0; x < w; x++) {
      const relX = x / w;

      // Skip center exclusion zone
      if (
        relX > EXCLUDE_CENTER.minX &&
        relX < EXCLUDE_CENTER.maxX &&
        relY > EXCLUDE_CENTER.minY &&
        relY < EXCLUDE_CENTER.maxY
      )
        continue;

      const i = (y * w + x) * 3;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;

      if (max < MIN_BRIGHTNESS) continue;
      const saturation = max === 0 ? 0 : delta / max;
      if (saturation < MIN_SAT) continue;

      // Compute hue (0-360 degrees)
      let hue = 0;
      if (delta > 0) {
        if (max === r) {
          hue = 60 * (((g - b) / delta) % 6);
        } else if (max === g) {
          hue = 60 * ((b - r) / delta + 2);
        } else {
          hue = 60 * ((r - g) / delta + 4);
        }
        if (hue < 0) hue += 360;
      }

      if (hue >= MIN_HUE && hue <= MAX_HUE) {
        mask[y * w + x] = 1;
      }
    }
  }

  // Connected component labeling (flood fill)
  const labels = new Int32Array(w * h);
  let nextLabel = 1;

  interface Blob {
    area: number;
    sumX: number;
    sumY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    sumBrightness: number;
  }

  const blobs: Blob[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] !== 1 || labels[idx] !== 0) continue;

      const label = nextLabel++;
      let minX = x,
        minY = y,
        maxX = x,
        maxY = y;
      let area = 0,
        sumX = 0,
        sumY = 0,
        sumBrightness = 0;

      const queue = [idx];
      labels[idx] = label;

      while (queue.length > 0) {
        const ci = queue.pop()!;
        const cx = ci % w;
        const cy = (ci - cx) / w;
        area++;
        sumX += cx;
        sumY += cy;

        const pi = ci * 3;
        sumBrightness += Math.max(data[pi], data[pi + 1], data[pi + 2]);

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        // 4-connected neighbors
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as const) {
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const ni = ny * w + nx;
            if (mask[ni] === 1 && labels[ni] === 0) {
              labels[ni] = label;
              queue.push(ni);
            }
          }
        }
      }

      blobs.push({ area, sumX, sumY, minX, maxX, minY, maxY, sumBrightness });
    }
  }

  // Filter and score candidates
  type Candidate = { seat: number; score: number };
  const candidates: Candidate[] = [];

  for (const blob of blobs) {
    if (blob.area < MIN_BLOB_AREA || blob.area > MAX_BLOB_AREA) continue;

    const bw = blob.maxX - blob.minX + 1;
    const bh = blob.maxY - blob.minY + 1;
    const aspect = bw / bh;
    if (aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT) continue;

    const fillRatio = blob.area / (bw * bh);
    if (fillRatio < MIN_FILL_RATIO) continue;

    const avgBrightness = blob.sumBrightness / blob.area;
    // Reject dim blobs — persistent player stat elements have avgBrightness ~193
    if (avgBrightness < MIN_AVG_BRIGHTNESS) continue;

    const centroidX = blob.sumX / blob.area;
    const centroidY = blob.sumY / blob.area;
    const relX = centroidX / w;
    const relY = centroidY / h;

    // Find nearest seat by Euclidean distance
    let bestSeat = -1;
    let bestDist = Infinity;

    for (let s = 0; s < SEAT_POSITIONS.length; s++) {
      const dx = relX - SEAT_POSITIONS[s].x;
      const dy = relY - SEAT_POSITIONS[s].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        bestSeat = s;
      }
    }

    if (bestDist > MAX_SEAT_DISTANCE) continue;

    // Score: prefer brighter, rounder blobs closer to seat positions
    const proximity = 1 - bestDist / MAX_SEAT_DISTANCE;
    const brightnessScore = Math.min(avgBrightness / 255, 1);
    const circularity = 1 - Math.abs(1 - aspect) / MAX_ASPECT;

    const score =
      proximity * WEIGHT_PROXIMITY +
      brightnessScore * WEIGHT_BRIGHTNESS +
      circularity * WEIGHT_CIRCULARITY;

    candidates.push({ seat: bestSeat, score });
  }

  if (candidates.length === 0) return null;

  // Pick highest scoring candidate
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].seat;
}
