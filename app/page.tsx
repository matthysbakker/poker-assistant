"use client";

import { useCallback, useState } from "react";
import { PasteZone } from "@/components/analyzer/PasteZone";
import { AnalysisResult } from "@/components/analyzer/AnalysisResult";
import { HandHistory } from "@/components/history/HandHistory";

export default function Home() {
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleReset = useCallback(() => {
    setImageBase64(null);
  }, []);

  const handleHandSaved = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

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
        </div>

        {/* How it works */}
        {!imageBase64 && (
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

        {/* Paste zone */}
        <PasteZone onImageReady={setImageBase64} disabled={!!imageBase64} />

        {/* Analysis result */}
        <AnalysisResult
          imageBase64={imageBase64}
          onHandSaved={handleHandSaved}
        />

        {/* Reset button */}
        {imageBase64 && (
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
