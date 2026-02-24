---
title: "feat: Two-tier response system with performance optimizations"
type: feat
date: 2026-02-18
---

# Two-Tier Response System with Performance Optimizations

## Overview

Speed up the end-to-end continuous capture loop from ~9-19s to ~4-8s, with instant visual feedback at ~2s. Introduces a two-tier UI: **Tier 1** shows detected cards and game state immediately from the local detection pipeline, while **Tier 2** streams Claude's full analysis underneath.

## Problem Statement

The current continuous capture loop is too slow for real-time poker play:

| Phase | Current | Optimized |
|-------|---------|-----------|
| Capture interval | 2s | 1s |
| Forward hysteresis (2 frames) | 4s | 2s |
| Claude Sonnet 4 streaming | 5-15s | 2-5s (Haiku) |
| **Total end-to-end** | **~9-19s** | **~4-8s** |

Players often have 15-30s to act. Advice arriving at 9-19s leaves little decision time.

## Proposed Solution

### Architecture: Two-Tier Display

```
Tier 1 (instant, ~2s after turn detected):
┌──────────────────────────────┐
│ Your cards: Ah Kd            │  ← from handState.heroCards
│ Board: Qs Jh 7c              │  ← from handState.communityCards
│ Street: FLOP                 │  ← from handState.street
│ [Analyzing...]               │  ← spinner while Claude streams
└──────────────────────────────┘

Tier 2 (streams in ~2-5s later):
┌──────────────────────────────┐
│ RAISE $12        High conf   │  ← Claude's recommendation
│ Cards: Ah Kd  Board: Qs Jh… │
│ Position: CO   Street: FLOP  │
│ What Would They Do? (preflop)│  ← persona chart (once position known)
│ Reasoning: ...               │  ← streamed progressively
└──────────────────────────────┘
```

### Speed Levers

1. **Model**: Haiku 4.5 for continuous mode (~2-4x faster), Sonnet 4 for manual
2. **Capture interval**: 2s → 1s (2x faster state detection)
3. **Image size**: 1568px → 1024px for continuous mode (~57% fewer image tokens)
4. **Prompt caching**: Cache system prompt via `providerOptions.anthropic.cacheControl`
5. **Reduced output**: Skip `concept`, `tip` in continuous mode (fewer output tokens)

## Implementation Phases

### Phase 1: Fix `analyzing` flag lock on error (prerequisite)

**Problem**: When Claude errors mid-stream, `onAnalysisComplete()` is never called. The state machine's `analyzing: true` flag stays permanently set — no further analysis triggers fire for the rest of the hand.

**Fix**:

- [x]In `AnalysisResult.tsx`, add a `useEffect` watching `error` state that calls `onAnalysisComplete()` when an error occurs
- [x]Test: simulate a network error during streaming, verify next heroTurn trigger still works

```typescript
// components/analyzer/AnalysisResult.tsx — new effect
useEffect(() => {
  if (error && imageBase64) {
    onAnalysisComplete?.();
  }
}, [error, imageBase64, onAnalysisComplete]);
```

**Files**: `components/analyzer/AnalysisResult.tsx`

---

### Phase 2: Tier 1 — Instant Detection Display

**New component** `DetectionSummary` shows hand state from the detection pipeline immediately, before Claude responds.

- [x]Create `components/analyzer/DetectionSummary.tsx` — renders `heroCards`, `communityCards`, `street` from `handState`
- [x]Render `DetectionSummary` in `app/page.tsx` when `captureMode === "continuous"` and hand state has hero cards
- [x]Show "Analyzing..." spinner in Tier 1 while Claude streams
- [x]Replace spinner with Tier 2 (`AnalysisResult`) once streaming begins

```typescript
// components/analyzer/DetectionSummary.tsx
interface DetectionSummaryProps {
  heroCards: string[];    // from handState.heroCards (card codes)
  communityCards: string[]; // from handState.communityCards
  street: string;         // from handState.street
  isAnalyzing: boolean;
}
```

**Note**: Persona chart requires `heroPosition` which is only available from Claude. It stays in `AnalysisResult` and renders once Tier 2 streams the position field.

**Files**: `components/analyzer/DetectionSummary.tsx` (new), `app/page.tsx`

---

### Phase 3: Haiku model for continuous mode

- [x]Add `captureMode` parameter to `analyzeHand()` in `lib/ai/analyze-hand.ts`
- [x]Select model based on mode: `claude-haiku-4-5-20251001` for continuous, `claude-sonnet-4-20250514` for manual
- [x]Pass `captureMode` from API route to `analyzeHand()`

```typescript
// lib/ai/analyze-hand.ts
const MODELS = {
  continuous: "claude-haiku-4-5-20251001",
  manual: "claude-sonnet-4-20250514",
} as const;

export function analyzeHand(
  imageBase64: string,
  opponentHistory?: OpponentHistory,
  detectedCards?: string,
  handContext?: string,
  captureMode: "manual" | "continuous" = "manual",
) {
  return streamObject({
    model: anthropic(MODELS[captureMode]),
    // ...
  });
}
```

**Files**: `lib/ai/analyze-hand.ts`, `app/api/analyze/route.ts`

---

### Phase 4: Prompt caching

Move system prompt from top-level `system` string to `messages` array with `providerOptions` for caching.

