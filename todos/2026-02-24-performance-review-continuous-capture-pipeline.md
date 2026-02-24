# Performance Review: Continuous Capture Pipeline
**Date:** 2026-02-24
**Reviewed by:** Performance Oracle

---

## P1 — Critical Issues

### P1-A: `locateCards` decodes the full-resolution image buffer TWICE per frame
**File:** `lib/card-detection/locate.ts:66-78`

Every 2-second frame triggers two concurrent `sharp(imageBuffer)` decodes of the same PNG/JPEG source buffer — one blurred and one raw. Sharp decodes from source bytes each time, so the full image decompression runs twice per frame. For a 1920×1080 JPEG this is ~4–6 MB of pixel data processed twice.

```ts
// locate.ts:66-78 — two separate decodes of imageBuffer
const [blurred, unblurred] = await Promise.all([
  sharp(imageBuffer).resize(...).greyscale().blur(BLUR_SIGMA).raw().toBuffer(...),
  sharp(imageBuffer).resize(...).greyscale().raw().toBuffer(...),
]);
```

**Impact:** At 2s cadence this is manageable, but both operations hit the Node.js libuv thread pool simultaneously. The thread pool default size is 4. Combined with `detectActionButtons` and `detectDealerButton` running concurrently, all five Sharp operations compete for the same 4 threads, creating a thread-pool bottleneck.

**Fix:** Decode to a single greyscale 480px buffer first, then derive the blurred version from the already-decoded raw buffer. This avoids the second JPEG decompression:

```ts
// Single decode, then pipeline fork
const greyscaleRaw = await sharp(imageBuffer).resize(ANALYSIS_WIDTH, analysisHeight).greyscale().raw().toBuffer({ resolveWithObject: true });
// Then apply blur to the already-decoded raw data for the blurred variant
const blurredData = await sharp(greyscaleRaw.data, { raw: { width: ANALYSIS_WIDTH, height: analysisHeight, channels: 1 }}).blur(BLUR_SIGMA).raw().toBuffer();
```

---

### P1-B: `detectCards` (in `/api/analyze`) runs full image detection even when DOM cards already cover hero+community
**File:** `app/api/analyze/route.ts:109-114`

```ts
// analyze/route.ts:109-114
let detection: DetectionResult | null = null;
try {
  detection = await detectCards(parsed.data.image);  // always runs
} catch (err) { ... }
```

When `parseDomCards(handContext)` already has both hero cards and community cards (the common case during a live hand), the full card detection pipeline still executes — all four Sharp decode paths (locate + buttons + dealer-button at 960px). Detection is used only for `heroPosition` in this case. The entire detection cost is paid for one field that is already locked (`hasPosition` is passed in the detect endpoint but NOT checked here in analyze).

**Impact:** This adds ~50-150ms of avoidable CPU work to every AI streaming request when DOM cards are present and position is already known.

**Fix:** Pass `hasPosition` context through to `/api/analyze` and short-circuit to a position-only detection path (or skip detection entirely when position was previously transmitted in `heroPosition` field of the request body, which already exists in `requestSchema`).

---

## P2 — Optimization Opportunities

### P2-A: `detectDealerButton` decodes the full image at 960px width — a 5th Sharp decode per frame
**File:** `lib/card-detection/dealer-button.ts:81-85`

```ts
// dealer-button.ts:81-85
const { data, info } = await sharp(imageBuffer)
  .resize(ANALYSIS_WIDTH, null)  // ANALYSIS_WIDTH = 960
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
```

This is a 960px full-color decode running concurrently with the four other decodes (2 in `locateCards`, 1 in `buttons.ts`, plus card `cropCorner` calls). This particular decode is the most expensive because it preserves all 3 RGB channels at 960px rather than converting to greyscale at 480px.

**Impact:** Allocates ~960 × (960/AR) × 3 bytes of raw pixel data. For a 16:9 image at 960px wide, that is ~1.6 MB. This runs every 2 seconds even when `skipDealerDetection: true` is passed (correctly skipped in `/api/detect`), but runs every time in `/api/analyze` (see P1-B).

**Fix:** When dealer detection is needed, re-use the greyscale 480px buffer from `locateCards` instead of a fresh 960px RGB decode. The HSV filter can run on upscaled coordinates; the precision difference is negligible for a blob-finding algorithm with a 0.12 normalized-distance tolerance.

---

### P2-B: `matchCard` iterates all reference variants on every card, every frame — no early exit
**File:** `lib/card-detection/match.ts:93-100`

```ts
// match.ts:93-100
for (const [card, refBufs] of refs) {
  let cardBest = 0;
  for (const refBuf of refBufs) {
    const score = compareBinary(preprocessed, refBuf);  // O(OUTPUT_W * OUTPUT_H) = O(1536) per call
    if (score > cardBest) cardBest = score;
  }
  cardBestScores.set(card, cardBest);
}
```

