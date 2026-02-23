"use client";

import { useMemo } from "react";
import { getPersonaRecommendations } from "@/lib/poker/persona-lookup";
import type { ChartPosition, PersonaAction } from "@/lib/poker/personas";
import type { TableProfile } from "@/lib/poker/table-temperature";

const ACTION_STYLES: Record<PersonaAction, { bg: string; text: string }> = {
  RAISE: { bg: "bg-emerald-600", text: "text-white" },
  CALL: { bg: "bg-yellow-500", text: "text-black" },
  FOLD: { bg: "bg-red-500", text: "text-white" },
};

interface PersonaComparisonProps {
  heroCards: string;
  heroPosition: ChartPosition;
  aiAction?: string;
  recommendedPersonaId?: string;
  tableTemperature?: TableProfile;
  rotated?: boolean;
}

export function PersonaComparison({
  heroCards,
  heroPosition,
  aiAction,
  recommendedPersonaId,
  tableTemperature,
  rotated,
}: PersonaComparisonProps) {
  const recommendations = useMemo(
    () => getPersonaRecommendations(heroCards, heroPosition),
    [heroCards, heroPosition],
  );
  if (!recommendations) return null;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-400">
          Strategy Comparison
        </h3>
        {tableTemperature && tableTemperature.temperature !== "unknown" ? (
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            {tableTemperature.temperature.replace(/_/g, "-")} · {tableTemperature.reads} reads
          </span>
        ) : (
          <span className="text-xs text-zinc-600">Profitable opening ranges</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {recommendations.map(({ persona, action }) => {
          const matchesAI =
            aiAction &&
            action === (aiAction === "BET" ? "RAISE" : aiAction);
          const isRecommended = recommendedPersonaId === persona.id;
          const styles = ACTION_STYLES[action];

          return (
            <div
              key={persona.id}
              className={`rounded-lg border p-3 ${
                isRecommended
                  ? "border-indigo-600/60 bg-indigo-950/30"
                  : matchesAI
                    ? "border-emerald-700/50 bg-emerald-950/20"
                    : "border-zinc-800 bg-zinc-900/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-zinc-200">
                      {persona.name}
                    </p>
                    {isRecommended && (
                      <span className="text-xs text-indigo-400">
                        {rotated ? "↻" : "▶"}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-zinc-500">
                    {persona.tagline}
                  </p>
                </div>
                <span
                  className={`ml-2 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${styles.bg} ${styles.text}`}
                >
                  {action}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
