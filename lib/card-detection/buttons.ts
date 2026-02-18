import sharp from "sharp";

/**
 * Detect whether hero's action buttons (Fold/Call/Raise) are visible.
 *
 * Holland Casino (Playtech) shows bright colored buttons at the bottom-right
 * when it's the hero's turn. These are high-saturation pink/green/yellow
 * blobs that stand out against the dark felt background.
 *
 * Strategy: check the bottom 20% of the image for high-saturation pixels.
 * If enough saturated pixels are found, action buttons are likely visible.
 */
export async function detectActionButtons(
  imageBuffer: Buffer,
): Promise<boolean> {
  const meta = await sharp(imageBuffer).metadata();
  if (!meta.width || !meta.height) return false;

  // ROI: bottom 20%, right 60% of image (where buttons appear)
  const roiTop = Math.round(meta.height * 0.80);
  const roiLeft = Math.round(meta.width * 0.40);
  const roiWidth = meta.width - roiLeft;
  const roiHeight = meta.height - roiTop;

  if (roiWidth <= 0 || roiHeight <= 0) return false;

  // Extract ROI as raw RGB
  const { data, info } = await sharp(imageBuffer)
    .extract({ left: roiLeft, top: roiTop, width: roiWidth, height: roiHeight })
    .resize(120, 40, { fit: "fill" }) // downscale for speed
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const totalPixels = info.width * info.height;
  let saturatedCount = 0;

  for (let i = 0; i < data.length; i += 3) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Check for high-saturation, bright pixels (buttons are colorful against dark felt)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const brightness = max;
    const saturation = max === 0 ? 0 : (max - min) / max;

    // Button colors: bright + saturated (pink, green, yellow)
    if (brightness > 140 && saturation > 0.3) {
      saturatedCount++;
    }
  }

  const ratio = saturatedCount / totalPixels;

  // If more than 8% of the ROI has bright, saturated pixels → buttons visible
  return ratio > 0.08;
}
