---
title: "Continuous Capture with Hand State Machine for Automated Poker Analysis"
date: 2026-02-18
tags: ["state-machine", "continuous-capture", "hand-tracking", "browser-extension", "card-detection", "hysteresis"]
category: implementation-patterns
module: poker-assistant
symptoms:
  - "Manual hotkey capture disrupts poker flow and misses action timing"
  - "Single snapshot gives Claude no context about previous streets"
  - "Claude called on every capture even when hero has no action"
  - "How to track poker hand state across periodic screenshots"
  - "Prevent animation artifacts from causing false state transitions"
  - "Separate cheap detection from expensive AI analysis"
---

# Continuous Capture with Hand State Machine for Automated Poker Analysis

## Problem

The original manual capture flow had three fundamental issues:

1. **Disruptive** -- pressing a hotkey during play pulls focus away from the game and misses optimal timing
2. **No street context** -- each snapshot was analyzed in isolation. Claude had no knowledge of what happened on previous streets (preflop holdings, flop texture, turn card), producing shallow advice
3. **Wasteful** -- Claude was called on every capture regardless of whether hero actually needed to act, burning API tokens on frames where the hero is waiting for opponents

## Solution Architecture

```
Browser Extension (every 2s)
  captureVisibleTab(pokerWindowId, JPEG 85%)
    |
    v
Content Script → window.postMessage("FRAME")
    |
    v
page.tsx: handleContinuousFrame()
  ├── detectingRef mutex (skip if in-flight)
  └── POST /api/detect (card detection + button detection, ~100-250ms)
        |
        v
Hand State Machine (useReducer)
  ├── streetFromCommunityCount(hero, community) → WAITING|PREFLOP|FLOP|TURN|RIVER
  ├── Forward-only enforcement (ignores backward transitions)
  ├── Hysteresis: 2 frames to confirm forward transition
  ├── Hysteresis: 3 frames to confirm WAITING (hand ended)
  └── shouldAnalyze = true when heroTurn flips to true
        |
        v
Claude Analysis (only when hero must act)
  ├── buildHandContext() → accumulated street history
  ├── "PREFLOP: Hero holds Ah Kd. FLOP: Board is Qs Jh 7c."
  └── Full analysis with multi-street context
```

### Dual Capture Modes

The system supports two simultaneous capture modes:

| Mode | Trigger | Detection | Analysis |
|------|---------|-----------|----------|
| **Continuous** | Extension sends `CAPTURE_FRAME` every 2s | `/api/detect` (cards + buttons) | Only when `heroTurn === true` |
| **Manual** | Hotkey sends `POKER_CAPTURE` | Skipped (full image sent to Claude) | Immediate, every capture |

Manual mode remains available for one-off analysis during continuous capture. The `captureMode` state tracks which mode is active.

## Key Patterns

### 1. Forward-Only State Machine (`lib/hand-tracking/state-machine.ts`)

The state machine enforces forward-only street progression to prevent animation artifacts (card deal animations, UI transitions) from causing backward jumps.

```typescript
const STREET_ORDER: Record<Street, number> = {
  WAITING: 0, PREFLOP: 1, FLOP: 2, TURN: 3, RIVER: 4,
};

// In handleDetection():
// Forward-only: ignore backward transitions (except to WAITING)
if (STREET_ORDER[detectedStreet] <= STREET_ORDER[state.street]) {
  return { ...state, heroTurn };
}
```

The one exception is transition to `WAITING`, which always uses the hysteresis path since it signals the hand has ended and a reset is needed.

### 2. Hysteresis for Transition Confirmation

Periodic captures at 2-second intervals can catch transient states (card deal animations, UI flicker). Hysteresis requires consecutive frames to agree before committing a transition.

```typescript
const FORWARD_HYSTERESIS = 2;  // 2 frames (4 seconds) for street advances
const WAITING_HYSTERESIS = 3;  // 3 frames (6 seconds) for hand-end detection

// Forward transition with hysteresis
if (state.pendingStreet === detectedStreet) {
  const newCount = state.frameCount + 1;
  if (newCount >= FORWARD_HYSTERESIS) {
    // Transition confirmed — update street, record snapshot
    const snapshot: StreetSnapshot = {
      street: detectedStreet,
      heroCards: hero,
      communityCards: community,
      timestamp: Date.now(),
    };
    return {
      ...state,
      street: detectedStreet,
      streets: [...state.streets, snapshot],
      // ...
    };
  }
  return { ...state, frameCount: newCount, heroTurn };
}

// Start counting toward new street
return { ...state, pendingStreet: detectedStreet, frameCount: 1, heroTurn };
```

**Why 3 frames for WAITING:** Between hands, the table briefly shows no hero cards while the next hand is being dealt. A 3-frame threshold (6 seconds) ensures only true hand endings trigger a reset, not brief card-less moments.

