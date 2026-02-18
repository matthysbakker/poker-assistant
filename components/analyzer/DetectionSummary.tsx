"use client";

import { LoadingState } from "./LoadingState";

interface DetectionSummaryProps {
  heroCards: string[];
  communityCards: string[];
  street: string;
  isAnalyzing: boolean;
}

export function DetectionSummary({
  heroCards,
  communityCards,
  street,
  isAnalyzing,
}: DetectionSummaryProps) {
  if (heroCards.length === 0) return null;

  return (
    <div className="w-full space-y-3 rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white">
            {street}
          </span>
          <span className="font-mono text-lg font-bold text-zinc-100">
            {heroCards.join(" ")}
          </span>
        </div>
        {communityCards.length > 0 && (
          <span className="font-mono text-sm text-zinc-400">
            Board: {communityCards.join(" ")}
          </span>
        )}
      </div>
      {isAnalyzing && <LoadingState />}
    </div>
  );
}
