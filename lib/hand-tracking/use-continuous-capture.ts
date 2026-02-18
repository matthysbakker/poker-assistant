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
  const abortRef = useRef<AbortController | null>(null);
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

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64 }),
          signal: controller.signal,
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
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.debug("[continuous] Detection fetch failed:", e);
      } finally {
        abortRef.current = null;
        detectingRef.current = false;
      }
    },
    [feedDetection],
  );

  /** Abort any in-flight detection request. */
  const abortDetection = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    detectingRef.current = false;
  }, []);

  const switchToManual = useCallback(() => {
    abortDetection();
    setCaptureMode("manual");
  }, [abortDetection]);

  const reset = useCallback(() => {
    abortDetection();
    latestFrameRef.current = null;
    resetTracker();
    setCaptureMode("manual");
  }, [abortDetection, resetTracker]);

  return {
    captureMode,
    setCaptureMode,
    switchToManual,
    handState,
    handleFrame,
    markAnalysisComplete,
    reset,
  };
}