With 52 cards × ~2 variants average = ~104 comparisons per card detected. Each `compareBinary` call is O(1536) pixel ops (32×48). With up to 7 cards (2 hero + 5 community), that is 104 × 7 = 728 comparisons per frame, or ~1.1 million pixel operations. This runs synchronously on the main Node.js thread (match.ts is not async).

**Current complexity:** O(cards × variants × OUTPUT_W × OUTPUT_H) per frame = O(728 × 1536) ≈ 1.1M ops/frame.

**Optimization:** Once a card scores above the HIGH threshold (0.90), break out of the inner variants loop for that card — the best possible score was already found. This alone cuts the inner loop short for most HIGH-confidence matches.

---

### P2-C: `resizeBase64Image` in `use-continuous-capture.ts` is called as a fire-and-forget `.then()` that can race with the next analysis trigger
**File:** `lib/hand-tracking/use-continuous-capture.ts:69-71`

```ts
// use-continuous-capture.ts:69-71
resizeBase64Image(base64).then((resized) => {
  latestFrameRef.current = resized;
});
```

The resize is asynchronous. If `analyzeGeneration` increments (triggering an analysis) while the resize is still in-flight, `latestFrameRef.current` will hold the unresized raw base64. The analysis will then be called with the full-resolution JPEG (up to 10MB base64) rather than the 1024px version. This is a data-correctness issue as well as a performance issue since it sends more data to Claude than intended.

**Fix:** `await` the resize before updating `latestFrameRef.current`, or store the unresized frame separately and always resize before passing to analysis.

---

### P2-D: `localStorage` reads in `getStoredHands()` parse the entire history on every call — unbounded growth
**File:** `lib/storage/hands.ts:12-22`, `saveHand` at line 35

```ts
// hands.ts:35-37
const hands = getStoredHands();   // full JSON.parse every save
hands.unshift(hand);
localStorage.setItem(STORAGE_KEY, JSON.stringify(hands));
```

There is no limit on the number of stored hands. Each save reads the full array, prepends a new entry (including a base64 thumbnail), and writes the full array back. Thumbnails at 400px / 60% JPEG quality are approximately 20-50KB each as base64. After 100 hands, the localStorage item is ~5MB; after 500 hands it risks hitting the 5-10MB browser quota.

**Impact:** `JSON.parse` and `JSON.stringify` on a 5MB string blocks the main thread for 50-100ms. `deleteHand` at line 43 has the same full-parse pattern.

**Fix:** Cap stored hands at a configurable maximum (e.g. 50), dropping the oldest entry when the limit is reached. Add this cap in `saveHand`.

---

### P2-E: `useEffect` in `use-continuous-capture.ts` depends on the entire `handState` object
**File:** `lib/hand-tracking/use-continuous-capture.ts:28-39`

```ts
// use-continuous-capture.ts:28-39
useEffect(() => {
  if (handState.analyzeGeneration > lastAnalyzedGen.current && ...) {
    ...
  }
}, [handState, markAnalysisStarted]);  // fires on EVERY state update
```

This effect fires on every detection result (every 2 seconds when idle, potentially faster during transitions). The check inside is cheap, but the React scheduler still queues and processes this effect every frame. Only `handState.analyzeGeneration` and `handState.street` are actually used inside the effect. Depending on the full `handState` object means the effect re-runs on heroCards changes, heroTurn changes, etc.

**Fix:** Destructure only the fields needed: `const { analyzeGeneration, street } = handState` and depend on those primitives, not the object reference.

---

### P2-F: `detectCards` in `/api/analyze` re-decodes the full image from base64 and then Sharp also decodes it — double allocation
**File:** `app/api/analyze/route.ts:159-160`

```ts
// analyze/route.ts:159-160  (inside SAVE_HANDS branch)
const imageBuffer = Buffer.from(parsed.data.image, "base64");
```

This `Buffer.from(base64)` allocation happens unconditionally at request time (even before knowing if the stream will produce an `action`). The image buffer can be 1-3MB. It is only used if `SAVE_HANDS=true` and the stream completes with an action. For most production use this buffer is allocated and then GC'd unused.

**Fix:** Move `Buffer.from` inside the `.then()` callback where it is actually consumed.

---

## P3 — Low Priority / Nice-to-Have

### P3-A: `background.ts` uses `setInterval` at 1000ms (comment says 2000ms)
**File:** `extension/src/background.ts:101,113`

```ts
// background.ts:101,113
captureInterval = setInterval(() => {
  ...
}, 1000);  // comment at top says 2s interval; actual is 1s
```

