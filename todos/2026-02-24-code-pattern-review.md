# Review: Code Pattern Analysis
**Date:** 2026-02-24
**Reviewed by:** Code Pattern Analysis Agent

---

## Critical Issues

- [ ] **P1 — Duplicate card-parsing logic between two modules** (`lib/poker/hand-evaluator.ts` lines 41-51 vs `lib/poker/equity/card.ts` lines 23-33): Both files define an identical `parseCard` function with the same `RANK_MAP`, `SUIT_MAP`, and null-return logic. The equity module's version (`parseCards`) already has a type-safe filter, but `hand-evaluator.ts` still carries its own private copy used via `.filter(Boolean) as ParsedCard[]` at lines 143-145. This is the most impactful duplication in the codebase.

- [ ] **P1 — Duplicate straight-counting algorithm between two modules** (`lib/poker/hand-evaluator.ts` lines 72-95 `straightOutCount` vs `lib/poker/equity/outs.ts` lines 32-56 `countStraightOuts`): Both implement the same bitmask-window loop over 5-card windows. `hand-evaluator.ts` conflates OESD/gutshot into one number while `equity/outs.ts` separates them — a behavioural divergence that could produce inconsistent decisions if the two paths ever disagree.

- [ ] **P1 — Duplicate flush-counting algorithm** (`lib/poker/hand-evaluator.ts` lines 61-68 `flushOutCount` vs `lib/poker/equity/outs.ts` lines 20-29 `countFlushOuts`): Same logic, separate module-level `_suitCounts` buffers. Each module also duplicates `_rankCounts` and `_suitCounts` pre-allocated buffers, so mutations in one never contaminate the other, but the code still exists twice.

- [ ] **P1 — `parseDomCards` is a private function in `app/api/analyze/route.ts` (lines 29-42) with no consumer outside that file**: The `record` route handles preflop-only hands where cards arrive as structured fields, so it avoids the problem — but the `analyze` route calls `parseDomCards` in six places across the same 230-line file. If a second route ever needed DOM-card parsing it would be copy-pasted. Extract to `lib/poker/dom-cards.ts` or `lib/ai/dom-cards.ts`.

---

## High Priority

- [ ] **P2 — `.filter(Boolean)` loses type safety at three call sites** (`lib/poker/hand-evaluator.ts` lines 143, 144, 145): Each call casts the result with `as ParsedCard[]` after `.filter(Boolean)`, which silently loses the `null` narrowing. The equity module's `parseCards()` already shows the correct pattern: `.filter((c): c is Card => c !== null)`. The `hand-evaluator` should adopt the same type guard or simply call `parseCards`.

- [ ] **P2 — `confidence === "HIGH" || m.confidence === "MEDIUM"` repeated four times** in `app/api/analyze/route.ts` (lines 129, 139, 181, 194) and once more in `lib/card-detection/detect.ts` (lines 33-34, 105). A predicate `isConfident = (m) => m.confidence === "HIGH" || m.confidence === "MEDIUM"` already exists as a local const inside `detectCards()` (detect.ts:33) but is not exported. The four inline repetitions in the route duplicate that logic. Extract as a shared helper in `lib/card-detection/types.ts` or `lib/card-detection/index.ts`.

- [ ] **P2 — Inline `personaSelected` shape is defined in three separate places** without a shared type: `lib/storage/hand-records.ts` lines 47-52, `lib/hand-tracking/types.ts` lines 54-59, and inside the `requestSchema` in `app/api/analyze/route.ts` lines 66-74. All three are structurally identical (`personaId`, `personaName`, `action`, `temperature`) but unlinked. One structural change will require three edits.

