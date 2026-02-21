"use client";

import { getPersonaRecommendations } from "@/lib/poker/persona-lookup";
import type { ChartPosition, PersonaAction } from "@/lib/poker/personas";

const ACTION_STYLES: Record<PersonaAction, { bg: string; text: string }> = {
  RAISE: { bg: "bg-emerald-600", text: "text-white" },
  CALL: { bg: "bg-yellow-500", text: "text-black" },
  FOLD: { bg: "bg-red-500", text: "text-white" },
};

interface PersonaComparisonProps {
  heroCards: string;
  heroPosition: ChartPosition;
  aiAction?: string;
}

export function PersonaComparison({
  heroCards,
  heroPosition,
  aiAction,
}: PersonaComparisonProps) {
  const recommendations = getPersonaRecommendations(heroCards, heroPosition);
  if (!recommendations) return null;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-400">
          Strategy Comparison
        </h3>
        <span className="text-xs text-zinc-600">Profitable opening ranges</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {recommendations.map(({ persona, action }) => {
          const matchesAI =
            aiAction &&
            action === (aiAction === "BET" ? "RAISE" : aiAction);
          const styles = ACTION_STYLES[action];

          return (
            <div
              key={persona.id}
              className={`rounded-lg border p-3 ${
                matchesAI
                  ? "border-emerald-700/50 bg-emerald-950/20"
                  : "border-zinc-800 bg-zinc-900/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200">
                    {persona.name}
                  </p>
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
