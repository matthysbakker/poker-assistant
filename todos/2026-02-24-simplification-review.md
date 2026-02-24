# Review: Simplification / YAGNI Audit
**Date:** 2026-02-24
**Reviewed by:** Claude (simplicity expert)
**Files reviewed:**
- `app/api/analyze/route.ts` (229 LOC)
- `lib/hand-tracking/use-hand-tracker.ts` (63 LOC)
- `lib/hand-tracking/use-continuous-capture.ts` (114 LOC)
- `lib/hand-tracking/state-machine.ts` (171 LOC)
- `lib/storage/hand-records.ts` (101 LOC)
- `lib/card-detection/detect.ts` (119 LOC)
- `extension/src/background.ts` (391 LOC)
- `extension/src/poker-content.ts` (1567 LOC)

---

## Simplification Analysis

### Core Purpose
The pipeline has two distinct halves:
1. **Web app** — screenshot in → detect cards → stream Claude analysis → show result / save record.
2. **Extension** — observe DOM → decide action (local engine or Claude) → execute click.

---

## P1 — High impact, clear win, low risk

### P1-A: Duplicate card-override block in `analyze/route.ts`

**File:** `app/api/analyze/route.ts` lines 116-146 and lines 176-197

The same "DOM cards take priority, fall back to image detection" logic is written twice — once to build the `detectedCards` string for Claude (lines 116-146), and again to override `analysis.heroCards` / `analysis.communityCards` in the saved record (lines 176-197). The filter chain `.filter(m => confidence HIGH|MEDIUM).map(m => m.card).filter(Boolean).join(" ")` appears three times verbatim.

**Proposed simplification:**
```typescript
// Extract once:
function resolveCards(domCards: string[], imgMatches: CardMatch[]): string {
  if (domCards.length > 0) return domCards.join(" ");
  return imgMatches
    .filter(m => m.confidence === "HIGH" || m.confidence === "MEDIUM")
    .map(m => m.card)
    .filter(Boolean)
    .join(" ");
}

const heroCardStr  = resolveCards(domCards.heroCards, detection?.heroCards ?? []);
const boardCardStr = resolveCards(domCards.communityCards, detection?.communityCards ?? []);
```
Then use `heroCardStr` / `boardCardStr` in both the `detectedCards` assembly block and the record override block.

**Impact:** ~30 LOC removed, two divergence points eliminated.

---

### P1-B: `buildDetectionDetails()` is an over-engineered identity transform

**File:** `lib/storage/hand-records.ts` lines 58-84

`buildDetectionDetails` flattens `detection.heroCards` + `detection.communityCards` into a `DetectionDetail[]` array. The `DetectionDetail` interface is identical to `CardMatch` plus a `group` tag. The helper `mapMatchToDetail` adds nothing: it copies every field.

The actual use of `DetectionDetail[]` on disk is for debugging. Nobody queries it programmatically inside the app.

**Proposed simplification:**
Delete `DetectionDetail`, `mapMatchToDetail`, and `buildDetectionDetails`. In `HandRecord`, replace:
```ts
detectionDetails: DetectionDetail[];
```
with:
```ts
detectionDetails: { card: string; group: "hero" | "community"; confidence: string; matchScore: number; gap: number }[] | null;
```
Or just store the raw arrays:
```ts
detectionHero: CardMatch[];
detectionCommunity: CardMatch[];
```
The call site in `route.ts` becomes `detection?.heroCards ?? []` and `detection?.communityCards ?? []` directly, no helper needed.

**Impact:** ~27 LOC removed across `hand-records.ts` and the import in `route.ts`. The on-disk format barely changes.

---

### P1-C: `sanitizeAmount` belongs inside the record-save closure, not at module scope

**File:** `app/api/analyze/route.ts` lines 18-22

`sanitizeAmount` is called exactly twice (lines 171-172) inside a single `.then()` callback. It does one thing: `parseFloat → if > max → return "[misread]"`. At 4 lines of actual logic, the function wrapper costs more than it saves. The name also suggests a pattern ("sanitize") that sounds like it guards user input for security — but this is purely a display-quality guard on AI output.

The pattern is fine, but it should either:
(a) be inlined — the two calls are `sanitizeAmount(x, 500)` and `sanitizeAmount(x, 2000)`, trivially readable inline; or
(b) live next to its only callers in `hand-records.ts` if record-saving is ever extracted.

