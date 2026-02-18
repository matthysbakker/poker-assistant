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

  for (const snap of state.streets) {
    const hero = snap.heroCards.join(" ");
    const board = snap.communityCards.join(" ");

    if (snap.street === "PREFLOP") {
      parts.push(`PREFLOP: Hero holds ${hero}`);
    } else {
      parts.push(`${snap.street}: Board is ${board}`);
    }
  }

  // Add current state if not yet in streets
  const lastSnap = state.streets[state.streets.length - 1];
  if (lastSnap && lastSnap.street !== state.street && state.street !== "WAITING") {
    const board = state.communityCards.join(" ");
    if (state.street === "PREFLOP") {
      parts.push(`PREFLOP: Hero holds ${state.heroCards.join(" ")}`);
    } else {
      parts.push(`${state.street}: Board is ${board}`);
    }
  }

  return parts.join(". ");
}
