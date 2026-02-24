# Review: feat/local-poker-decision-engine
**Date:** 2026-02-24
**Reviewed by:** System Architecture Expert (Claude)
**Branch:** feat/local-poker-decision-engine vs main

---

## Architecture Overview

The PR adds a local post-flop decision engine to a Firefox MV2 browser extension that
controls real-money poker play. The engine sits between DOM observation and DOM execution,
intercepts hero turns post-flop, and either fires immediately (high confidence) or falls
through to the existing Claude Haiku API path.

Module graph (relevant to this PR):

```
poker-content.ts
├── rule-tree.ts           (GTO decision layer)
│   ├── hand-evaluator.ts  (pure tier classifier)
│   ├── board-analyzer.ts  (pure board texture)
│   ├── exploit.ts         (opponent adjustment layer)
│   │   ├── hand-evaluator.ts  [type-only import]
│   │   └── rule-tree.ts       [type-only import]  ← TYPE-CYCLE
│   └── equity/
│       ├── card.ts
│       ├── outs.ts            → card.ts
│       ├── odds.ts
│       ├── pot-odds.ts
│       ├── implied-odds.ts
│       ├── dirty-outs.ts      → ../hand-evaluator.ts [type-only]
│       └── hand-strength.ts   → ../hand-evaluator.ts [type-only]
└── equity/pot-odds.ts     (parseCurrency — used standalone)
```

---

## Critical Issues

### C1: Circular dependency via type-only import (exploit.ts → rule-tree.ts)
**Files:** `lib/poker/exploit.ts:16`, `lib/poker/rule-tree.ts:15`

`exploit.ts` imports `LocalDecision` from `rule-tree.ts`:
```typescript
// exploit.ts line 16
import type { LocalDecision } from "./rule-tree";
```
`rule-tree.ts` imports `applyExploitAdjustments` from `exploit.ts`:
```typescript
// rule-tree.ts line 15
import { applyExploitAdjustments } from "./exploit";
```

This is a genuine circular dependency. TypeScript's `import type` erases the type at
emit time, so there is no runtime cycle in the compiled output — the bundler (Bun/esbuild)
will not deadlock on this. However:

1. The cycle is invisible to tools that trace runtime imports. Any future bundler, tree-shaker,
   or lint rule that does not distinguish type-only imports from value imports will flag or
   mishandle this.
2. It establishes a coupling pattern that is one `import` keyword change away from becoming
   a hard runtime cycle. If `LocalDecision` ever acquires a runtime value (a default export,
   a class, a runtime constant), the type-only guard disappears and the cycle becomes real.
3. `LocalDecision` is the output type of `applyRuleTree()`. It being defined in `rule-tree.ts`
   and consumed by `exploit.ts` means exploit.ts is shaped by its consumer rather than by
   its own domain logic. This is an inversion of the intended dependency direction.

**Correct fix:** Move `LocalDecision` to a shared neutral location — either `lib/poker/types.ts`
(which currently holds unrelated UI types) or a dedicated `lib/poker/decision-types.ts`.
Both modules then import from the shared file, breaking the cycle entirely.

### C2: Module-global mutable Uint8Arrays used across two separate modules
**Files:** `lib/poker/hand-evaluator.ts:55-56`, `lib/poker/equity/outs.ts:16-17`

`hand-evaluator.ts` declares:
```typescript
// hand-evaluator.ts lines 55-56
const _rankCounts = new Uint8Array(15);
const _suitCounts = new Uint8Array(4);
```

`equity/outs.ts` independently declares its own:
```typescript
// equity/outs.ts lines 16-17
const _suitCounts = new Uint8Array(4);
const _rankCounts = new Uint8Array(15);
```

These are separate allocations in separate module scopes so they do not actually alias each
other at runtime. The reentrancy concern the PR question raised is moot because:
- JavaScript is single-threaded: no preemptive interruption mid-function.
- Both modules `fill(0)` their arrays at the top of every function that uses them.
- The call from `applyRuleTree()` to `evaluateHand()` to `analyzeOuts()` is synchronous
  and sequential. `_rankCounts` in `outs.ts` is untouched while `_classify()` in
  `hand-evaluator.ts` runs its own `_rankCounts`.

