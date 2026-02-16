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
