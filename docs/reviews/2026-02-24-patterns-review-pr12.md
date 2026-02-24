# Review: PR #12 — Code Patterns, Anti-Patterns, Naming, Quality
**Date:** 2026-02-24
**Branch:** feat/hand-session-advice-tracking
**Reviewed by:** Code Pattern Analysis Agent
**Focus:** Type duplication, interface placement, naming consistency, null patterns, non-null assertions, comment quality

---

## Critical Issues

- [ ] **[P1] `tableTemperatureSchema` duplicates `TableTemperature` union type**
  File: `app/api/analyze/route.ts:25-32`
  The six-value Zod enum is a manual copy of the `TableTemperature` union in
  `lib/poker/table-temperature.ts:12-18`. If a new temperature variant is added
  to `TableTemperature`, `route.ts` and any Zod validation it performs will
  silently diverge, accepting unknown strings without error.
  Recommended fix: export a `tableTemperatureSchema` from `lib/poker/table-temperature.ts`
  alongside the TS type (e.g. `export const tableTemperatureSchema = z.enum([...])`),
  then import it in route.ts. This makes `TableTemperature` the single source of
  truth for both type-checking and runtime validation.

- [ ] **[P1] `positionSchema` duplicates `Position` union type**
  File: `app/api/analyze/route.ts:34`
  `z.enum(["UTG","MP","CO","BTN","SB","BB"])` is a manual copy of
  `export type Position = "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB"` in
  `lib/card-detection/types.ts:49`. Same divergence risk applies.
  Recommended fix: export a `positionSchema` from `lib/card-detection/types.ts`
  (or a sibling `lib/card-detection/schemas.ts`) and import it in route.ts.

---

## High Priority

- [ ] **[P2] `CaptureContext` interface defined inside a UI component file**
  File: `components/analyzer/AnalysisResult.tsx:19-31`
  `CaptureContext` is a data-transfer type shared between the page layer
  (`app/page.tsx`) and the API layer (`app/api/analyze/route.ts`). Placing it
  in a presentational component file creates an inverted dependency: `page.tsx`
  must import a data type from a UI component:
  ```
  import type { CaptureContext } from "@/components/analyzer/AnalysisResult";  // page.tsx:21
  ```
  This violates the conventional architecture boundary where components import
  from lib/, not the other way around (or page importing shared types from components/).
  Recommended fix: move `CaptureContext` to `lib/storage/hand-records.ts`
  (it describes the context fields that flow into `HandRecord`) or to a new
  `lib/hand-tracking/types.ts` export. Both `AnalysisResult.tsx` and `page.tsx`
  would then import it from the same lib/ location.

- [ ] **[P2] `manualPokerHandIdRef` is used before its declaration**
  File: `app/page.tsx:63` (assignment) vs `app/page.tsx:126` (declaration)
  The `useRef` is declared at line 126 but is assigned inside a `useEffect`
  callback that closes over it at line 63. While JavaScript hoisting means this
  works at runtime (the closure captures the binding, not the value), reading
  the component top-to-bottom shows usage before declaration — a maintenance
  anti-pattern.
  Recommended fix: move the declaration to the top of the component's ref block.
  The natural place is near `prevStreetRef` (line 123) or grouped with other
  tracking refs (`submittedRef`, `savedRef` in AnalysisResult.tsx).

- [ ] **[P2] Naming inconsistency — `heroPositionCode` vs `heroPosition`**
  Affected files:
  - `lib/hand-tracking/types.ts:35` — `HandState.heroPosition: Position | null`
  - `lib/card-detection/types.ts:56` — `DetectionResult.heroPosition: Position | null`
  - `lib/storage/hand-records.ts:46` — `HandRecord.heroPositionCode: Position | null`
  - `app/api/analyze/route.ts:46` — request field `heroPositionCode`
  - `scripts/query-hands.ts:110` — fallback chain `r.heroPositionCode ?? r.analysis.heroPosition`
  The same concept carries two names across adjacent layers. The `Code` suffix
  was introduced in this PR for the storage/API layer without documentation of
  why it differs from the detection/state-machine layers that use `heroPosition`.
  Since `Position` is already a code type (`"UTG"`, `"MP"` etc.), the `Code`
  suffix is redundant.
  Recommended fix: standardise on `heroPosition` across all layers. If the
  distinction is intentional (e.g. `heroPosition` is a raw detection value
  subject to change, `heroPositionCode` is the locked value for the record),
  document this with a JSDoc comment on the `HandRecord` field.

