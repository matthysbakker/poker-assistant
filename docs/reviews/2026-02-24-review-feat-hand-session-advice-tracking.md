# Review: feat/hand-session-advice-tracking — PR #12
**Date:** 2026-02-24
**Reviewed by:** Architecture Review Agent

---

## Critical Issues

- [ ] **P1 — CaptureContext interface lives in a UI component file**
  `components/analyzer/AnalysisResult.tsx:19–31`
  `CaptureContext` is a pure data/domain type describing the capture-time context for a hand record.
  Exporting it from a React component file creates an inverted dependency: `page.tsx` (a route/orchestrator)
  imports a domain type from a UI leaf component. Any future refactor of AnalysisResult (rename, split, or
  delete) silently breaks the type contract for the record storage pipeline. The correct home is a shared
  types module closer to where the data is used: `lib/hand-tracking/types.ts` or a dedicated
  `lib/storage/capture-context.ts`.

- [ ] **P1 — captureContext is not atomically snapshotted at capture time; stale render values can slip through**
  `app/page.tsx:172–188` and `components/analyzer/AnalysisResult.tsx:71–83`
  `captureContext` is a plain object literal rebuilt on every render in `page.tsx`. It is then passed as a
  prop to `AnalysisResult`, where it sits in the `useEffect` dependency array (line 83). The submit effect
  fires whenever `imageBase64` changes, but at that point `captureContext` reflects the current render — not
  the render that established the imageBase64. In continuous mode, `onAnalysisTrigger` sets `imageBase64`
  inside a callback; React may batch state updates, causing `tableProfile` or `selectedPersona` to still
  hold values from the _previous_ hand's render when the submit fires. The `submittedRef` guard prevents
  duplicate submissions but does not protect against the context belonging to the wrong hand.

---

## High Priority

- [ ] **P2 — tableTemperatureSchema duplicated between route.ts and table-temperature.ts**
  `app/api/analyze/route.ts:25–32` vs `lib/poker/table-temperature.ts:12–18`
  The six enum members of `TableTemperature` are defined twice: once as a TypeScript union type and once as
  a Zod `z.enum` in the route. These must be kept in sync manually. A new temperature value added to
  `table-temperature.ts` will pass TypeScript compilation but fail Zod validation at runtime in the route,
  causing the entire analyze request to be rejected with a generic 400 error. The fix is to export a shared
  Zod schema from `table-temperature.ts` and derive the TypeScript type from it, then import it in the
  route.

- [ ] **P2 — pokerHandId generated in two independent places with no shared abstraction**
  `lib/hand-tracking/state-machine.ts:143–146` (continuous, inside the reducer at WAITING→PREFLOP
  transition) and `app/page.tsx:63` (manual, inline in the CAPTURE message handler).
  The ID semantics differ: the state machine ID is tied to a confirmed 2-frame hysteresis hand boundary;
  the manual ID is generated at message-receipt time before `imageBase64` is even set. A third capture
  path would require a third ad-hoc `crypto.randomUUID()` call with no enforced contract. A
  `generatePokerHandId()` factory function in `lib/hand-tracking/` would unify the calling convention
  without changing the current behaviour.

- [ ] **P2 — captureContext rebuilt as a new object on every render; not memoized**
  `app/page.tsx:172–188`
  The `captureContext` object literal is constructed unconditionally in the render body. In React 19
  concurrent mode, renders can be interrupted and replayed. The object's referential identity changes on
  every render, which causes the submit `useEffect` in `AnalysisResult` to execute its body on every
  parent re-render (the `submittedRef` guard only prevents the actual API call, not the effect execution).
  At a 2s capture cadence this effect runs ~30 times per minute while a hand is in progress. The fix is
  `useMemo` keyed on the primitive fields, or atomically snapshotting into a ref at trigger time (see P1
  fix above, which also solves this).

---

## Low Priority / Nice-to-Have

- [ ] **P3 — positionSchema in route.ts duplicates the Position union from card-detection/types.ts**
  `app/api/analyze/route.ts:34` vs `lib/card-detection/types.ts:49`
  Same pattern as the tableTemperatureSchema duplication but lower severity because `Position` has six
  stable members unlikely to change. Still worth unifying with a Zod schema exported from
  `lib/card-detection/types.ts`.

- [ ] **P3 — manualPokerHandIdRef assignment ordering is implicit and fragile**
  `app/page.tsx:63–64`
  `manualPokerHandIdRef.current` is assigned one line before `setImageBase64(...)`. This ordering is
  correct as written because React batches the state update, but it is an implicit ordering contract with
  no comment or guard. A future developer reordering those two lines or refactoring into a helper function
  could break the invariant that the ref is populated when the next render reads it through `captureContext`.
  A co-location comment documents the intent.

