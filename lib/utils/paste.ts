export function extractImageFromClipboard(
  event: ClipboardEvent
): File | null {
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (const item of items) {
    if (item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}

export function extractImageFromDrop(event: DragEvent): File | null {
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return null;

  const file = files[0];
  if (file.type.startsWith("image/")) {
    return file;
  }
  return null;
}