The real problem is silent duplication. The same low-level computation (rank/suit counting)
is duplicated across two modules with identical logic, which creates maintenance drift.
`hand-evaluator.ts` has a `flushOutCount()` at line 61 that duplicates `countFlushOuts()`
in `equity/outs.ts` at line 20. They produce the same results by different means.
`straightOutCount()` at `hand-evaluator.ts:71` duplicates `countStraightOuts()` at
`equity/outs.ts:31`. This means a bug fix in one does not automatically propagate to the
other — both must be updated in sync.

**Correct fix:** `hand-evaluator.ts` should import from `equity/outs.ts` and `equity/card.ts`
for the low-level counting operations, or the counting functions should be extracted into a
shared `lib/poker/card-utils.ts` that both modules consume. The pre-allocated arrays are a
micro-optimization that is only meaningful if profiling shows GC pressure — they should not
justify duplication.

---

## High Priority

### H1: `LocalDecision` type defined at the wrong layer
**File:** `lib/poker/rule-tree.ts:26-34`

`LocalDecision` is the public interface between the decision engine and its callers
(`poker-content.ts`). It is currently defined inside `rule-tree.ts` — the implementation
file for one layer of the engine — and re-exported from there. This means:

- The interface cannot be referenced without pulling in the rule-tree implementation.
- The type-only circular dependency with `exploit.ts` (C1 above) exists precisely because
  the output type lives inside one of the internal layers.
- `poker-content.ts` imports it correctly with `import type { LocalDecision }`, but it
  imports it from `rule-tree.ts`, meaning `poker-content.ts` is aware of the layering
  rather than the abstraction.

**Correct fix:** Same as C1 — move `LocalDecision` and `RuleTreeInput` to a
`lib/poker/decision-types.ts` file. `poker-content.ts` imports the type from there.
`rule-tree.ts` and `exploit.ts` both import from there. No component knows about any
other component through these types.

### H2: `lastTableTemperature` is set once per hand-start, never cleared
**File:** `extension/src/poker-content.ts:90,670-673`

```typescript
// poker-content.ts line 90
let lastTableTemperature: { dominantType: TableTemperatureLocal; handsObserved: number } | null = null;
```

`lastTableTemperature` is populated inside `requestPersona()` (line 670-673), which is
called at hand-start and as a fallback when persona is missing. It is intentionally NOT
cleared in the new-hand detection block at line 1159-1171, which clears `lastPersonaRec`,
`lastClaudeAdvice`, `monitorAdvice`, `executing`, `handMessages`, and `streetActions`.

The rationale for this is reasonable: table dynamics (VPIP/AF of opponents) do not change
between hands, so persisting the temperature is sensible as a session-level cache.
However, this creates an unexamined correctness risk:

- If a player leaves the table mid-session and is replaced by a player with a very different
  style, `lastTableTemperature` will continue to reflect the departed player's stats.
- There is no documented maximum staleness bound. `handsObserved` is set to a static proxy
  (3-5 players with VPIP → 30, etc.) rather than a count of hands played.
- After a table-change (player leaves poker room, re-enters a different table), the
  temperature from the previous table will continue to influence exploit adjustments for
  the new table until the first `requestPersona()` call completes.

The intentional persistence should be documented at the declaration site. If intentional,
the `handsObserved` proxy description at line 671 should include a staleness comment so
future readers do not "fix" the missing reset.

### H3: `handsObserved` proxy semantics are misleading
**File:** `extension/src/poker-content.ts:671-673`

```typescript
// poker-content.ts lines 671-673
const withVpip = tableStats.filter((s) => s.seat !== heroSeat && s.vpip !== null);
lastTableTemperature = {
  dominantType: domTemperature,
  handsObserved: withVpip.length >= 3 ? 30 : withVpip.length >= 2 ? 15 : withVpip.length >= 1 ? 6 : 0,
};
```

`handsObserved` is the sample-confidence parameter consumed by `sampleConfidenceMultiplier()`
in `exploit.ts`. Its intended semantics are the number of hands observed against the
opponent — a time-based sample that accumulates per session. What is actually stored is
a static scalar derived from the count of players with VPIP data visible in the DOM at the
moment `requestPersona()` is first called.