The architecture notes and all documentation describe a 2-second interval, but the implementation fires at 1000ms. This doubles the number of frames sent to `/api/detect`. At 1s intervals, if detection takes 800ms (typical for the full pipeline), there is almost no idle gap between requests. The `detectingRef` guard in `use-continuous-capture.ts` will correctly drop concurrent frames, but it means 50% of frames are silently discarded. This is waste with no benefit.

**Fix:** Align the interval with the documented architecture: 2000ms. This also reduces JPEG captures by half, halving the postMessage/IPC overhead between background and content scripts.

---

### P3-B: `detectActionButtons` calls `sharp(imageBuffer).metadata()` then makes a second Sharp call — two decodes for one function
**File:** `lib/card-detection/buttons.ts:16-33`

```ts
// buttons.ts:16-17
const meta = await sharp(imageBuffer).metadata();
// ...then separately:
const { data, info } = await sharp(imageBuffer).extract({...}).resize(...).raw()...
```

`sharp().metadata()` does a partial decode to read headers. Then a second full decode follows. These could be combined into one pipeline by computing the ROI lazily, or by passing `origWidth/origHeight` into `detectActionButtons` from `locateCards` where these values are already known (line 58-60 of `locate.ts`).

---

### P3-C: `isBrightInOriginal` in `locate.ts` has a nested pixel loop called for every candidate blob
**File:** `lib/card-detection/locate.ts:220-247`

For each candidate blob (potentially 10-20 per frame), `isBrightInOriginal` iterates over (blobWidth × blobHeight) pixels with 20% margin. At analysis scale (480px wide) a hero card blob is ~80×100 px = 8000 iterations, times 20 cards in worst case = 160k iterations. This is CPU-bound but O(n) so not algorithmic, just worth noting as a hot path.

---

### P3-D: `compareBinary` in `preprocess.ts` uses `Math.abs` in a tight inner loop
**File:** `lib/card-detection/preprocess.ts:95-102`

```ts
// preprocess.ts:95-102
for (let i = 0; i < len; i++) {
  similarity += 1 - Math.abs(a[i] - b[i]) / 255;
}
```

At 1536 iterations × 7 cards × 104 comparisons = 1.1M calls to `Math.abs` per detection cycle. `Math.abs` on integer-typed buffers is already fast in V8, but the division by 255 on every iteration could be hoisted. Minor.

---

### P3-E: `analyze-hand.ts` has pinned model IDs with date suffixes
**File:** `lib/ai/analyze-hand.ts:7-10`

```ts
const MODELS = {
  continuous: "claude-haiku-4-5-20251001",  // pinned version
  manual: "claude-sonnet-4-20250514",         // pinned version
} as const;
```

Per global CLAUDE.md: prefer unversioned aliases when available. This was previously flagged as `040-resolved-p2-model-id-date-pinned.md` but the fix does not appear to have landed in `analyze-hand.ts`. Using unversioned aliases (`claude-haiku-4-5`, `claude-sonnet-4`) ensures automatic routing to latest compatible models without code changes.

---

## Passed / No Action Needed

- **Reference cache (`match.ts:19-44`):** Correctly implemented with lazy load per group and a `clearReferenceCache()` invalidation hook. Files are read once at process startup (first match) and held in memory. No file I/O on hot path.
- **State machine reducer (`state-machine.ts`):** Pure function, O(streets.length) for `ANALYSIS_COMPLETE` map (max 4 streets). No performance concern.
- **`detectingRef` mutex (`use-continuous-capture.ts:18,44`):** Correctly prevents overlapping `/api/detect` calls. Ref-based (not state-based), so no re-render on each check.
- **`handReducer` dispatch on every frame:** `useReducer` dispatch is O(1); the reducer is a pure switch with no allocations on the hot path (same-street case). No concern.
- **Equity calculation files (`lib/poker/equity/`):** `analyzeOuts` is O(cards) with fixed-size Uint8Array accumulators. `detectStrengthEquityMismatch` is O(1) branching. Neither is called per frame — only on analysis trigger. No concern.
- **`writeHandRecord` (`lib/storage/hand-records.ts:86-101`):** Uses `fs/promises` async writes with `Promise.all` for JSON+image. Correctly fire-and-forget with `.catch()`. No concern.
- **`buildHandContext` (`use-hand-tracker.ts:38-63`):** O(streets.length), max 4 iterations. No concern.
- **AI streaming setup (`analyze-hand.ts`):** `streamObject` with `cacheControl: ephemeral` on system prompt is correct — allows Anthropic prompt caching to amortize the system prompt token cost. `toTextStreamResponse()` correctly streams to the browser.
- **Base64 size guard (`page.tsx:92-98`):** `MAX_BASE64_BYTES = 14_000_000` correctly rejects oversized frames before they enter the state machine.
- **`SAVE_CAPTURES` / `SAVE_HANDS` opt-in flags:** Correctly gated behind env vars. No disk fill risk in normal operation.
