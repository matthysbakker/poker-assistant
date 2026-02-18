"use client";

import { useEffect, useRef } from "react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { handAnalysisSchema } from "@/lib/ai/schema";
import type { HandAnalysis, Opponent } from "@/lib/ai/schema";
import { ACTION_COLORS } from "@/lib/poker/types";
import type { PokerAction } from "@/lib/poker/types";
import { createThumbnail } from "@/lib/utils/image";
import { saveHand } from "@/lib/storage/hands";
import { LoadingState } from "./LoadingState";
import { OpponentTable } from "./OpponentTable";
import { PersonaComparison } from "./PersonaComparison";
import type { ChartPosition } from "@/lib/poker/personas";

interface AnalysisResultProps {
  imageBase64: string | null;
  opponentHistory?: Record<
    number,
    { username?: string; handsObserved: number; actions: string[]; inferredType: string }
  >;
  handContext?: string;
  captureMode?: "manual" | "continuous";
  onHandSaved?: () => void;
  onOpponentsDetected?: (opponents: Opponent[]) => void;
  onAnalysisComplete?: () => void;
}

export function AnalysisResult({
  imageBase64,
  opponentHistory,
  handContext,
  captureMode,
  onHandSaved,
  onOpponentsDetected,
  onAnalysisComplete,
}: AnalysisResultProps) {
  const { object, submit, isLoading, error } = useObject({
    api: "/api/analyze",
    schema: handAnalysisSchema,
  });

  const submittedRef = useRef<string | null>(null);
  const savedRef = useRef<string | null>(null);

  useEffect(() => {
    if (imageBase64 && imageBase64 !== submittedRef.current) {
      submittedRef.current = imageBase64;
      savedRef.current = null;
      submit({ image: imageBase64, opponentHistory, handContext, captureMode });
    }
  }, [imageBase64, submit, opponentHistory, handContext, captureMode]);

  // Auto-save and update session when streaming completes
  useEffect(() => {
    if (
      !isLoading &&
      object?.action &&
      object?.reasoning &&
      imageBase64 &&
      imageBase64 !== savedRef.current
    ) {
      savedRef.current = imageBase64;

      // Update opponent session
      if (object.opponents && object.opponents.length > 0) {
        const validOpponents = object.opponents.filter(
          (o): o is Opponent =>
            o !== undefined && o.seat !== undefined && o.playerType !== undefined,
        );
        if (validOpponents.length > 0) {
          onOpponentsDetected?.(validOpponents);
        }
      }

      createThumbnail(imageBase64).then((thumbnail) => {
        saveHand(thumbnail, object as HandAnalysis);
        onHandSaved?.();
      });

      onAnalysisComplete?.();
    }
  }, [isLoading, object, imageBase64, onHandSaved, onOpponentsDetected, onAnalysisComplete]);

  if (!imageBase64) return null;

  if (error) {
    return (
      <div className="w-full rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-red-400">
          Something went wrong analyzing your hand. Please try again.
        </p>
        <p className="mt-1 text-sm text-red-500/70">{error.message}</p>
      </div>
    );
  }

  if (isLoading && !object) {
    return <LoadingState />;
  }

  if (!object) return null;

  const actionColor = object.action
    ? ACTION_COLORS[object.action as PokerAction]
    : "bg-zinc-600";

  return (
    <div className="w-full space-y-4 rounded-xl border border-card-border bg-card-bg p-6">
      {/* Action badge + confidence */}
      <div className="flex items-center gap-3">
        {object.action && (
          <span
            className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-bold text-white ${actionColor}`}
          >
            {object.action}
            {object.amount ? ` ${object.amount}` : ""}
          </span>
        )}
        {object.confidence && (
          <span className="text-sm text-zinc-400">
            {object.confidence} confidence
          </span>
        )}
      </div>

      {/* Game state */}
      {(object.heroCards || object.street) && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg bg-zinc-900/50 p-4 text-sm">
          {object.heroCards && (
            <div>
              <span className="text-zinc-500">Cards:</span>{" "}
              <span className="font-mono font-medium text-zinc-200">
                {object.heroCards}
              </span>
            </div>
          )}
          {object.communityCards && (
            <div>
              <span className="text-zinc-500">Board:</span>{" "}
              <span className="font-mono font-medium text-zinc-200">
                {object.communityCards}
              </span>
            </div>
          )}
          {object.heroPosition && (
            <div>
              <span className="text-zinc-500">Position:</span>{" "}
              <span className="text-zinc-200">{object.heroPosition}</span>
            </div>
          )}
          {object.street && (
            <div>
              <span className="text-zinc-500">Street:</span>{" "}
              <span className="text-zinc-200">{object.street}</span>
            </div>
          )}
          {object.potSize && (
            <div>
              <span className="text-zinc-500">Pot:</span>{" "}
              <span className="text-zinc-200">{object.potSize}</span>
            </div>
          )}
          {object.heroStack && (
            <div>
              <span className="text-zinc-500">Stack:</span>{" "}
              <span className="text-zinc-200">{object.heroStack}</span>
            </div>
          )}
        </div>
      )}

      {/* Persona comparison — preflop only */}
      {object.street === "PREFLOP" && object.heroCards && object.heroPosition && (
        <PersonaComparison
          heroCards={object.heroCards}
          heroPosition={object.heroPosition as ChartPosition}
          aiAction={object.action}
        />
      )}

      {/* Opponents */}
      {object.opponents && object.opponents.length > 0 && (
        <OpponentTable
          opponents={object.opponents.filter(
            (o): o is Partial<Opponent> => o !== undefined,
          )}
        />
      )}

      {/* Exploit analysis */}
      {object.exploitAnalysis && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-400">
            Exploit Analysis
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
            {object.exploitAnalysis}
          </p>
        </div>
      )}

      {/* Reasoning */}
      {object.reasoning && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-400">
            Reasoning
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
            {object.reasoning}
          </p>
        </div>
      )}

      {/* Concept */}
      {object.concept && (
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-poker-green/20 px-2.5 py-1 text-xs font-medium text-emerald-400">
            {object.concept}
          </span>
        </div>
      )}

      {/* Tip */}
      {object.tip && (
        <div className="rounded-lg border border-emerald-800/40 bg-emerald-900/20 p-4">
          <p className="text-sm font-medium text-emerald-300">Tip</p>
          <p className="mt-1 text-sm text-emerald-200/80">{object.tip}</p>
        </div>
      )}

      {isLoading && (
        <p className="text-center text-xs text-zinc-600">Streaming...</p>
      )}
    </div>
  );
}