This proxy conflates two distinct concepts:
- "How many players have VPIP data" — a data availability signal.
- "How many hands have been played with these players" — a temporal confidence signal.

The `sampleConfidenceMultiplier()` function treats the value as the latter. A table with
3 players all showing VPIP immediately maps to `handsObserved=30`, triggering 100% exploit
scaling from the first hand. At a micro-stakes table where VPIP overlays appear after 10+
hands of data collection, this is not completely wrong — the data is real. But the system
cannot distinguish between a VPIP overlay that represents 10 hands of data vs 100 hands,
both collapse to the same `30` proxy.

The parameter should either:
1. Be named `vpipDataQuality` or similar to match its actual semantics, OR
2. Be replaced with an actual hand counter that increments on each new-hand detection.

The current combination — a variable named `handsObserved` that contains a step-function
approximation of data availability — will mislead any future developer who reads the exploit
layer documentation and expects the variable to mean what it says.

### H4: Uniform confidence threshold across all hand types creates exploitable cliff edges
**File:** `extension/src/poker-content.ts:94`

```typescript
// poker-content.ts line 94
let CONFIDENCE_THRESHOLD = 0.60;
```

The single threshold applies uniformly to all decisions regardless of their risk profile.
Consider the actual distribution:
- `nut` hands: base confidence 0.90-0.92. Well above threshold. Safe.
- `draw` hands with `equity > potOdds`: base confidence 0.68-0.75. Sometimes above, sometimes
  below depending on exploit adjustments.
- `weak_draw` gutshot with marginal odds: base confidence 0.62. Just above threshold for CALL.

The weak_draw CALL case (confidence 0.62, threshold 0.60) is the most dangerous gap. The
margin is 0.02 — smaller than any single exploit delta. A LOOSE_PASSIVE adjustment adds
+0.15 to callDown, pushing it to 0.77 (high confidence CALL with a gutshot against a
calling station, which is correct). But a TIGHT_AGGRESSIVE adjustment subtracts -0.15,
pushing it to 0.47 (falls to Claude). The threshold boundary produces action-switches
on 0.02 of confidence movement in exactly the decisions where the engine is least certain.

A per-tier minimum threshold (e.g., nut/strong ≥ 0.70, top_pair_gk ≥ 0.65, draws ≥ 0.68)
would make the cliff edges predictable and separately tunable. The current design makes
tuning the threshold a global knob that simultaneously tightens or loosens all tiers.

### H5: Exploit layer can boost a below-threshold GTO decision above the execution threshold
**Files:** `lib/poker/rule-tree.ts:263-274`, `lib/poker/exploit.ts:113-165`

The GTO layer produces a confidence score, then `applyExploitAdjustments()` modifies it.
The caller (`poker-content.ts:1260`) evaluates the final confidence after exploit
adjustment:

```typescript
// poker-content.ts line 1260
if (local && local.confidence >= CONFIDENCE_THRESHOLD) {
```

This means an exploit adjustment can promote a sub-threshold GTO decision to executable.
A concrete path:
1. `weak_draw` gutshot, no bet → `CHECK`, confidence 0.60 (borderline).
2. TIGHT_PASSIVE table, high-card board → AP-2 fires, converts CHECK to BET, confidence 0.72.
3. Now `BET` is executed with confidence 0.72, bypassing Claude.

AP-2 is the "probe-bet scare cards vs nits" override. The BET action is correct in theory,
but the GTO base was a CHECK with confidence exactly at the floor. The exploit layer has
effectively amplified the decision past the safety threshold without the GTO layer's
consent. The hand tier is still a weak draw — the exploit is placing a bet with a weak
holding based on inferred opponent tendency from a VPIP proxy.

This is the one scenario where the exploit layer's confidence boost is architecturally
dangerous rather than merely inaccurate. Hard overrides (AP-1 through AP-4) should not be
able to push a decision above threshold when the GTO base was at or below threshold. A
possible fix is to record `gtoConfidence` separately and apply the execution threshold to
both: `finalConfidence >= threshold AND gtoConfidence >= minimumGtoFloor`.

