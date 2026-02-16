"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getStoredHands,
  deleteHand,
  clearAllHands,
  type StoredHand,
} from "@/lib/storage/hands";
import { HandHistoryItem } from "./HandHistoryItem";

interface HandHistoryProps {
  refreshKey: number;
}

export function HandHistory({ refreshKey }: HandHistoryProps) {
  const [hands, setHands] = useState<StoredHand[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setHands(getStoredHands());
  }, [refreshKey]);

  const handleDelete = useCallback((id: string) => {
    deleteHand(id);
    setHands(getStoredHands());
  }, []);

  const handleClearAll = useCallback(() => {
    clearAllHands();
    setHands([]);
  }, []);

  if (hands.length === 0) return null;

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
        >
          <svg
            className={`h-3.5 w-3.5 transition-transform ${collapsed ? "-rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          Hand History
          <span className="text-zinc-600">({hands.length})</span>
        </button>

        {!collapsed && (
          <button
            onClick={handleClearAll}
            className="text-xs text-zinc-600 transition-colors hover:text-red-400"
          >
            Clear all
          </button>
        )}
      </div>

      {/* List */}
      {!collapsed && (
        <div className="space-y-2">
          {hands.map((hand) => (
            <HandHistoryItem
              key={hand.id}
              hand={hand}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