- [x]Restructure `analyzeHand()` to use `messages` array instead of `system` + `prompt` pattern
- [x]Add `providerOptions.anthropic.cacheControl` to system message
- [x]Verify cache hits in server logs via `result.providerMetadata?.anthropic`

```typescript
// lib/ai/analyze-hand.ts
return streamObject({
  model: anthropic(MODELS[captureMode]),
  schema: handAnalysisSchema,
  messages: [
    {
      role: "system",
      content: systemPrompt,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    },
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        { type: "image", image: imageBase64 },
      ],
    },
  ],
});
```

**Files**: `lib/ai/analyze-hand.ts`

---

### Phase 5: Reduced schema for continuous mode

Make `concept` and `tip` optional so the server can instruct Haiku to skip them.

- [x]Change `concept` and `tip` to `.optional()` in `handAnalysisSchema`
- [x]Update system prompt variant for continuous mode: instruct Haiku to skip concept/tip, keep reasoning concise (2-3 sentences)
- [x]Update `AnalysisResult.tsx` — already uses optional chaining, should work as-is
- [x]Update `HandAnalysis` type if it's separately defined

```typescript
// lib/ai/schema.ts — change these two fields
concept: z.string().describe("...").optional(),
tip: z.string().describe("...").optional(),
```

**Files**: `lib/ai/schema.ts`, `lib/ai/system-prompt.ts`, `lib/ai/analyze-hand.ts`

---

### Phase 6: Faster capture interval + image resize

- [x]Change capture interval from 2000ms to 1000ms in `extension/src/background.ts`
- [x]Add `resizeBase64Image(base64: string, maxDimension: number)` to `lib/utils/image.ts` that works with base64 input (not `File`)
- [x]Call resize in `handleFrame()` (in `use-continuous-capture.ts`) before passing to `/api/detect`
- [x]The same resized image flows through to `/api/analyze` via `latestFrameRef`
- [x]Rebuild extension: `bun run build:extension`

```typescript
// lib/utils/image.ts — new function for base64 input
export async function resizeBase64Image(
  base64: string,
  maxDimension: number,
): Promise<string> {
  const blob = await fetch(`data:image/jpeg;base64,${base64}`).then(r => r.blob());
  const bitmap = await createImageBitmap(blob);
  // ... same resize logic as resizeImage, return base64
}
```

**Note on hysteresis**: Keep `FORWARD_HYSTERESIS = 2` (safer against animation artifacts). At 1s intervals, forward confirmation takes 2s instead of the current 4s — still a 2x improvement. Reduce `WAITING_HYSTERESIS` from 3 to 2 (hand-end detection: 2s instead of 6s).

**Files**: `extension/src/background.ts`, `lib/utils/image.ts`, `lib/hand-tracking/use-continuous-capture.ts`, `lib/hand-tracking/state-machine.ts`

---

### Phase 7: Handle orphaned streams on mode switch

- [x]Pass a `streamKey` prop (incrementing counter) to `AnalysisResult`
- [x]Use it as the React `key` prop so mode switches remount the component, terminating the old `useObject` connection
- [x]Increment `streamKey` in `switchToManual()` and when continuous analysis triggers

```tsx
// app/page.tsx
<AnalysisResult key={streamKey} ... />
```

**Files**: `app/page.tsx`, `components/analyzer/AnalysisResult.tsx`

## Acceptance Criteria

- [x]Tier 1 shows detected cards + street within ~2s of hero turn detection
- [x]Tier 2 (Claude analysis) streams in underneath Tier 1
- [x]Continuous mode uses Haiku 4.5; manual mode uses Sonnet 4
- [x]System prompt is cached (verify via server log: `cacheReadInputTokens > 0`)
- [x]`concept` and `tip` are skipped in continuous mode responses
- [x]Capture interval is 1s (verify frame count in extension debug logs)
- [x]Images resized to 1024px max in continuous mode before API calls
- [x]Claude errors don't permanently lock the `analyzing` flag
- [x]Mode switch (continuous → manual) cleanly terminates old stream
- [x]Build passes, no type errors

## Success Metrics

- **Time to Tier 1**: <3s from hero turn detection (measured)
- **Time to Tier 2 complete**: <8s from hero turn detection (measured)
- **No regression** in manual mode quality (still uses Sonnet 4)

## Dependencies & Risks

- **Haiku quality**: Haiku 4.5 may produce lower-quality opponent profiling and position detection. Mitigated by providing detected cards as ground truth.
- **1s interval CPU**: Doubled capture rate may increase CPU usage. Monitor in testing.
- **Prompt caching minimum tokens**: Anthropic requires ~1024+ tokens for caching to activate. System prompt is ~1500+ tokens — should qualify.

## References

- Brainstorm: `docs/brainstorms/2026-02-18-performance-optimization-brainstorm.md`
- Current architecture: `docs/plans/2026-02-18-feat-continuous-capture-hand-tracking-plan.md`
- AI SDK prompt caching: `providerOptions.anthropic.cacheControl` in `@ai-sdk/anthropic`
- Anthropic image tokens: `(width * height) / 750`
- Existing files: `lib/ai/analyze-hand.ts`, `lib/ai/schema.ts`, `lib/hand-tracking/state-machine.ts`