---

## Risk Analysis

### Separation of concerns assessment

The three-layer architecture (GTO → exploit → caller) is the correct abstraction. Each
layer is a pure function with no side effects. The test coverage for exploit.ts is
comprehensive (58 test cases). The test coverage for rule-tree.ts covers the critical
paths (nut, TPTK, draws, multiway, SPR). This is architecturally appropriate for
software that controls real-money actions.

The exploit layer is positioned as a post-processing transformation, not a replacement
decision-maker. This is the right design — it means a bad opponent model cannot produce
an action the GTO layer has not pre-approved. The one exception is hard overrides (AP-1
through AP-4) which do replace the action — and as noted in H5, those overrides can bypass
the threshold check.

### Module boundary appropriateness

The `equity/` subdirectory is a well-scoped boundary. Five focused files (card, outs, odds,
pot-odds, implied-odds, dirty-outs, hand-strength) each have a clear responsibility. The
index barrel export is clean. The cross-boundary import from `dirty-outs.ts` and
`hand-strength.ts` to `../hand-evaluator.ts` (type-only) is the correct pattern for
consuming types without creating hard coupling.

The `board-analyzer.ts` module is correctly isolated. Its `BoardTexture` type is not leaked
into the exploit layer — instead `board.wetScore` and `board.paired` are extracted in
`rule-tree.ts` and passed as primitive scalars. This prevents the exploit layer from
depending on the full board analysis structure.

### Long-term drift risks

1. The `_evalCache` in `hand-evaluator.ts` (line 126) and `_boardCache` in `board-analyzer.ts`
   (line 54) grow unbounded within a session. `clearEvalCache()` and `clearBoardCache()` are
   called on new-hand detection in `poker-content.ts`. If new-hand detection ever misses
   (e.g., the handId selector fails on a UI change), the caches accumulate stale entries.
   This is a low probability event but worth noting as a correctness dependency: cache
   correctness depends on reliable handId scraping.

2. The `opponentType` string passed to `exploit.ts` is mapped from a `TableTemperatureLocal`
   enum via `opponentTypeFromTemperature()`. This mapping is a local function in
   `poker-content.ts` (lines 513-524) and not co-located with the `DELTAS` table in
   `exploit.ts`. If a new opponent type is added to `DELTAS`, the mapping function in
   `poker-content.ts` must be updated manually. There is no static enforcement of this
   alignment — a new `DELTAS` key that has no corresponding mapping will silently be treated
   as undefined (no exploit adjustment).

3. `board-analyzer.ts` uses a locally-defined `_parseRank()` function (line 154) that is
   identical to part of `RANK_MAP` in `hand-evaluator.ts`. Three files now define the same
   rank-to-number mapping: `hand-evaluator.ts:32-35`, `board-analyzer.ts:155-159`,
   `equity/card.ts:11-14`. Any inconsistency (e.g., a new rank alias) requires updating
   three locations.

---

## Compliance Check

| Principle | Status | Notes |
|-----------|--------|-------|
| Single Responsibility | PASS | Each module has one job |
| Open/Closed | PASS | New opponent types added via DELTAS record, no code changes |
| Liskov Substitution | N/A | No inheritance in use |
| Interface Segregation | PARTIAL | `RuleTreeInput` has optional fields (opponentType, handsObserved) that only matter post-flop; the caller always provides all fields |
| Dependency Inversion | FAIL | rule-tree.ts depends on exploit.ts concretely; exploit.ts depends on rule-tree.ts for types — see C1 |
| No circular deps (value imports) | PASS | No runtime circular dependencies |
| No circular deps (type imports) | FAIL | exploit.ts → rule-tree.ts type-only import creates logical cycle |
| Pure functions (side-effect free) | PASS | All lib/poker/ functions are pure |
| Testability | PASS | All modules in lib/poker/ are independently testable |
| Immutability of inputs | PASS | exploit.ts uses spread to return new objects (line 117, 129, etc.) |
| Cache correctness | CONDITIONAL | Caches require new-hand detection to remain reliable |

---

## Recommendations

**R1 (Address C1, H1) — Move shared types out of implementation files**

