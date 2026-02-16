"use client";

import { useCallback, useEffect, useState } from "react";
import { validateImage, resizeImage } from "@/lib/utils/image";
import {
  extractImageFromClipboard,
  extractImageFromDrop,
} from "@/lib/utils/paste";
import { HandPreview } from "./HandPreview";

interface PasteZoneProps {
  onImageReady: (base64: string) => void;
  disabled?: boolean;
}

export function PasteZone({ onImageReady, disabled }: PasteZoneProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);

      const validationError = validateImage(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      setPreview(URL.createObjectURL(file));

      const base64 = await resizeImage(file);
      onImageReady(base64);
    },
    [onImageReady]
  );

  useEffect(() => {
    if (disabled) return;

    function handlePaste(e: ClipboardEvent) {
      const file = extractImageFromClipboard(e);
      if (file) {
        e.preventDefault();
        processFile(file);
      }
    }

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [disabled, processFile]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    const file = extractImageFromDrop(e.nativeEvent);
    if (file) {
      processFile(file);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`relative w-full rounded-xl border-2 border-dashed transition-colors ${
        isDragging
          ? "border-poker-green bg-poker-green/10"
          : "border-card-border hover:border-zinc-500"
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      {preview ? (
        <HandPreview src={preview} />
      ) : (
        <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <div className="rounded-lg bg-card-bg p-3">
            <svg
              className="h-8 w-8 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
              />
            </svg>
          </div>
          <div>
            <p className="text-lg font-medium text-zinc-200">
              Paste or drop a poker screenshot
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Ctrl+V to paste from clipboard, or drag and drop an image
            </p>
          </div>
          <p className="text-xs text-zinc-600">
            PNG, JPEG, or WebP up to 5MB
          </p>
        </div>
      )}

      {error && (
        <div className="absolute inset-x-0 bottom-0 rounded-b-xl bg-red-500/10 px-4 py-2 text-center text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
