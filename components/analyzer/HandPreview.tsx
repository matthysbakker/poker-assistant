interface HandPreviewProps {
  src: string;
}

export function HandPreview({ src }: HandPreviewProps) {
  return (
    <div className="flex items-center justify-center p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Poker table screenshot"
        className="max-h-64 rounded-lg object-contain"
      />
    </div>
  );
}