Create `/Users/matthijsbakker/Bakery/poker-assistant/lib/poker/decision-types.ts` containing
`LocalDecision` and `RuleTreeInput`. Both `rule-tree.ts` and `exploit.ts` import from there.
`poker-content.ts` imports `LocalDecision` from there. The type-cycle disappears.

**R2 (Address C2) — Consolidate card-counting primitives**

Extract rank/suit counting into `lib/poker/equity/card-utils.ts` or extend `equity/card.ts`
with counting functions. `hand-evaluator.ts` removes its local `flushOutCount()` and
`straightOutCount()` and calls the shared versions. `equity/outs.ts` does the same.
The pre-allocated Uint8Array optimization is measurable only at call volumes far above
what this use case sees — profile before choosing to keep it.

**R3 (Address H2) — Document `lastTableTemperature` persistence as intentional**

Add a comment at `poker-content.ts:90` explaining that temperature is a session-level signal
that intentionally survives new-hand detection. Add a comment at line 671 explaining the
staleness model and its limitations. Consider adding a reset when player-seat composition
changes materially (e.g., more than one player leaves the table).

**R4 (Address H3) — Rename or replace `handsObserved`**

Either rename the field to `vpipPlayerCount` and rename `sampleConfidenceMultiplier` to
reflect what it actually scales, or replace the proxy with an actual hand counter
incremented at new-hand detection in `processGameState()`. The second option produces
semantically correct behavior; the first at least stops lying to future readers.

**R5 (Address H5) — Gate hard exploit overrides behind a GTO confidence floor**

In `applyExploitAdjustments()`, before applying hard overrides (AP-1 through AP-4) that
change the action, check that `base.confidence >= minimumFloor` (e.g., 0.55). If the GTO
layer was not confident enough to act without exploit help, a hard override should not be
able to push the decision to executable. This preserves the intended relationship between
the GTO and exploit layers.

**R6 (Address H4) — Consider per-tier confidence floors at the call site**

In `poker-content.ts` around line 1260, before executing a local decision, apply a
tier-specific minimum confidence that is higher than the global threshold for uncertain
tiers. This is a one-location change that does not require modifying the engine itself.

**R7 (Low priority) — Consolidate the rank-to-number map**

Three copies of the rank lookup exist (`hand-evaluator.ts:32`, `board-analyzer.ts:155`,
`equity/card.ts:11`). Move it to `equity/card.ts` as the canonical source. Both
`hand-evaluator.ts` and `board-analyzer.ts` currently parse cards themselves rather than
importing from `equity/card.ts`. Unifying this eliminates one class of rank-format bugs.

---

## Passed / No Action Needed

- Pure function architecture throughout `lib/poker/` — no side effects, no globals mutated,
  fully testable. This is the correct design for real-money logic.
- Three-layer pipeline (GTO → exploit → execution) is the right architectural pattern.
  The exploit layer cannot produce an action the GTO layer has not seen.
- Test coverage for `exploit.ts` is thorough. All anti-pattern guards (AP-1 through AP-4)
  are tested with positive and negative cases.
- `FOLD → CHECK` safety override in `safeExecuteAction()` is correctly positioned and
  applies to both the local engine path and the Claude path.
- Cache invalidation on new-hand detection is correctly wired via `clearEvalCache()` and
  `clearBoardCache()` at `poker-content.ts:1169-1170`.
- The `executing` mutex is correctly set to `true` only inside the high-confidence branch
  (line 1261) before calling `safeExecuteAction()`, and the fallthrough to Claude at
  line 1277 correctly reaches `requestDecision()` only when `executing` is still false.
  The double-lock risk identified in the pre-implementation review (C2 in the plan review)
  was correctly resolved in the actual implementation.
- Hard overrides in `exploit.ts` use `return` immediately rather than falling through to
  the confidence-delta calculation (lines 117-165). This prevents double-application.
- `applyDirtyOutsDiscount()` correctly floors adjusted outs at 0 via `Math.max(0, ...)`.
- The `UNKNOWN` opponent type guard (line 107 in exploit.ts) correctly prevents noise
  adjustments on already-uncertain decisions.
