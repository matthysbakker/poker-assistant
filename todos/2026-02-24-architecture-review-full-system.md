# Architecture Review: Full System Analysis
**Date:** 2026-02-24
**Reviewed by:** System Architecture Expert

---

## Architecture Overview

The poker assistant is a Next.js 16 App Router application with three distinct runtime environments:
- **Browser extension** (Firefox MV2): captures screenshots, scrapes DOM, bridges to web app
- **Web app page** (React client): state machine, persona selection, UI
- **Next.js server** (API routes): card detection (Sharp), AI calls (Claude), disk storage

Data flows in two modes:
- **Manual**: hotkey → JPEG capture → `/api/analyze` → streaming Claude response
- **Continuous**: 1s interval captures → `/api/detect` → state machine → trigger Claude on heroTurn

The local decision engine (preflop charts + post-flop rule tree) operates in the extension's poker-content.ts and calls back to the web app only for storage (`/api/record`) and observability (`/api/decision`).

---

## P1 Findings (Critical)

### P1-A: `parseDomCards` placed in the wrong architectural layer
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/app/api/analyze/route.ts` lines 29–42

`parseDomCards` is a pure string-parsing function that decodes a domain-specific text protocol (the handContext format). It currently lives in the API route handler alongside HTTP validation, image detection orchestration, and AI call dispatch. This is a layer violation: business logic for parsing domain data is embedded in the transport/infrastructure layer.

The function will need to be maintained in sync with the protocol emitted by `buildHandContext` in `lib/hand-tracking/use-hand-tracker.ts` (lines 38–63), but there is no shared type or contract enforcing that alignment. If the format string changes in `buildHandContext`, `parseDomCards` silently produces empty results — with no compile-time safety and no test coverage visible for the round-trip.

**Risk:** Silent data loss when handContext format drifts. The API route is already 229 lines; adding more parsing responsibilities increases the likelihood of future violations.

**Recommendation:** Move `parseDomCards` to `lib/hand-tracking/` as a named export alongside `buildHandContext`. Consider emitting structured data (an object with `heroCards` and `communityCards` arrays) from the extension rather than a prose string that must be re-parsed server-side. This would eliminate the regex fragility entirely.

---

### P1-B: Card-priority override logic is duplicated with divergent placeholders
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/app/api/analyze/route.ts` lines 116–146 (for Claude) and lines 175–197 (for storage)

