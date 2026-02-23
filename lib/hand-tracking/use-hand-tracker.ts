"use client";

import { useCallback, useReducer } from "react";
import { handReducer, INITIAL_STATE } from "./state-machine";
import type { DetectionResult } from "@/lib/card-detection/types";
import type { HandState } from "./types";
import type { HandAnalysis } from "@/lib/ai/schema";

export function useHandTracker() {
  const [state, dispatch] = useReducer(handReducer, INITIAL_STATE);

  const feedDetection = useCallback((detection: DetectionResult) => {
    dispatch({ type: "DETECTION", detection });
  }, []);

  const markAnalysisStarted = useCallback(() => {
    dispatch({ type: "ANALYSIS_STARTED" });
  }, []);

  const markAnalysisComplete = useCallback((analysis?: HandAnalysis) => {
    dispatch({ type: "ANALYSIS_COMPLETE", analysis });
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

  for (const snap of state.streets) {
    if (snap.street === "PREFLOP") {
      parts.push(`PREFLOP: Hero holds ${snap.heroCards.join(" ")}`);
    } else if (snap.communityCards.length > 0) {
      parts.push(`${snap.street}: Board is ${snap.communityCards.join(" ")}`);
    }
    // Append prior Claude recommendation for continuity across streets
    if (snap.analysis?.action) {
      const rec = `${snap.analysis.action}${snap.analysis.amount ? ` ${snap.analysis.amount}` : ""}`;
      const reasoning = snap.analysis.reasoning?.slice(0, 120);
      parts.push(`  → Claude recommended: ${rec}${reasoning ? ` (${reasoning}…)` : ""}`);
    }
  }

  return parts.join(". ");
}
