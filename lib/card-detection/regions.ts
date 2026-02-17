import type { CardRegion } from "./types";

/**
 * Multi-resolution card position calibration.
 *
 * Positions are calibrated at two known resolutions from Holland Casino (Playtech/iPoker).
 * For other resolutions, positions are linearly interpolated/extrapolated from these
 * two data points, which accounts for non-proportional table scaling across aspect ratios.
 */

interface CalibrationPoint {
  width: number;
  height: number;
  cornerWidth: number;
  cornerHeight: number;
  heroL: { left: number; top: number };
  heroR: { left: number; top: number };
  comm: { startX: number; top: number; spacingX: number };
}

const CALIBRATIONS: [CalibrationPoint, CalibrationPoint] = [
  {
    // Retina / high-DPI capture
    width: 3024,
    height: 1566,
    cornerWidth: 80,
    cornerHeight: 120,
    heroL: { left: 1360, top: 960 },
    heroR: { left: 1500, top: 960 },
    comm: { startX: 1108, top: 520, spacingX: 163 },
  },
  {
    // Standard 1080p-ish capture
    width: 1920,
    height: 1057,
    cornerWidth: 51,
    cornerHeight: 81,
    heroL: { left: 860, top: 640 },
    heroR: { left: 955, top: 640 },
    comm: { startX: 695, top: 367, spacingX: 104 },
  },
];

/** Linearly interpolate a value between two calibration points based on image width. */
function lerp(v1: number, v2: number, w1: number, w2: number, w: number): number {
  if (w1 === w2) return v1;
  const t = (w - w1) / (w2 - w1);
  return Math.round(v1 + t * (v2 - v1));
}

/** Get all card regions computed for the given image dimensions. */
export function getRegions(width: number, height: number) {
  const [c1, c2] = CALIBRATIONS;

  // Use width as the primary interpolation axis
  const l = (v1: number, v2: number) => lerp(v1, v2, c1.width, c2.width, width);
  // Use height for vertical positions
  const lh = (v1: number, v2: number) => lerp(v1, v2, c1.height, c2.height, height);

  const cornerW = l(c1.cornerWidth, c2.cornerWidth);
  const cornerH = lh(c1.cornerHeight, c2.cornerHeight);

  const hero: CardRegion[] = [
    {
      name: "heroL",
      left: l(c1.heroL.left, c2.heroL.left),
      top: lh(c1.heroL.top, c2.heroL.top),
      width: cornerW,
      height: cornerH,
    },
    {
      name: "heroR",
      left: l(c1.heroR.left, c2.heroR.left),
      top: lh(c1.heroR.top, c2.heroR.top),
      width: cornerW,
      height: cornerH,
    },
  ];

  const commStartX = l(c1.comm.startX, c2.comm.startX);
  const commTop = lh(c1.comm.top, c2.comm.top);
  const commSpacing = l(c1.comm.spacingX, c2.comm.spacingX);

  const community: CardRegion[] = [];
  for (let i = 0; i < 5; i++) {
    community.push({
      name: `comm${i + 1}`,
      left: commStartX + i * commSpacing,
      top: commTop,
      width: cornerW,
      height: cornerH,
    });
  }

  return { hero, community };
}
