"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useHandTracker, buildHandContext } from "./use-hand-tracker";
import type { DetectionResult } from "@/lib/card-detection/types";

type CaptureMode = "manual" | "continuous";

interface UseContinuousCaptureOptions {
  /** Called when the analysis generation increments and a frame should be analyzed. */
  onAnalysisTrigger: (imageBase64: string, handContext: string | undefined) => void;
}

export function useContinuousCapture({ onAnalysisTrigger }: UseContinuousCaptureOptions) {
  const { state: handState, feedDetection, markAnalysisStarted, markAnalysisComplete, reset: resetTracker } = useHandTracker();
  const [captureMode, setCaptureMode] = useState<CaptureMode>("manual");
  const detectingRef = useRef(false);
  const latestFrameRef = useRef<string | null>(null);
  const lastAnalyzedGen = useRef(0);

  // Stable ref for the callback to avoid re-creating effects
  const onAnalysisTriggerRef = useRef(onAnalysisTrigger);
  onAnalysisTriggerRef.current = onAnalysisTrigger;

  // When analyzeGeneration increments, trigger analysis with the latest frame
  useEffect(() => {
    if (
      handState.analyzeGeneration > lastAnalyzedGen.current &&
      handState.street !== "WAITING" &&
      latestFrameRef.current
    ) {
      lastAnalyzedGen.current = handState.analyzeGeneration;
      const context = buildHandContext(handState);
      markAnalysisStarted();
      onAnalysisTriggerRef.current(latestFrameRef.current, context || undefined);
    }
  }, [handState, markAnalysisStarted]);

  const handleFrame = useCallback(
    async (base64: string) => {
      // Debounce: skip if a detection is already in flight
      if (detectingRef.current) return;
      detectingRef.current = true;

      try {
        const res = await fetch("/api/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64 }),
        });

        if (res.ok) {
          const data = await res.json();
          // Validate shape before feeding to state machine
          if (
            data &&
            Array.isArray(data.heroCards) &&
            Array.isArray(data.communityCards) &&
            typeof data.heroTurn === "boolean"
          ) {
            feedDetection(data as DetectionResult);
            latestFrameRef.current = base64;
          }
        }
      } catch {
        // Network error — skip this frame
      } finally {
        detectingRef.current = false;
      }
    },
    [feedDetection],
  );

  const reset = useCallback(() => {
    latestFrameRef.current = null;
    resetTracker();
    setCaptureMode("manual");
  }, [resetTracker]);

  return {
    captureMode,
    setCaptureMode,
    handState,
    handleFrame,
    markAnalysisComplete,
    reset,
  };
}
