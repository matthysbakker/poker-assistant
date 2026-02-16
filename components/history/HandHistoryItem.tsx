"use client";

import { useState } from "react";
import type { StoredHand } from "@/lib/storage/hands";
import { ACTION_COLORS } from "@/lib/poker/types";
import type { PokerAction } from "@/lib/poker/types";
import { formatRelativeTime } from "@/lib/utils/format";

interface HandHistoryItemProps {
  hand: StoredHand;
  onDelete: (id: string) => void;
}

export function HandHistoryItem({ hand, onDelete }: HandHistoryItemProps) {
  const [expanded, setExpanded] = useState(false);
  const { analysis } = hand;

  const actionColor = ACTION_COLORS[analysis.action as PokerAction] ?? "bg-zinc-600";

  return (
    <div className="rounded-lg border border-card-border bg-card-bg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-zinc-800/50"
      >
        {/* Thumbnail */}
        <img
          src={`data:image/jpeg;base64,${hand.thumbnail}`}
          alt="Hand screenshot"
          className="h-12 w-16 rounded object-cover flex-shrink-0"
        />

        {/* Summary */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${actionColor}`}
            >
              {analysis.action}
              {analysis.amount ? ` ${analysis.amount}` : ""}
            </span>
            {analysis.heroCards && (
              <span className="font-mono text-sm text-zinc-300">
                {analysis.heroCards}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
            {analysis.street && <span>{analysis.street}</span>}
            {analysis.heroPosition && (
              <>
                <span className="text-zinc-700">&middot;</span>
                <span>{analysis.heroPosition}</span>
              </>
            )}
            <span className="text-zinc-700">&middot;</span>
            <span>{formatRelativeTime(hand.timestamp)}</span>
          </div>
        </div>

        {/* Expand indicator */}
        <svg
          className={`h-4 w-4 flex-shrink-0 text-zinc-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded analysis */}
      {expanded && (
        <div className="border-t border-card-border px-4 py-3 space-y-3">
          {/* Game state grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {analysis.communityCards && (
              <div>
                <span className="text-zinc-500">Board:</span>{" "}
                <span className="font-mono text-zinc-200">{analysis.communityCards}</span>
              </div>
            )}
            {analysis.potSize && (
              <div>
                <span className="text-zinc-500">Pot:</span>{" "}
                <span className="text-zinc-200">{analysis.potSize}</span>
              </div>
            )}
            {analysis.heroStack && (
              <div>
                <span className="text-zinc-500">Stack:</span>{" "}
                <span className="text-zinc-200">{analysis.heroStack}</span>
              </div>
            )}
            {analysis.confidence && (
              <div>
                <span className="text-zinc-500">Confidence:</span>{" "}
                <span className="text-zinc-200">{analysis.confidence}</span>
              </div>
            )}
          </div>

          {/* Reasoning */}
          {analysis.reasoning && (
            <div>
              <h4 className="mb-1 text-xs font-semibold text-zinc-400">Reasoning</h4>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                {analysis.reasoning}
              </p>
            </div>
          )}

          {/* Concept + Tip */}
          <div className="flex flex-wrap items-center gap-2">
            {analysis.concept && (
              <span className="rounded-md bg-poker-green/20 px-2.5 py-1 text-xs font-medium text-emerald-400">
                {analysis.concept}
              </span>
            )}
          </div>

          {analysis.tip && (
            <div className="rounded-lg border border-emerald-800/40 bg-emerald-900/20 p-3">
              <p className="text-xs font-medium text-emerald-300">Tip</p>
              <p className="mt-0.5 text-sm text-emerald-200/80">{analysis.tip}</p>
            </div>
          )}

          {/* Delete */}
          <div className="flex justify-end">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(hand.id);
              }}
              className="text-xs text-zinc-600 transition-colors hover:text-red-400"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