**Impact:** Removes 5 LOC, removes a misleadingly named module-level export surface.

---

### P1-D: `use-continuous-capture.ts` — runtime shape validation is redundant

**File:** `lib/hand-tracking/use-continuous-capture.ts` lines 60-68

```ts
if (
  data &&
  Array.isArray(data.heroCards) &&
  Array.isArray(data.communityCards) &&
  typeof data.heroTurn === "boolean"
) {
  feedDetection(data as DetectionResult);
```

The `/api/detect` endpoint is an internal route that returns a typed `DetectionResult`. This runtime duck-type check duplicates what the TypeScript type already guarantees at compile time. The only scenario where a malformed response arrives is a genuine server error — in which case the `res.ok` check on line 58 already catches it (a 500 would have `ok === false`).

**Proposed simplification:** Delete the shape check and cast directly:
```ts
if (res.ok) {
  const data: DetectionResult = await res.json();
  feedDetection(data);
```

**Impact:** 7 LOC removed. The cast `as DetectionResult` is no longer needed because the type annotation does the work.

---

## P2 — Medium impact, worth doing when touching those files

### P2-A: `background.ts` — `PERSONA_RECOMMENDATION` and `CLAUDE_ADVICE` are pure pass-throughs

**File:** `extension/src/background.ts` lines 299-323

Both message handlers receive a message and immediately forward it to `pokerTabId` with the same fields. This is a zero-logic relay. MV2 does not allow direct content→content messaging, so the background hop is architecturally necessary — but the code can be collapsed to a generic relay helper:

```ts
function relayToPoker(message: object) {
  if (pokerTabId) chrome.tabs.sendMessage(pokerTabId, message);
}
```
Then:
```ts
if (["PERSONA_RECOMMENDATION", "CLAUDE_ADVICE"].includes(message.type)) {
  relayToPoker(message);
  return;
}
```
This removes the property-by-property spread and collapses 24 LOC to 4.

**Impact:** ~20 LOC removed, relay logic centralized.

---

### P2-B: `poker-content.ts` — `PersonaRec.rotated` and `PersonaRec.allPersonas` are display-only state

**File:** `extension/src/poker-content.ts` lines 77-83

`PersonaRec.rotated` and `PersonaRec.allPersonas` are used solely in `updateOverlay()` for visual display. They are never consulted by the decision path. They arrive from the `/api/persona` response and are stored verbatim.

This is not a YAGNI violation but a **locality violation** — they could simply be stored as the raw API response object rather than a typed interface that has to be manually kept in sync with the API response shape. Since `PersonaRec` is only ever populated from one fetch and consumed in one overlay render, the interface adds overhead with no benefit.

**Proposed simplification:** Store the raw `data` from the fetch as `lastPersonaRec` and access fields directly. Drop the `PersonaRec` interface.

**Impact:** 8 LOC (the interface + typed fields), plus eliminates one potential drift between API and interface.

---

### P2-C: `poker-content.ts` — `updateOverlay()` is 90 lines of inline HTML string building

**File:** `extension/src/poker-content.ts` lines 1124-1248

The function contains three nested ternary chains to build persona HTML, advice HTML, and the main layout. Multiple local variables are computed and then used only once. The logic for "is this a monitor error" (`isMonitorError`, `isMonitorErrPost`) is computed twice (lines 1182 and 1211) with slightly different variable names.

This does not need to be a single 90-line function. Three sub-functions would isolate each concern:
- `buildPersonaHtml(state, lastPersonaRec, ...)` → string
- `buildAdviceHtml(lastClaudeAdvice, monitorAdvice, ...)` → string
- `renderOverlay(state, personaHtml, adviceHtml)` → void

**Impact:** No LOC reduction, but significant readability gain. The duplicate `isMonitorError` check is eliminated.

---

### P2-D: `detect.ts` — `formatDetectionSummary` is unused when DOM cards are present

**File:** `lib/card-detection/detect.ts` lines 91-119

`formatDetectionSummary` is called at line 77 and its output is stored as `DetectionResult.detectedText`. However in `analyze/route.ts`, `detectedText` from image detection is never read — the route builds its own `detectedCards` string from DOM cards + image fallback (lines 117-146). The `detectedText` field on `DetectionResult` is only read in the `/api/detect` route (continuous mode detection-only endpoint) — it is not read by the analyze route.