- [ ] **P3 — groupByHand in query-hands.ts sorts arrays in-place from the Map**
  `scripts/query-hands.ts:102`
  `streetRecords.sort(...)` mutates the array stored in the Map. For an immutable CLI script this is
  benign, but it is a correctness footgun if the records ever need to be reused. Use
  `[...streetRecords].sort(...)` to sort a shallow copy.

---

## Passed / No Action Needed

- Backward compatibility in `query-hands.ts` is genuine. All new fields (`sessionId`, `pokerHandId`,
  `tableTemperature`, `tableReads`, `heroPositionCode`, `personaSelected`) are typed `| null` in
  `HandRecord`. All access sites in `query-hands.ts` guard with `?? fallback` or `!= null` filters before
  use. Old JSON records missing these keys deserialize to `undefined`, which the null-coalescing checks
  handle correctly. No crash path exists for old records.

- `loadAllRecords` wraps each `JSON.parse` in a try/catch with warn-and-skip. Corrupt or partially written
  records do not crash the script.

- The state machine reducer in `state-machine.ts` is pure. The `pokerHandId` generation inside the reducer
  is the only non-determinism; this is an accepted tradeoff for the use case and does not violate reducer
  purity in a meaningful way for this application.

- The `ANALYSIS_COMPLETE` action does not clear `pokerHandId`. The ID persists through the hand's
  lifetime in the state and is correctly available at each street's analysis trigger.

- The server-side save path in `route.ts` (lines 119–134) uses `?? null` for all optional capture context
  fields, providing safe server-side defaults without hard failures for missing context from old clients.

- The `submittedRef` guard correctly prevents double-submits even with the reference instability described
  in P1/P2. The guard is the right pattern for `useObject` submit idempotency.

- `key={streamKey}` remounting of `AnalysisResult` between hands is the correct approach to reset
  `useObject` state; this is unaffected by the captureContext issues.

---

## Recommended Fixes (ordered by priority)

### Fix 1 (P1): Move CaptureContext to a shared types module

Create or extend `/Users/matthijsbakker/Bakery/poker-assistant/lib/hand-tracking/types.ts` to export
`CaptureContext`. Update the import in `page.tsx` from `AnalysisResult.tsx` to the types module, and
keep the re-export or direct import in `AnalysisResult.tsx`.

### Fix 2 (P1 + P2 combined): Snapshot captureContext atomically at trigger time using a ref

Instead of passing `captureContext` as a live prop and relying on React render timing, snapshot it at the
exact moment `imageBase64` is established:

```ts
// In page.tsx
const captureContextRef = useRef<CaptureContext | null>(null);

// In the CAPTURE handler (manual path):
captureContextRef.current = {
  sessionId: getSession().id,
  pokerHandId: manualPokerHandIdRef.current,
  tableTemperature: tableProfile?.temperature ?? null,
  // ...
};
setImageBase64(event.data.base64);

// In onAnalysisTrigger (continuous path):
captureContextRef.current = {
  sessionId: getSession().id,
  pokerHandId: handState.pokerHandId,
  // ...
};
setImageBase64(base64);
```

Pass `captureContextRef` (not `captureContext`) to `AnalysisResult` and read
`captureContextRef.current` inside the submit effect. This eliminates the stale-closure risk and removes
`captureContext` from the dependency array entirely.

### Fix 3 (P2): Derive Zod tableTemperatureSchema from the canonical type

In `/Users/matthijsbakker/Bakery/poker-assistant/lib/poker/table-temperature.ts`:

```ts
import { z } from "zod";
export const tableTemperatureSchema = z.enum([
  "tight_passive", "tight_aggressive", "loose_passive",
  "loose_aggressive", "balanced", "unknown",
]);
export type TableTemperature = z.infer<typeof tableTemperatureSchema>;
```

Then in `/Users/matthijsbakker/Bakery/poker-assistant/app/api/analyze/route.ts`:

```ts
import { tableTemperatureSchema } from "@/lib/poker/table-temperature";
// Remove the local z.enum([...]) definition
```

### Fix 4 (P2): Introduce a single pokerHandId generation point

Extract a `generatePokerHandId(): string` function from `lib/hand-tracking/`:

```ts
// lib/hand-tracking/types.ts or a new lib/hand-tracking/hand-id.ts
export function generatePokerHandId(): string {
  return crypto.randomUUID();
}
```

Call it from both `state-machine.ts` (line 145) and `page.tsx` (line 63). This documents the contract,
makes searching for generation sites trivial, and makes a third capture path straightforward to add.
