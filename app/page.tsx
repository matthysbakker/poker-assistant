"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PasteZone } from "@/components/analyzer/PasteZone";
import { AnalysisResult } from "@/components/analyzer/AnalysisResult";
import { HandHistory } from "@/components/history/HandHistory";
import type { Opponent } from "@/lib/ai/schema";
import {
  getOpponentContext,
  getSession,
  resetSession,
  updateOpponentProfiles,
} from "@/lib/storage/sessions";
import { useHandTracker, buildHandContext } from "@/lib/hand-tracking";
import type { DetectionResult } from "@/lib/card-detection/types";

type CaptureMode = "manual" | "continuous";

export default function Home() {
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionHandCount, setSessionHandCount] = useState(() => {
    if (typeof window === "undefined") return 0;
    return getSession().handCount;
  });

  const opponentHistoryRef = useRef(getOpponentContext());
  const [opponentHistory, setOpponentHistory] = useState(opponentHistoryRef.current);
  const [extensionConnected, setExtensionConnected] = useState(false);

  // Hand tracking for continuous mode
  const { state: handState, feedDetection, markAnalysisStarted, markAnalysisComplete, reset: resetTracker } = useHandTracker();
  const [captureMode, setCaptureMode] = useState<CaptureMode>("manual");
  const [handContext, setHandContext] = useState<string | undefined>();
  const detectingRef = useRef(false);

  // When hand state says we should analyze, trigger Claude
  useEffect(() => {
    if (handState.shouldAnalyze && handState.street !== "WAITING" && imageBase64) {
      const context = buildHandContext(handState);
      setHandContext(context || undefined);
      markAnalysisStarted();
      // imageBase64 is already set from the latest frame — AnalysisResult will submit
      opponentHistoryRef.current = getOpponentContext();
      setOpponentHistory(opponentHistoryRef.current);
    }
  }, [handState.shouldAnalyze, handState.street, imageBase64, markAnalysisStarted]);

  // Listen for captures and connection status from the browser extension
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.source !== "poker-assistant-ext") return;

      if (event.data.type === "CAPTURE" && event.data.base64) {
        // Manual hotkey capture → immediate full analysis
        setCaptureMode("manual");
        setHandContext(undefined);
        opponentHistoryRef.current = getOpponentContext();
        setOpponentHistory(opponentHistoryRef.current);
        setImageBase64(event.data.base64);
      } else if (event.data.type === "FRAME" && event.data.base64) {
        // Continuous capture frame → feed to state machine
        setCaptureMode("continuous");
        handleContinuousFrame(event.data.base64);
      } else if (event.data.type === "EXTENSION_CONNECTED") {
        setExtensionConnected(true);
      }
    }

    window.addEventListener("message", handleMessage);
    window.postMessage({ source: "poker-assistant-app", type: "PING" }, "*");
    return () => window.removeEventListener("message", handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleContinuousFrame(base64: string) {
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
        const detection: DetectionResult = await res.json();
        feedDetection(detection);
        // Keep the latest frame for when Claude analysis is triggered
        setImageBase64(base64);
      }
    } catch {
      // Network error — skip this frame
    } finally {
      detectingRef.current = false;
    }
  }

  const handleReset = useCallback(() => {
    opponentHistoryRef.current = getOpponentContext();
    setOpponentHistory(opponentHistoryRef.current);
    setImageBase64(null);
    setHandContext(undefined);
    resetTracker();
    setCaptureMode("manual");
  }, [resetTracker]);

  const handleHandSaved = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleOpponentsDetected = useCallback((opponents: Opponent[]) => {
    const session = updateOpponentProfiles(opponents);
    setSessionHandCount(session.handCount);
  }, []);

  const handleResetSession = useCallback(() => {
    resetSession();
    opponentHistoryRef.current = undefined;
    setOpponentHistory(undefined);
    setSessionHandCount(0);
  }, []);

  const handleAnalysisComplete = useCallback(() => {
    markAnalysisComplete();
  }, [markAnalysisComplete]);

  const isContinuous = captureMode === "continuous";
  const showStreetBadge = isContinuous && handState.street !== "WAITING";

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-12 font-sans">
      <main className="w-full max-w-2xl space-y-8">
        {/* Hero */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-100">
            Poker Hand Analyzer
          </h1>
          <p className="mt-3 text-lg text-zinc-400">
            Paste a screenshot. Get instant strategy advice.
          </p>
          {extensionConnected && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-950/50 px-3 py-1 text-xs text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Extension connected
            </div>
          )}
        </div>

        {/* Continuous mode status */}
        {isContinuous && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {showStreetBadge && (
                  <span className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white">
                    {handState.street}
                  </span>
                )}
                <span className="text-sm text-zinc-400">
                  {handState.street === "WAITING"
                    ? "Watching for new hand..."
                    : handState.heroTurn
                      ? handState.analyzing
                        ? "Your turn — analyzing..."
                        : "Your turn"
                      : `Tracking — ${handState.heroCards.join(" ") || "..."}`}
                </span>
              </div>
              {handState.heroCards.length > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-zinc-300">
                    {handState.heroCards.join(" ")}
                  </span>
                  {handState.communityCards.length > 0 && (
                    <>
                      <span className="text-zinc-600">|</span>
                      <span className="font-mono text-zinc-400">
                        {handState.communityCards.join(" ")}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Session indicator */}
        {sessionHandCount > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-zinc-900/50 px-4 py-2 text-sm">
            <span className="text-zinc-400">
              Session: {sessionHandCount} hand{sessionHandCount !== 1 ? "s" : ""} analyzed
            </span>
            <button
              onClick={handleResetSession}
              className="text-zinc-500 transition-colors hover:text-zinc-300"
            >
              New session
            </button>
          </div>
        )}

        {/* How it works */}
        {!imageBase64 && !isContinuous && (
          <div className="grid grid-cols-3 gap-4 text-center text-sm">
            <div className="rounded-lg bg-card-bg p-4">
              <div className="mb-2 text-2xl">1</div>
              <p className="text-zinc-400">Screenshot your poker table</p>
            </div>
            <div className="rounded-lg bg-card-bg p-4">
              <div className="mb-2 text-2xl">2</div>
              <p className="text-zinc-400">Paste it here with Ctrl+V</p>
            </div>
            <div className="rounded-lg bg-card-bg p-4">
              <div className="mb-2 text-2xl">3</div>
              <p className="text-zinc-400">Get AI-powered strategy advice</p>
            </div>
          </div>
        )}

        {/* Paste zone (hidden during continuous mode) */}
        {!isContinuous && (
          <PasteZone onImageReady={setImageBase64} disabled={!!imageBase64} />
        )}

        {/* Analysis result */}
        <AnalysisResult
          imageBase64={imageBase64}
          opponentHistory={opponentHistory}
          handContext={handContext}
          onHandSaved={handleHandSaved}
          onOpponentsDetected={handleOpponentsDetected}
          onAnalysisComplete={handleAnalysisComplete}
        />

        {/* Reset button */}
        {imageBase64 && !isContinuous && (
          <div className="text-center">
            <button
              onClick={handleReset}
              className="rounded-lg bg-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              Analyze another hand
            </button>
          </div>
        )}

        {/* Hand history */}
        <HandHistory refreshKey={refreshKey} />
      </main>

      {/* Footer */}
      <footer className="mt-auto pt-12 text-center text-xs text-zinc-600">
        <p>
          AI analysis is for educational purposes only. Always use your own
          judgment at the table.
        </p>
      </footer>
    </div>
  );
}