This is not a removal opportunity (the `/api/detect` endpoint needs it), but it's worth noting that `formatDetectionSummary` and the `analyze/route.ts` card-assembly block contain duplicated logic for the same formatting task. If `resolveCards()` (from P1-A) is extracted, the `formatDetectionSummary` function can delegate to it or be replaced.

**Impact:** Documented asymmetry; no immediate LOC change but reduces confusion.

---

### P2-E: `use-hand-tracker.ts` — five `useCallback` wrappers for dispatch calls

**File:** `lib/hand-tracking/use-hand-tracker.ts` lines 12-34

All five exported functions (`feedDetection`, `markAnalysisStarted`, `markAnalysisComplete`, `reset`) are `useCallback(() => dispatch(...), [])`. The dependency array is always empty because `dispatch` from `useReducer` is stable by React contract.

These callbacks exist to give callers stable references. That is valid — but they could be expressed more concisely:

```ts
const feedDetection      = useCallback((d: DetectionResult) => dispatch({ type: "DETECTION", detection: d }), []);
const markAnalysisStarted = useCallback(() => dispatch({ type: "ANALYSIS_STARTED" }), []);
// etc.
```

The current code is already close to this — the main issue is the `markAnalysisComplete` callback which has a `useCallback` dep of `[]` but accepts a parameter. This is correct (dispatch is stable) but non-obvious. A comment saying "dispatch from useReducer is stable — no deps needed" would make this self-documenting.

**Impact:** 0 LOC change (pattern is correct), but a single comment removes the confusion.

---

## P3 — Low priority / nice to have

### P3-A: `requestSchema` in `analyze/route.ts` duplicates `tableTemperatureSchema` inline

**File:** `app/api/analyze/route.ts` lines 66-74

The `personaSelected` field in `requestSchema` duplicates the `tableTemperatureSchema` reference:
```ts
temperature: tableTemperatureSchema.nullable(),
```
This is correct (already imported), but the `personaSelected` shape is also defined inline in the schema rather than being a named type. Since `personaSelected` is also part of `HandRecord` in `hand-records.ts` (lines 47-53), the two definitions can drift. Consider extracting a shared `personaSelectedSchema` and deriving the `HandRecord` field type from it.

**Impact:** ~10 LOC, eliminates one drift point between request validation and storage type.

---

### P3-B: `state-machine.ts` — `cardCodes()` helper is a one-liner that adds abstraction cost

**File:** `lib/hand-tracking/state-machine.ts` lines 44-53

`cardCodes(detection)` returns `{ hero: CardCode[], community: CardCode[] }`. It is called once. The function exists to give the extraction a name. But the extraction is readable inline:

```ts
const hero      = detection.heroCards.flatMap(m => m.card ? [m.card] : []);
const community = detection.communityCards.flatMap(m => m.card ? [m.card] : []);
```

**Impact:** 10 LOC removed, one less abstraction to navigate.

---

### P3-C: `background.ts` — `isContinuousActive()` is a one-liner used three times

**File:** `extension/src/background.ts` lines 129-131

```ts
function isContinuousActive() {
  return captureInterval !== null;
}
```

The function is called in three places. It is fine as a named helper (makes intent clear), but the name `isContinuousActive` is longer than `captureInterval !== null`. Either usage is acceptable — this is a matter of taste, not a real complexity problem. No action required.

---

### P3-D: `poker-content.ts` — todo comments are implementation noise

**File:** `extension/src/poker-content.ts` — multiple lines

There are ~20 inline `(todo NNN)` references throughout the file (e.g., "todo 038", "todo 044", "todo 059"). These reference an external numbering system that is not in the repository. They add reading friction without providing actionable information in the file itself. Either migrate them to GitHub issues and remove the inline references, or expand them to a single-line description of the deferred work.

**Impact:** ~20 LOC comment noise removed, readability improved.

---

## YAGNI Violations

### YAGNI-1: `DetectionDetail` — a type that exists purely to re-shape data for disk storage

The `DetectionDetail` type (hand-records.ts:7-13) is `CardMatch` + a `group` field. No code reads `DetectionDetail[]` at runtime for any logic; it is only serialized to JSON for debugging. This is premature normalization of data for a use case (programmatic analysis of saved records) that does not exist yet.