### 3. Action Button Detection (`lib/card-detection/buttons.ts`)

Hero's turn is detected by scanning for high-saturation, bright pixels in the bottom-right region of the screen where action buttons (Fold/Call/Raise) appear.

```typescript
// ROI: bottom 20%, right 60% of image
const roiTop = Math.round(meta.height * 0.80);
const roiLeft = Math.round(meta.width * 0.40);

// Downscale for speed (120x40)
// Check each pixel for button-like colors (bright + saturated)
const max = Math.max(r, g, b);
const min = Math.min(r, g, b);
const brightness = max;
const saturation = max === 0 ? 0 : (max - min) / max;

if (brightness > 140 && saturation > 0.3) {
  saturatedCount++;
}

// 8% threshold — buttons cover significant area when visible
return ratio > 0.08;
```

This works because poker action buttons (pink Fold, green Call, yellow Raise) are highly saturated against the dark, desaturated felt background. The approach is deliberately simple and fast (~5ms) since it runs on every frame.

### 4. Detection-Only Endpoint (`app/api/detect/route.ts`)

A lightweight endpoint that runs card detection and button detection without invoking Claude. This separation is critical for continuous mode since detection runs every 2 seconds but Claude analysis only triggers when needed.

```typescript
/** Lightweight detection-only endpoint. Returns cards + heroTurn, no Claude. */
export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "..." }, { status: 400 });

  const detection = await detectCards(parsed.data.image);

  return Response.json({
    heroCards: detection.heroCards,
    communityCards: detection.communityCards,
    detectedText: detection.detectedText,
    heroTurn: detection.heroTurn,
    timing: detection.timing,
  });
}
```

Cost comparison per frame:
- `/api/detect`: ~100-250ms, zero API cost (local image processing only)
- `/api/analyze`: ~3-5 seconds, Claude API token cost per call

### 5. In-Flight Mutex via Ref (`app/page.tsx`)

Continuous frames arrive every 2 seconds, but detection takes ~100-250ms. A ref-based mutex prevents overlapping requests without triggering re-renders.

```typescript
const detectingRef = useRef(false);

const latestFrameRef = useRef<string | null>(null);

async function handleContinuousFrame(base64: string) {
  if (detectingRef.current) return;  // skip if detection in-flight
  detectingRef.current = true;

  try {
    const res = await fetch("/api/detect", { /* ... */ });
    if (res.ok) {
      const detection: DetectionResult = await res.json();
      feedDetection(detection);
      latestFrameRef.current = base64;  // ref, not state — no re-render
    }
  } finally {
    detectingRef.current = false;
  }
}

// Frame is promoted to state only when analysis is triggered:
useEffect(() => {
  if (handState.shouldAnalyze && latestFrameRef.current) {
    setHandContext(buildHandContext(handState) || undefined);
    setImageBase64(latestFrameRef.current);  // atomic with context
    markAnalysisStarted();
  }
}, [handState.shouldAnalyze, handState.street, markAnalysisStarted]);
```

Using a ref instead of state is deliberate: `useState` would cause a re-render on every toggle, and since this guard is checked every 2 seconds, the re-render overhead is unnecessary. The ref is invisible to React's render cycle.

The same principle applies to `latestFrameRef` — continuous frames are stored in a ref (no re-render) and only promoted to state when analysis is triggered. See `docs/solutions/logic-errors/continuous-capture-race-conditions.md` for the race conditions this prevents.

### 6. Accumulated Hand Context (`lib/hand-tracking/use-hand-tracker.ts`)

When Claude analysis is triggered, the state machine's accumulated `streets` array is converted into a natural language context string.

```typescript
export function buildHandContext(state: HandState): string {
  const parts: string[] = [];

  for (const snap of state.streets) {
    if (snap.street === "PREFLOP") {
      parts.push(`PREFLOP: Hero holds ${snap.heroCards.join(" ")}`);
    } else {
      parts.push(`${snap.street}: Board is ${snap.communityCards.join(" ")}`);
    }
  }

  return parts.join(". ");
  // Example: "PREFLOP: Hero holds Ah Kd. FLOP: Board is Qs Jh 7c. TURN: Board is Qs Jh 7c 2s"
}
```

This gives Claude full street-by-street context without re-analyzing previous screenshots. The context accumulates as the hand progresses, so a turn decision includes preflop and flop history.

### 7. Extension Window Targeting (`extension/src/background.ts`)

The extension records the poker window ID when continuous capture starts and targets that specific window for all subsequent captures. This prevents capturing the wrong browser window if the user switches between windows.