- [ ] **P2 — `PokerAction` type (`lib/poker/types.ts` line 1) and the Zod enum in API routes diverge in member ordering**: `types.ts` declares `"FOLD" | "CHECK" | "CALL" | "BET" | "RAISE"`, while `app/api/record/route.ts` line 12 and `app/api/decision/route.ts` line 4 both use `z.enum(["FOLD", "CHECK", "CALL", "RAISE", "BET"])` (BET and RAISE swapped). The schema in `lib/ai/schema.ts` line 90 uses `["FOLD", "CHECK", "CALL", "BET", "RAISE"]`. Three different orderings for the same five values creates confusion, and the Zod enums are not derived from the TypeScript union, so they can drift. Centralise as `z.enum(POKER_ACTIONS)` where `POKER_ACTIONS` is derived from the `PokerAction` union (or vice-versa).

- [ ] **P2 — `Street` type is declared twice with different members**: `lib/poker/types.ts` line 2 has `"PREFLOP" | "FLOP" | "TURN" | "RIVER"` (no WAITING); `lib/hand-tracking/types.ts` line 6 has `"WAITING" | "PREFLOP" | "FLOP" | "TURN" | "RIVER"`. The state machine imports from `hand-tracking/types.ts` and the AI schema imports from `lib/ai/schema.ts` which uses the Zod enum only for four values. If a third consumer imports `Street` from the wrong module it silently accepts or rejects "WAITING". One canonical definition with an optional extension pattern would be cleaner.

- [ ] **P2 — `opponentHistory` inline object shape defined separately in `app/api/analyze/route.ts` (lines 44-53) and `lib/storage/hand-records.ts` (lines 29-38)**: The route schema has a `notes` field (`.max(500).optional()`); the `HandRecord` interface does not. If a record is saved with notes attached, they are silently dropped. Either add `notes` to `HandRecord` or strip it explicitly in the route before saving.

- [ ] **P2 — Magic numbers in confidence thresholds are not named constants** in `lib/card-detection/match.ts` (lines 121-128): `0.90`, `0.07`, `0.85`, `0.02`, `0.75` are inlined. They are documented in the JSDoc comment but not as named constants, making them invisible to grep and hard to adjust in a coordinated way. Compare with `lib/poker/exploit.ts` which correctly uses `AP1_CONFIDENCE`, `AP2_CONFIDENCE`, etc.

- [ ] **P2 — `detect.ts` `formatDetectionSummary` duplicates the "trusted" filter logic** (lines 104-105) that already exists as `isConfident` at line 33. Both use the same `HIGH || MEDIUM` predicate, defined two different ways in the same 120-line file.

- [ ] **P2 — `WAITING_HYSTERESIS` constant is read via a local `threshold` alias** (`lib/hand-tracking/state-machine.ts` line 110: `const threshold = WAITING_HYSTERESIS`) before being used at line 113. The alias adds no information and makes the constant appear twice. The `FORWARD_HYSTERESIS` path at line 134 references the constant directly; inconsistent style within the same function.

---

## Low Priority / Nice-to-Have

- [ ] **P3 — `locateCards` uses non-null assertion on image metadata** (`lib/card-detection/locate.ts` line 59-60: `metadata.width!`, `metadata.height!`). Sharp can return `undefined` width/height for some image types. A runtime guard with an explicit error would be safer and easier to debug.

- [ ] **P3 — `loadRefs` uses a non-null assertion after `refCache.get`** (`lib/card-detection/match.ts` line 28: `refCache.get(group)!`). Because the `has` check precedes the `get`, this is safe in practice, but `refCache.get(group) ?? new Map()` is idiomatically safer.

- [ ] **P3 — `refs.get(card)!` at match.ts line 39**: Same pattern — `has` is checked on line 38, so the assertion is safe, but the non-null assertion propagates across the `if (!refs.has(card)) refs.set(card, [])` line. Using `refs.get(card)!.push(...)` is fine but could be written as a `getOrCreate` helper to make intent clear.

- [ ] **P3 — Inline confidence-level strings `"HIGH" | "MEDIUM" | "LOW" | "NONE"` appear in both `lib/card-detection/types.ts` (line 32) and `lib/storage/hand-records.ts` (line 10) independently**: `lib/poker/types.ts` exports a `Confidence` type (`"HIGH" | "MEDIUM" | "LOW"`) that drops `"NONE"`. Three separate definitions for overlapping concepts.