**What to do:** Remove `DetectionDetail`, store the raw `CardMatch` arrays with a `group` tag, or drop the field entirely and rely on `detectedText` for debugging. Do not create a type to describe future analytics that hasn't been built.

### YAGNI-2: `PERSONA_GUIDES` in `poker-content.ts` — hardcoded post-flop coaching per persona

**File:** `extension/src/poker-content.ts` lines 798-803

Four one-line strings keyed by persona name prepended to Claude's context. These are only used when Claude is called (post-flop, low-confidence path). They represent a coaching layer that partially duplicates the system prompt. If a persona's style guide changes, both the system prompt and this in-content-script dictionary must be updated.

The content script should not contain AI coaching text. The right home for this is the system prompt or the `/api/autopilot` handler. The `requestDecision` function could simply forward the persona name and let the server look up the guide.

### YAGNI-3: `opponentHistory` on every `/api/analyze` request and in `HandRecord`

**File:** `app/api/analyze/route.ts` lines 44-53, `lib/storage/hand-records.ts` line 29-39

`opponentHistory` is a `Record<number, { username?, handsObserved, actions, inferredType, notes? }>`. This schema exists but the autopilot path (which generates most traffic) never populates it — it is populated only in manual mode when the user explicitly provides history. The field is stored in every hand record, serialized to disk, and passed through the full schema.

This is not urgent to remove (it has a real use in manual mode), but the Zod schema at lines 44-53 with `z.coerce.number()` as the key type and a `.max(20)` actions array shows premature hardening of a rarely-used feature.

---

## Passed / No Action Needed

- **`use-hand-tracker.ts`** — At 63 LOC, this is already minimal. The `useReducer` + stable callback pattern is correct React. No changes needed.
- **`use-continuous-capture.ts`** — The `abortRef` / `detectingRef` / `latestFrameRef` triple ref pattern correctly avoids stale closure issues. The hook is well-bounded at 114 LOC.
- **`state-machine.ts`** — The hysteresis logic (FORWARD_HYSTERESIS, WAITING_HYSTERESIS) is inherently stateful and the reducer is clean. 171 LOC for a multi-street forward-only state machine with two transition types is appropriate.
- **`detect.ts`** — 119 LOC covering locate → crop → preprocess → match in parallel is lean. The `Promise.all` structure is correct.
- **`background.ts`** — The message protocol is unavoidably complex because MV2 requires the background as a relay hub. The complexity is structural, not accidental.
- **`parseDomCards()`** in `analyze/route.ts` — Clean, justified, 14 LOC. The regex pair is correct and the function serves a clear single purpose.
- **`buildHandContext()`** in `use-hand-tracker.ts` — 25 LOC, reads cleanly, serves an obvious purpose. No simplification needed.

---

## Summary

| Priority | Item | File | Est. LOC saved |
|----------|------|------|---------------|
| P1-A | Deduplicate card-override logic | route.ts | ~30 |
| P1-B | Remove `buildDetectionDetails` / `DetectionDetail` | hand-records.ts, route.ts | ~27 |
| P1-C | Inline `sanitizeAmount` | route.ts | ~5 |
| P1-D | Remove runtime shape validation on internal API response | use-continuous-capture.ts | ~7 |
| P2-A | Collapse relay message handlers in background.ts | background.ts | ~20 |
| P2-B | Drop `PersonaRec` interface, store raw API response | poker-content.ts | ~8 |
| P2-C | Split `updateOverlay` into 3 sub-functions | poker-content.ts | 0 (clarity) |
| P2-D | Document asymmetry in formatDetectionSummary | detect.ts | 0 (clarity) |
| P2-E | Add stability comment to useCallback wrappers | use-hand-tracker.ts | 0 (clarity) |
| P3-A | Extract shared `personaSelectedSchema` | route.ts, hand-records.ts | ~10 |
| P3-B | Inline `cardCodes()` helper | state-machine.ts | ~10 |
| P3-D | Remove todo-NNN inline comments | poker-content.ts | ~20 |

**Total potential LOC reduction: ~137 across ~2364 reviewed LOC (~6%)**

The codebase is not dramatically over-engineered. Most complexity is structural and justified (state machine, extension messaging, multi-stage detection pipeline). The clearest wins are the duplicated card-resolution logic in the analyze route (P1-A) and the `DetectionDetail` indirection layer (P1-B).

**Recommended action:** Apply P1-A and P1-B; defer P2 items to next pass when touching those files.
