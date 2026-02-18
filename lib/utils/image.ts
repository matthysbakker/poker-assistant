const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_DIMENSION = 1568;
const JPEG_QUALITY = 0.85;

export function validateImage(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Unsupported image type. Please use PNG, JPEG, or WebP.";
  }
  if (file.size > MAX_SIZE_BYTES) {
    return "Image too large. Maximum size is 5MB.";
  }
  return null;
}

export async function resizeImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  let targetWidth = width;
  let targetHeight = height;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    targetWidth = Math.round(width * scale);
    targetHeight = Math.round(height * scale);
  }

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const blob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: JPEG_QUALITY,
  });

  return blobToBase64(blob);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix to get raw base64
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function fileToBase64(file: File): Promise<string> {
  return blobToBase64(file);
}

const CONTINUOUS_MAX_DIMENSION = 1024;

/**
 * Resize a base64 image to a maximum dimension.
 * Used for continuous capture frames which arrive as raw base64 (not File objects).
 */
export async function resizeBase64Image(
  base64: string,
  maxDimension = CONTINUOUS_MAX_DIMENSION,
): Promise<string> {
  const img = new Image();
  img.src = `data:image/jpeg;base64,${base64}`;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
  });

  const { width, height } = img;

  // Skip resize if already within bounds
  if (width <= maxDimension && height <= maxDimension) return base64;

  const scale = maxDimension / Math.max(width, height);
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  return canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
}

const THUMBNAIL_MAX_DIMENSION = 400;
const THUMBNAIL_QUALITY = 0.6;

export async function createThumbnail(base64: string): Promise<string> {
  const img = new Image();
  img.src = `data:image/jpeg;base64,${base64}`;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
  });

  const { width, height } = img;
  const scale = THUMBNAIL_MAX_DIMENSION / Math.max(width, height);

  // Skip if already small enough
  const targetWidth = scale < 1 ? Math.round(width * scale) : width;
  const targetHeight = scale < 1 ? Math.round(height * scale) : height;

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Return raw base64 without data URL prefix
  return canvas.toDataURL("image/jpeg", THUMBNAIL_QUALITY).split(",")[1];
}
