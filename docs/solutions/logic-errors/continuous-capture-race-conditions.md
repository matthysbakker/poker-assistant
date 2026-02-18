---
title: "Race Conditions in React + Browser Extension Continuous Capture Pipeline"
date: 2026-02-18
tags: ["race-condition", "continuous-capture", "react", "useRef", "browser-extension", "async"]
category: logic-errors
module: poker-assistant
symptoms:
  - "Claude analyzes a screenshot from a different moment than the detection that triggered it"
  - "Analysis submits without accumulated hand context (missing PREFLOP/FLOP history)"
  - "First continuous capture tick silently drops — UI says 'capturing' but nothing arrives"
  - "React re-renders every 2 seconds during continuous capture for no reason"
  - "AnalysisResult fires before handContext is set"
---

# Race Conditions in React + Browser Extension Continuous Capture Pipeline

## Problem

Three race conditions in a pipeline where a browser extension captures screenshots every 2 seconds, sends them through async detection, feeds results into a React state machine, and triggers Claude analysis when the hero's turn is detected.

### Race 1: Stale Frame Fed to Claude

**Sequence:**
1. Frame N arrives → detection starts (~200ms)
2. Detection responds → `feedDetection()` dispatches → state machine sets `shouldAnalyze = true`
3. React batches the state update — `useEffect` for shouldAnalyze is **scheduled but not yet executed**
4. Frame N+1 arrives (2s later) → `setImageBase64(frameN1)` overwrites the image
5. The batched `useEffect` executes — reads `imageBase64` which is now Frame N+1
6. Claude analyzes Frame N+1 with Frame N's detection context

**Result:** Claude receives a screenshot from one moment with detection data from another. The advice references a hand state the player is no longer in.

### Race 2: Analysis Submits Without Hand Context

The `AnalysisResult` component's submit effect depends on `imageBase64`, `opponentHistory`, AND `handContext`. In continuous mode:

1. `setImageBase64(base64)` fires (from detection completing) — triggers the effect
2. But `setHandContext()` hasn't run yet (the `shouldAnalyze` effect hasn't fired)
3. `submit()` fires with **no hand context** — Claude analyzes without street history
4. When `handContext` updates, `submittedRef` guard blocks re-submission

**Result:** All accumulated street tracking is discarded. Claude gives shallow advice.

### Race 3: Extension First Capture Tick Fails Silently

```typescript
// BEFORE: interval starts BEFORE async callback resolves
chrome.windows.getCurrent((win) => {
  pokerWindowId = win?.id ?? null;  // fires ~1-5ms later
});

captureInterval = setInterval(() => {
  if (!webAppTabId || !pokerWindowId) return;  // silently drops
  // ...
}, 2000);
```

The `setInterval` starts synchronously, but `pokerWindowId` is set in an async callback. Under load, the callback could be delayed, causing the first tick to silently drop. The badge shows "ON" but nothing is captured.

## Root Cause

All three races stem from the same pattern: **using React state (`setImageBase64`) as a frame buffer for a high-frequency capture pipeline**. State updates trigger re-renders and are batched asynchronously, but the capture pipeline needs synchronous, render-invisible storage.

## Solution

### Fix 1 & 2: Ref-Based Frame Buffer

Store continuous frames in a ref. Only promote to state when `shouldAnalyze` fires, atomically with `handContext`.

```typescript
const latestFrameRef = useRef<string | null>(null);

// In handleContinuousFrame:
if (res.ok) {
  const detection: DetectionResult = await res.json();
  feedDetection(detection);
  // Store frame in ref — no re-render, no state race
  latestFrameRef.current = base64;
}

// In shouldAnalyze effect — promote atomically:
useEffect(() => {
  if (handState.shouldAnalyze && handState.street !== "WAITING" && latestFrameRef.current) {
    const context = buildHandContext(handState);
    setHandContext(context || undefined);        // context ready
    setImageBase64(latestFrameRef.current);      // frame ready
    markAnalysisStarted();                       // gate closed
    // React batches these — AnalysisResult sees both in same render
  }
}, [handState.shouldAnalyze, handState.street, markAnalysisStarted]);
```

**Why this works:** React batches `setHandContext` + `setImageBase64` into a single render. `AnalysisResult` sees both the image and context simultaneously. The frame in the ref always corresponds to the detection that fed the state machine, because both are updated in the same `handleContinuousFrame` call.

### Fix 3: Interval Inside Callback

```typescript
function startContinuousCapture() {
  if (captureInterval) return;

  chrome.windows.getCurrent((win) => {
    pokerWindowId = win?.id ?? null;
    if (!pokerWindowId) {
      console.error("[BG] No window found for continuous capture");
      return;
    }

    // Start interval AFTER pokerWindowId is confirmed
    captureInterval = setInterval(() => {
      if (!webAppTabId) return;
      chrome.tabs.captureVisibleTab(pokerWindowId!, { format: "jpeg", quality: 85 }, ...);
    }, 2000);

    setBadge("ON", "#22c55e", 0);
  });
}
```

## Prevention / Best Practices

- **Never use `useState` as a buffer for high-frequency data** — `useRef` is render-invisible and avoids batching races. Only promote to state at the moment the data is consumed.
- **Set multiple dependent state values atomically** — when component B depends on both `imageBase64` and `handContext`, set them in the same synchronous block so React batches them into one render.
- **Start intervals INSIDE async callbacks, not alongside them** — if the interval depends on data from the callback, it must start after the callback resolves. Otherwise the first tick races with initialization.
- **The "two masters" smell** — if a piece of state serves both as a buffer (updated frequently) and a trigger (consumed on change), split it into a ref (buffer) and state (trigger).

## Files Changed

- `app/page.tsx` — Added `latestFrameRef`, moved `setImageBase64` into `shouldAnalyze` effect
- `extension/src/background.ts` — Moved `setInterval` inside `getCurrent` callback

## Cross-References

- `docs/solutions/implementation-patterns/continuous-capture-state-machine.md` — Architecture overview
- `docs/plans/2026-02-18-feat-continuous-capture-hand-tracking-plan.md` — Implementation plan
- `todos/` — 24 additional review findings (10 P2, 14 P3)