```typescript
function startContinuousCapture() {
  if (captureInterval) return;

  // Interval starts INSIDE the callback to avoid race with pokerWindowId
  chrome.windows.getCurrent((win) => {
    pokerWindowId = win?.id ?? null;
    if (!pokerWindowId) return;

    captureInterval = setInterval(() => {
      if (!webAppTabId) return;
      chrome.tabs.captureVisibleTab(
        pokerWindowId!,  // always capture the poker window, not the active window
        { format: "jpeg", quality: 85 },
        (dataUrl) => { /* ... */ },
      );
    }, 2000);

    setBadge("ON", "#22c55e", 0);
  });
}
```

JPEG at 85% quality (vs PNG for manual captures) reduces bandwidth for the high-frequency continuous captures while retaining sufficient quality for card detection.

## State Machine Lifecycle

```
                     hero cards detected (2 frames)
    ┌─────────┐    ──────────────────────────────→    ┌──────────┐
    │ WAITING │                                       │ PREFLOP  │
    └─────────┘    ←──────────────────────────────    └──────────┘
                     no hero cards (3 frames)              │
         ↑                                                 │ 3 community cards (2 frames)
         │                                                 ↓
         │           ┌─────────┐    4 community    ┌──────────┐
         │           │  TURN   │ ←──────────────── │   FLOP   │
         │           └─────────┘    (2 frames)     └──────────┘
         │                │
         │                │ 5 community cards (2 frames)
         │                ↓
         │           ┌─────────┐
         └────────── │  RIVER  │
          (3 frames) └─────────┘
```

At each state, `heroTurn` is tracked independently. Claude is only called when `heroTurn` transitions from `false` to `true` (action buttons appear).

## Gotchas

- **`handleContinuousFrame` must use a ref mutex, not state** -- `useState` for an in-flight guard causes re-renders every 2 seconds, and stale closures in the `useEffect` message handler would miss updates
- **File writes must be gated behind `SAVE_CAPTURES` env var** -- continuous mode generates a capture every 2 seconds; ungated file writes fill disk quickly during development
- **Manual hotkey still works during continuous mode** -- the `captureMode` state tracks which mode produced the current image, so `AnalysisResult` knows whether to use hand context or do standalone analysis
- **JPEG for continuous, PNG for manual** -- continuous frames prioritize speed and bandwidth; manual captures prioritize quality for single-frame Claude analysis
- **`shouldAnalyze` stays true until `ANALYSIS_STARTED` is dispatched** -- this ensures the analysis trigger is not missed if the component re-renders between the flag being set and the effect running

## Files Changed

- `lib/hand-tracking/state-machine.ts` -- Forward-only state machine with hysteresis
- `lib/hand-tracking/use-hand-tracker.ts` -- React hook wrapping useReducer + `buildHandContext()`
- `lib/hand-tracking/types.ts` -- `HandState`, `Street`, `StreetSnapshot`, `HandAction` types
- `lib/hand-tracking/index.ts` -- Barrel export
- `lib/card-detection/buttons.ts` -- Action button detection via HSV saturation analysis
- `app/api/detect/route.ts` -- Detection-only endpoint (no Claude)
- `extension/src/background.ts` -- Continuous capture loop with window targeting
- `app/page.tsx` -- Dual capture mode integration, `handleContinuousFrame`, `detectingRef` mutex

## Prevention / Best Practices

- **Always use hysteresis when detecting state transitions from periodic captures** -- animations and UI transitions create transient states that last 1-2 frames. Requiring consecutive agreement filters these out.
- **Separate detection from analysis endpoints** -- detection is cheap (~200ms, local processing), analysis is expensive (~3-5s, API tokens). Continuous monitoring should use the cheap path and only escalate when needed.
- **Forward-only state machines prevent oscillation from noisy input** -- when input is noisy (periodic screenshots of a dynamic UI), restricting transitions to forward-only eliminates entire classes of oscillation bugs.
- **Use refs (not state) for in-flight guards** -- state changes trigger re-renders and can cause stale closures. Refs provide a mutable, render-invisible flag that works correctly in async contexts.
- **Gate expensive side effects behind environment variables** -- continuous mode amplifies any per-frame cost. File writes, logging, and debug output should be opt-in via env vars like `SAVE_CAPTURES`.
- **Record window ID at capture start, not per-frame** -- capturing `captureVisibleTab()` without a window ID captures whatever window is focused, which changes when the user alt-tabs.

## Cross-References

- `docs/brainstorms/2026-02-17-continuous-capture-card-detection-brainstorm.md` -- Original brainstorm
- `docs/plans/2026-02-18-feat-continuous-capture-hand-tracking-plan.md` -- Implementation plan
- `docs/solutions/logic-errors/card-detection-aliasing-sensitivity.md` -- Card detection robustness (feeds into `/api/detect`)
- `docs/solutions/implementation-patterns/ai-sdk-v6-streaming-structured-output.md` -- Streaming analysis pattern (used when Claude is invoked)