- [ ] **[P2] Naming inconsistency — local `handId` vs `pokerHandId`**
  File: `app/api/analyze/route.ts:108`
  The local variable `const handId = crypto.randomUUID()` is the UUID for
  the *hand record file* (used as `record.id` and in `record.screenshotFile`).
  The separate field `record.pokerHandId` at line 120 is the poker-hand grouping
  key passed from the client. With both `handId` and `pokerHandId` in scope
  in the same block, the semantic difference is invisible to a reader.
  Recommended fix: rename the local variable to `recordId` to match its role
  as `HandRecord.id`. This aligns with the `HandRecord` field name and removes
  ambiguity about which "hand" id is being referred to.

---

## Low Priority / Nice-to-Have

- [ ] **[P3] Non-null assertion `hands.get(handKey)!` — safe but implicit**
  File: `scripts/query-hands.ts:79`
  The `!` is logically safe because `hands.set(handKey, [])` executes two lines
  above, but the guarantee is implicit — a future edit could break this without
  a type error.
  Recommended fix: use `hands.get(handKey)?.push(record)` or store the array
  reference immediately after `set`: `const arr = []; hands.set(handKey, arr); arr.push(record);`

- [ ] **[P3] Non-null assertion `r.personaSelected!.personaId` — guard is distant**
  File: `scripts/query-hands.ts:217`
  The assertion relies on the `filter(r => r.personaSelected != null)` at line 212.
  The guard and the assertion are separated by three lines including a `console.log`.
  If the filter is ever relaxed or removed, this becomes a runtime crash in a
  reporting script.
  Recommended fix: use `r.personaSelected?.personaId ?? "unknown"` for defensive
  access, matching the `?? "?"` pattern already used throughout the same function.

- [ ] **[P3] `?? null` coercions expose an `undefined`/`null` boundary mismatch**
  File: `app/api/analyze/route.ts:119-132`
  Eight consecutive lines use `?? null` to convert Zod `.optional()` (`undefined`)
  fields to `null` before assigning into `HandRecord`. The mismatch exists because
  Zod `.optional()` produces `undefined` but `HandRecord` uses `T | null` for
  absent values. The `?? null` pattern is a working band-aid, but it makes the
  boundary conversion implicit.
  Recommended fix: align the Zod schema to use `.nullable().optional()` (which
  accepts both `null` and omission), or change `HandRecord` nullable fields to
  `T | undefined`. Either choice makes the intent explicit and removes the
  coercion chain.

- [ ] **[P3] Comment `// Group records by sessionId, then by pokerHandId` restates the code**
  File: `scripts/query-hands.ts:65`
  The comment says exactly what the next two variable declarations show.
  Recommended fix: remove it, or replace with intent: `// Build session → hand → streets tree for chronological display`.

- [ ] **[P3] `STREET_ORDER` constant is declared inside `groupByHand` on every call**
  File: `scripts/query-hands.ts:82-87`
  The constant is always the same value and is allocated fresh on every
  `groupByHand` call. In a CLI script this is negligible, but it is the
  kind of object that belongs at module scope or as a `const` outside the function.
  Recommended fix: hoist to module-level constant (with `as const` for narrowed types).

---

## Passed / No Action Needed

- `CaptureContext` fields correctly re-use `TableTemperature` and `Position` from
  lib/ types — the imports inside AnalysisResult.tsx are correct; only the file
  location of the interface definition is wrong.
- `groupByHand` correctly handles `null` fallbacks: `sessionId ?? "unknown-session"`
  and `pokerHandId ?? record.id`. Both edge cases (manual mode, missing session)
  are covered.
- The `manualPokerHandIdRef.current = crypto.randomUUID()` call is correctly placed
  before `setImageBase64` in the CAPTURE message handler, ensuring the ID is set
  before the analysis effect fires.
- `writeHandRecord` uses `Promise.all` for parallel JSON + PNG writes — correct.
- Non-blocking `.catch()` on the hand record save in `route.ts:139-141` correctly
  prevents record-save failures from breaking the streaming response.
- `buildDetectionDetails()` is unchanged and correct.
- The `submittedRef` guard in `AnalysisResult.tsx:72` correctly prevents
  re-submission even if `captureContext` reference changes on re-render.
- Error-handling effect at `AnalysisResult.tsx:119-123` has no `captureContext`
  dependency and is clean.