- [ ] **P3 — `rule-tree.ts` line 87 uses a cast to work around a type gap**: `const streetsLeft = (communityCards.length === 3 ? 2 : 1) as 1 | 2`. The underlying type is `1 | 2`, which the ternary actually guarantees, but TypeScript infers `number`. A branded type or overload for `exactOutEquity` accepting `1 | 2` would remove the cast.

- [ ] **P3 — `detect.ts` `heroPosition` function name shadows the field name on `DetectionResult`**: `export function heroPosition(dealerSeat: number): Position` (detect.ts line 16) and `DetectionResult.heroPosition` (types.ts line 60) are both named `heroPosition`. When reading `result.heroPosition` it is not immediately clear whether you are calling the function or reading the field. The function could be renamed `positionFromDealerSeat` or `dealerSeatToPosition`.

- [ ] **P3 — `state-machine.ts` has redundant `WAITING_HYSTERESIS` alias**: The `const threshold = WAITING_HYSTERESIS` alias at line 110 is used once two lines later. The alias communicates no additional intent. Minor but inconsistent with how `FORWARD_HYSTERESIS` is used directly.

- [ ] **P3 — The `decision` route (`app/api/decision/route.ts`) receives a decision but does nothing with it except log**: Lines 35-38 log the decision and return `{ ok: true }`. There is no persistence, no forwarding, and no consumption. The comment (lines 12-16) says this enables "observability and hand history logging" but neither happens. This is either dead-code-in-progress or the route is vestigial.

- [ ] **P3 — Dead technical-debt markers**: `extension/src/poker-content.ts` contains 30+ `todo NNN` references inline in comments (e.g. lines 117, 118, 119, 135, 157, 204, 553, etc.). These are numbered tickets not tracked in the `todos/` directory. No corresponding `.md` files exist for most of them. The comment style is consistent but the items are invisible to the review process.

---

## Passed / No Action Needed

- **Error handling in API routes is consistent**: all three routes (`analyze`, `record`, `decision`) guard JSON parsing with a try/catch returning 400, then use `safeParse` for Zod validation. No silent swallowed errors.
- **`app/api/analyze/route.ts` non-blocking side effects** (file writes at lines 98-102 and the hand record at lines 164-225) correctly use `.catch()` so streaming is never blocked by disk I/O failures.
- **`lib/card-detection/match.ts`** straight-algorithm logic is well-documented and the multi-variant reference cache design is sound.
- **`lib/hand-tracking/state-machine.ts`** is a clean pure reducer with no side effects; forward-only enforcement and hysteresis constants are correctly named.
- **`lib/poker/exploit.ts`** uses named constants for all AP override confidence values (AP1–AP4); the runtime guard at line 141 is correctly justified.
- **`lib/ai/schema.ts`** is the single source of truth for `HandAnalysis`; the type is inferred from the schema, not duplicated.
- **`lib/poker/equity/card.ts` `parseCards`** uses a proper type-guard filter `(c): c is Card => c !== null` — the gold standard the rest of the codebase should adopt.
- **Test coverage for the poker logic layer is strong**: `board-analyzer`, `equity`, `exploit`, `hand-evaluator`, `persona-selector`, `rule-tree`, and `table-temperature` all have `__tests__` files. The rule-tree tests cover preflop guard, nut hands, TPTK, draws, fallbacks, SPR commit zone, and exploit integration.
- **Zero tests for card-detection pipeline** (`locate`, `match`, `preprocess`, `detect`, `dealer-button`, `buttons`) — this is noted but expected given the image-processing nature; visual debug scripts in `scripts/` serve as the testing mechanism.
- **Naming conventions are consistent** across `lib/`: kebab-case files, camelCase functions, PascalCase interfaces, SCREAMING_SNAKE for module-level constants. The only deviation is the `_` prefix on private module-level buffers (`_rankCounts`, `_suitCounts`, `_evalCache`) which is an acceptable convention for hot-path pre-allocated state.
- **No hardcoded secrets** found; API key loading follows the Keychain pattern documented in global CLAUDE.md.