The DOM-vs-image priority logic runs twice in the same request handler — once to build `detectedCards` for Claude (lines 116–146) and once inside the `.then()` callback to enforce ground truth in the stored record (lines 175–197). The two blocks are nearly identical but not identical: the storage path adds placeholder logic (`?? `.repeat(2 - count)`) for missing image-detected cards (line 185), which the Claude path does not.

This is a DRY violation with a semantic divergence that will be difficult to spot in future maintenance. The two blocks could drift further, creating inconsistency between what Claude sees and what is stored.

**Recommendation:** Extract a single `resolveCards(domCards, detection)` function in `lib/storage/` or `lib/card-detection/` that returns `{ heroCards, communityCards, source }`. Call it once and pass the result to both paths. The placeholder logic should be a deliberate parameter, not an implicit branch difference.

---

### P1-C: State machine stores cards from image detection, but analysis uses DOM cards — introducing an inconsistency in `StreetSnapshot`
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/lib/hand-tracking/state-machine.ts` lines 83–84, 136–139

`handleDetection` populates `snapshot.heroCards` from `detection.heroCards` (image detection), and these snapshots are stored in `state.streets` (line 158). `buildHandContext` then serialises these image-detected cards into the handContext string (use-hand-tracker.ts lines 49–50). On the server, `parseDomCards` overrides them with DOM cards.

This creates a subtle architectural inconsistency: the state machine is the source of truth for hand tracking, but its stored cards are from a lower-accuracy source. The DOM cards only correct the record at the API boundary, not at the state machine level. If the handContext is ever used for anything other than the API call (e.g. UI display of accumulated hand history), it will show image-detected cards, not DOM cards.

**Recommendation:** The state machine should store DOM cards when they are available. The extension's poker-content.ts already scrapes DOM cards; these should be forwarded in the `DetectionResult` as a separate field (e.g. `domHeroCards?: string[]`) so the state machine can prefer them when present. This makes the state machine the authoritative single source of truth.

---

## P2 Findings (High Priority)

### P2-A: Hardcoded localhost port in background.ts
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/extension/src/background.ts` lines 44–46

```
const AUTOPILOT_API_URL = "http://localhost:3006/api/autopilot";
const DECISION_API_URL = "http://localhost:3006/api/decision";
const RECORD_API_URL = "http://localhost:3006/api/record";
```

All three API URLs are hardcoded with port 3006. The port is a deployment concern that belongs in build configuration, not source code. If the port changes (or if a developer runs on a different port), the extension must be rebuilt. There is no way to point the extension at a staging or production server without modifying source.

**Recommendation:** Use a build-time manifest constant or environment injection during the extension build step. A simple `config.ts` exporting `BASE_URL` derived from `process.env.APP_URL ?? "http://localhost:3006"` would decouple this. The `bun run build:extension` step can inject the value at build time.

---

### P2-B: `writeHandRecord` has no concurrency protection or backpressure
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/lib/storage/hand-records.ts` lines 86–101

`writeHandRecord` creates the date directory and writes JSON + PNG as concurrent `Promise.all`. The function is fire-and-forget in both call sites (`route.ts` line 220, `record/route.ts` line 85). There is no queue, no rate limiting, and no cap on concurrent writes. In continuous mode at 1s intervals with `SAVE_HANDS=true`, many writes can overlap — especially the `mkdir` calls which will race.

`mkdir({ recursive: true })` is safe for concurrent calls on most OS/fs implementations, but the broader absence of backpressure means disk-full or permission errors silently eat hands without any alerting mechanism beyond `console.warn`.

**Recommendation:** For the current local-dev scope this is acceptable, but document the failure mode explicitly. If storage is ever moved to a server environment, a simple write queue (async FIFO) should replace fire-and-forget. At minimum, add a counter for failed writes that surfaces in a health endpoint.

---

### P2-C: `CaptureContext` is assembled in three separate callsites in `page.tsx` with identical logic
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/app/page.tsx` lines 62–78, 111–127, 325–342

The `CaptureContext` object is constructed in three places — `onAnalysisTrigger` callback, the `CAPTURE` message handler, and the `PasteZone` `onImageReady` handler — using identical field-gathering logic. The `selectedPersonaRef` and `tableProfileRef` refs are read in all three places with the same pattern.

This is a cohesion problem: adding a new field to `CaptureContext` requires updating three places. One of the three (the `PasteZone` path, line 325) already does not set `pokerHandId` consistently (it uses `manualPokerHandIdRef.current` which may be null if no prior capture was made via the extension hotkey).

**Recommendation:** Extract a `buildCaptureContext(refs, handState)` function that takes the stable refs and current hand state and returns a `CaptureContext`. This eliminates the duplication and creates a single location for the assembly logic.

---

### P2-D: State machine `analyzeGeneration` monotonic counter is reset only partially
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/lib/hand-tracking/state-machine.ts` lines 115–118

When transitioning to `WAITING` (hand ended), the reset preserves `analyzeGeneration`:
```
return { ...INITIAL_STATE, analyzeGeneration: state.analyzeGeneration };
```

`use-continuous-capture.ts` line 21 has `lastAnalyzedGen` as a `useRef(0)`. If `analyzeGeneration` is preserved across hands but `lastAnalyzedGen` is only reset on explicit `reset()` calls (line 101), these can drift. The comment on line 143 in state-machine.ts ("Manual mode generates its own UUID in page.tsx at capture time") indicates this counter has dual semantics — tracking analysis triggers across streets within a hand AND across hands — which makes reasoning about its state harder.

**Recommendation:** Reset `lastAnalyzedGen` to match `analyzeGeneration` on any WAITING transition. Alternatively, use a generation counter that is per-hand and always resets cleanly, with a separate `handGeneration` counter for the pokerHandId.

---

### P2-E: `handContext` string is passed from client to server but carries no version/schema marker
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/lib/hand-tracking/use-hand-tracker.ts` lines 38–63 (producer) and `/Users/matthijsbakker/Bakery/poker-assistant/app/api/analyze/route.ts` lines 29–42 (consumer)

The handContext is a free-form prose string that encodes structured data (hero cards, board, previous recommendations). The producer (`buildHandContext`) and consumer (`parseDomCards`) are coupled by an implicit string format with no versioning, no type safety at the boundary, and no validation that what is parsed is what was intended. The `requestSchema` validates `handContext: z.string().max(5000)` but does not validate its internal structure.

**Recommendation:** Either (a) pass cards as a structured field alongside handContext, or (b) define a `HandContextV1` format constant shared between producer and consumer. At minimum, add a comment cross-reference between the two files so developers know changes to `buildHandContext` must be mirrored in `parseDomCards`.

---

### P2-F: Model IDs are pinned to dated versions
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/lib/ai/analyze-hand.ts` lines 7–9

```typescript
const MODELS = {
  continuous: "claude-haiku-4-5-20251001",
  manual: "claude-sonnet-4-20250514",
} as const;
```

Both model IDs are pinned to specific dated releases. Per project CLAUDE.md conventions, unversioned aliases are preferred where available. This was flagged previously as todo 040 (resolved), but the current code shows pinned versions.

**Recommendation:** Use `"claude-haiku-4-5"` and `"claude-sonnet-4-5"` (or the current latest unversioned aliases per Anthropic's API documentation) to automatically track stable model releases.

---

## P3 Findings (Low Priority / Nice-to-Have)

### P3-A: `Street` type is defined in two separate files
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/lib/hand-tracking/types.ts` line 6 and `/Users/matthijsbakker/Bakery/poker-assistant/lib/poker/types.ts` line 2

`lib/hand-tracking/types.ts` defines `Street = "WAITING" | "PREFLOP" | "FLOP" | "TURN" | "RIVER"`.
`lib/poker/types.ts` defines `Street = "PREFLOP" | "FLOP" | "TURN" | "RIVER"` (without WAITING).

These are different types with the same name. The hand-tracking Street includes WAITING as a valid state; the poker Street does not. This is semantically correct (a poker street is not "WAITING") but creates confusion for developers who import `Street` from different locations. If a function accepts `Street` from poker/types, WAITING is not assignable — but the error may not be obvious without tracing the import.

**Recommendation:** Rename the hand-tracking variant to `HandPhase` to make the semantic distinction explicit, or add a comment on each explaining the relationship.

---

### P3-B: `buildHandContext` produces prose that includes prior Claude recommendations, creating an LLM feedback loop
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/lib/hand-tracking/use-hand-tracker.ts` lines 54–59

```typescript
if (snap.analysis?.action) {
  const rec = `${snap.analysis.action}${...}`;
  const reasoning = snap.analysis.reasoning?.slice(0, 120);
  parts.push(`  → Claude recommended: ${rec}${reasoning ? ` (${reasoning}…)` : ""}`);
}
```

Prior Claude recommendations are embedded in the context sent to Claude for subsequent streets. This creates a feedback loop where Claude's output influences its own future inputs. This is intentional for continuity, but the 120-character truncation of `reasoning` is arbitrary and may cut off mid-sentence, creating misleading context. There is no mechanism to filter out systematically wrong prior recommendations.

**Recommendation:** This is a design trade-off that is documented and intentional. The risk is acceptable for the current use case. Consider capping at a sentence boundary rather than a character count.

---

### P3-C: `rule-tree.ts` returns FOLD with confidence 0 for pre-flop as a sentinel
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/lib/poker/rule-tree.ts` lines 73–75

```typescript
if (communityCards.length < 3) {
  return { action: "FOLD", amount: null, confidence: 0, reasoning: "Pre-flop: use persona chart" };
}
```

Using `FOLD` as the sentinel action for "not applicable" is an architectural smell. If a caller fails to check the confidence threshold before acting on this return value, it would execute a fold on pre-flop hands. The caller in poker-content.ts presumably checks confidence, but the contract is implicit.

**Recommendation:** Return a dedicated `LocalDecision` with `action: "CHECK"` as a safer sentinel (CHECK is always a no-op fallback), or introduce an explicit `NotApplicable` action type. Alternatively, throw or return `null` to make callers explicitly handle the pre-flop case.

---

### P3-D: `persona-selector.ts` has a compile-time guard that is not enforced by the type system
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/lib/poker/persona-selector.ts` lines 13–14

```typescript
/** Compile-time guard — must stay in sync with persona IDs in personas.ts */
type PersonaId = "gto_grinder" | "tag_shark" | "lag_assassin" | "exploit_hawk";
```

This type is only used locally for `SELECTION_MATRIX`. If a new persona is added to `personas.ts` but not to `PersonaId`, TypeScript will not error because `PersonaId` is not derived from the personas source of truth. The comment says "must stay in sync" but there is no enforcement.

**Recommendation:** Derive `PersonaId` from the personas array using `(typeof PERSONAS)[number]['id']` or a const assertion, so adding a persona automatically updates the union type.

---

### P3-E: Extension message protocol is documented in background.ts but not in a shared types file
**File:** `/Users/matthijsbakker/Bakery/poker-assistant/extension/src/background.ts` lines 1–31

The protocol comment block at the top of background.ts is the only documentation for the message types crossing the extension↔content↔page boundary. Message type strings like `"POKER_CAPTURE"`, `"CLAUDE_ADVICE"`, `"PERSONA_RECOMMENDATION"` are plain string literals in all handlers, with no shared enum or discriminated union. If a message type is renamed in one handler but not another, TypeScript will not catch it.

**Recommendation:** Create `extension/src/messages.ts` with a discriminated union type for all cross-boundary messages. This is especially important for messages that carry payloads (AUTOPILOT_ACTION, CLAUDE_ADVICE) where the shape matters.

---

## Passed / No Action Needed

- **State machine reducer pattern**: The pure reducer in `state-machine.ts` is well-structured. The forward-only street enforcement with hysteresis is correct and prevents oscillation from animation-frame captures. The separation of pure logic (`state-machine.ts`) from React integration (`use-hand-tracker.ts`) and side effects (`use-continuous-capture.ts`) is clean and testable.

- **Local decision engine decoupling from Claude**: `rule-tree.ts` is a pure function with no imports from AI or API layers. The confidence threshold pattern (caller falls through to Claude when confidence is below threshold) is the correct abstraction. The engine is appropriately scoped to post-flop only, with explicit pre-flop delegation to persona charts.

- **Persona selector design**: `persona-selector.ts` correctly separates the selection matrix (temperature → persona IDs) from the lookup logic (`persona-lookup.ts`). The injectable `rng` parameter for randomness makes it unit-testable. The fallback to GTO Grinder is a safe default.

- **DOM card priority enforcement**: The decision to use DOM-scraped cards as ground truth and treat image detection as a fallback (documented in MEMORY.md) is architecturally sound. The priority logic in `route.ts` correctly implements this even if it is duplicated (see P1-B).

- **File storage structure**: Date-partitioned directories (`data/hands/YYYY-MM-DD/`) with UUID-named files is a reasonable approach for local development. The opt-in guard (`SAVE_HANDS !== "true"`) correctly prevents accidental disk fills.

- **`useRef` for in-flight guards**: `detectingRef` in `use-continuous-capture.ts` correctly prevents overlapping detection requests. Using `useRef` instead of `useState` for this purpose avoids unnecessary re-renders.

- **Request schema validation**: Both API routes use Zod `safeParse` with explicit error responses. Input size limits are enforced (`image: z.string().min(1).max(10_000_000)`). The `opponentHistory` actions array is bounded to 20 entries × 200 chars.

- **`streamObject` + `toTextStreamResponse` pattern**: The streaming architecture in `analyze-hand.ts` with progressive schema building on the client via `experimental_useObject` is correctly implemented.

- **Extension message debouncing**: The 3-second hotkey debounce in `background.ts` (line 35) prevents accidental duplicate captures. The `detectingRef` mutex in `use-continuous-capture.ts` prevents overlapping `/api/detect` requests.
