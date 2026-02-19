"use client";

import { useCallback, useReducer } from "react";
import { handReducer, INITIAL_STATE } from "./state-machine";
import type { DetectionResult } from "@/lib/card-detection/types";
import type { HandState } from "./types";

export function useHandTracker() {
  const [state, dispatch] = useReducer(handReducer, INITIAL_STATE);

  const feedDetection = useCallback((detection: DetectionResult) => {
    dispatch({ type: "DETECTION", detection });
  }, []);

  const markAnalysisStarted = useCallback(() => {
    dispatch({ type: "ANALYSIS_STARTED" });
  }, []);

  const markAnalysisComplete = useCallback(() => {
    dispatch({ type: "ANALYSIS_COMPLETE" });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  return {
    state,
    feedDetection,
    markAnalysisStarted,
    markAnalysisComplete,
    reset,
  };
}

/** Build hand context string for Claude from accumulated street data. */
export function buildHandContext(state: HandState): string {
  if (state.streets.length === 0) return "";

  const parts: string[] = [];

  // Include position if detected
  if (state.heroPosition) {
    parts.push(`Hero position: ${state.heroPosition}`);
  }

  parts.push(
    ...state.streets.map((snap) =>
      snap.street === "PREFLOP"
        ? `PREFLOP: Hero holds ${snap.heroCards.join(" ")}`
        : `${snap.street}: Board is ${snap.communityCards.join(" ")}`,
    ),
  );

  return parts.join(". ");
}
