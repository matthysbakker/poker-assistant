# Architecture Review: Local Poker Decision Engine Plan
**Date:** 2026-02-24
**Reviewed by:** Claude Architecture Analysis

---

## Architecture Overview

The system is a Firefox MV2 browser extension with three scripts:
- `background.ts` — message router + Claude API caller
- `poker-content.ts` — DOM scraper + autopilot loop (1,185 lines)
- `content.ts` — screenshot bridge to the Next.js web app

The proposed plan adds a fourth execution path into the already-dense `poker-content.ts`:
a local rule engine that competes with the existing Claude Haiku path for control of
real-money DOM actions.

---

## Critical Issues

- [ ] **C1: No FOLD-safety on local path** — `safeExecuteAction()` is proposed but the plan
  places it as Phase 0 and the integration snippet in Phase 4 refers to it correctly.
  However, the plan at no point makes it explicit that `onDecisionReceived()` must ALSO
  route through `safeExecuteAction()` instead of `executeAction()` — the existing Claude
  callback path is not refactored in the plan. Until both paths share the same wrapper,
  adding a new path adds a new unsafe lane alongside the old unsafe lane.
  **File:** `extension/src/poker-content.ts` lines 848-895 (`onDecisionReceived`)

- [ ] **C2: `executing` flag lifecycle — double-lock risk** — The plan sets `executing = true`
  before `safeExecuteAction()` on the local path. But it also intends to fall through to
  `requestDecision()` on low-confidence. `requestDecision()` at line 676 already checks
  `if (executing) return` — meaning if the local engine sets the flag and then falls through,
  `requestDecision()` silently no-ops. The plan's integration snippet (Phase 4) contains
  `executing = true` INSIDE the high-confidence branch only, but the prose description is
  ambiguous. One mis-placed line destroys the fallthrough path.
  **File:** `extension/src/poker-content.ts` lines 669-708

- [ ] **C3: Watchdog gap on local path** — The watchdog (`decisionWatchdog`) is set inside
  `requestDecision()`. Local executions bypass it entirely. A hang inside `evaluateHand()`
  or a silent exception in `applyRuleTree()` leaves the session in an un-recoverable state
  with `executing = true`. Since the local path is supposed to be sub-1ms this is unlikely
  but the safety net is absent.

- [ ] **C4: `safeExecuteAction()` scope creep** — The plan assigns three responsibilities to
  this wrapper: FOLD-safety, monitor-mode intercept, and pre-action checkbox clearing.
  Currently those three behaviours live in `onDecisionReceived()` and `executeAction()`
  as interleaved state mutations. Extracting them into one wrapper without also cleaning
  up the now-duplicated logic in the caller sites is a copy-paste trap. The plan does not
  specify that the original sites must be cleaned up.

- [ ] **C5: Confidence threshold is arbitrary and untestable** — The decision table assigns
  scores (0.90, 0.85, 0.75, 0.65) without a derivation or calibration mechanism. The
  plan acknowledges "Phase 4: tuning" but provides no test harness for confidence accuracy.
  A confidence of 0.75 is either above or below the 0.60 threshold, but whether 0.75 is
  the correct score for "top_pair_gk in position" on a wet board cannot be verified
  without historical hand data. The threshold is effectively a magic number.

---

## High Priority

- [ ] **H1: 9 HandTiers is the right count but the boundaries are under-specified**
  The boundary between `top_pair_gk` and `medium` is "kicker > 9 OR kicker > top-pair
  rank - 3". This works correctly for A-high boards but is ambiguous on boards where top
  pair is a 9 — kicker > 9 means only top pair with a ten counts as TPTK, but "top-pair
  rank - 3 = 6" means a 7-kicker also qualifies. The two sub-conditions overlap in a way
  that produces inconsistent tiers depending on which check is evaluated first.
  Concrete case: 9-high board, hero has 9-8. Kicker (8) > 9? No. Kicker (8) > 9-3=6? Yes.
  So 9-8 is classified as `top_pair_gk`. But 9-8 is not a strong TPTK hand.

- [ ] **H2: Board connectivity definition is fragile** — `connected: largest gap between
  any two ranks ≤ 2`. On a board of A-3-7, the gaps are A-3 (gap=10), 3-7 (gap=4) and
  A-7 (gap=6). The largest gap is 10, so the board is not connected — correct. But on a
  board of A-2-3, the gaps with A-as-low are 1 each, so it appears connected — but this is
  an extremely unusual wrap scenario that changes the draw landscape completely (OESD to
  A-2-3 is 2-3-4-5 straight, not the intuitive A-2-3-4). The plan does not specify whether
  A is treated as 1 only for this calculation or for all calculations, which propagates into
  `hasStraight()` in the evaluator.

- [ ] **H3: Preflop chart wiring is not truly zero-latency** — Phase 1 is described as
  "eliminate preflop API calls" but `requestPersona()` is still a network call to
  `localhost:3006`. The persona is fetched and stored, then the chart is read locally.
  If the server is not running, the persona is never set and the local path falls to Claude
  anyway. The architectural win is real (no second fetch), but the claim "zero network"
  is only true for the chart lookup, not the persona resolution step.

- [ ] **H4: `localDecide()` in `poker-content.ts` violates file growth limits** — The file is
  already 1,185 lines. Adding `localDecide()`, `computeSPR()`, `computePotOdds()`,
  `computeFacingBetFraction()`, `applyRuleTree()`, and `HandTier`/`BoardTexture` inline
  brings it to ~1,400-1,500 lines. The brainstorm acknowledges "refactor to
  `lib/poker/local-engine.ts` if the web app also benefits" but treats it as optional.
  Given that `hand-evaluator.ts` and `board-analyzer.ts` are placed in `lib/poker/`
  (shared lib) while the rule tree is embedded in the extension script, the abstraction
  boundary is inconsistent from day one.

- [ ] **H5: `BTN/SB` composite position is a silent FOLD** — In 2-player tables, `getPosition()`
  returns `"BTN/SB"`. `ChartPosition` does not include this value. The current flow routes
  this through the persona API which handles it server-side. If the local engine ever
  reads `lastPersonaRec.action` for heads-up tables and that recommendation was derived
  from a malformed chart lookup (undefined → "FOLD"), every hand in heads-up play folds.
  This edge case is documented in the flow analysis but is not addressed in the plan's
  implementation checklist.

---

## Low Priority / Nice-to-Have

- [ ] **L1: Confidence threshold configurability** — The plan hardcodes 0.60. Given Phase 4
  is explicitly about tuning this value, making it readable from `chrome.storage.local` at
  startup would enable runtime tuning without extension reinstall.

- [ ] **L2: AI fallback enrichment** — When the local engine falls to Claude, it has already
  computed `HandTier`, `BoardTexture`, and `SPR`. These could be prepended to the Claude
  prompt to improve response accuracy and reduce tokens. The plan does not leverage this.

- [ ] **L3: Rule evaluation order is unspecified** — The decision table has 14 entries.
  When multiple rules match (nut hand on a paired board facing a check-raise), the plan
  does not specify first-match vs. best-confidence semantics. First-match is fragile
  because rule insertion order becomes load-bearing.

- [ ] **L4: Bluff frequency imbalance** — The rule tree has no bluffing rules except
  "strong_draw in position → semi-bluff". A purely deterministic engine that never bluffs
  on the river is exploitable by any observant opponent over a session. For micro-stakes
  this is acceptable, but the plan should document this as an intentional limitation.

- [ ] **L5: No test surface for `localDecide()` itself** — Tests are planned for
  `hand-evaluator.ts` and `board-analyzer.ts`, but `localDecide()` and `applyRuleTree()`
  are embedded in the extension content script and therefore untestable with `bun test`
  without a DOM environment. Extracting the rule tree to `lib/poker/rule-tree.ts` would
  make it testable independently.

---

## Passed / No Action Needed

- The plan correctly identifies the RFI-only guard (Q2) and specifies the `facingRaise`
  check before using the chart. This is the most critical correctness gate for Phase 1.

- The `safeExecuteAction()` concept is the right pattern. Centralising the FOLD-safety,
  monitor intercept, and checkbox clearing in one wrapper is architecturally sound.

- `HandTier` as a 9-tier enum is the right granularity for micro-stakes. Coarser (5 tiers)
  would collapse draws into a single bucket losing positional nuance. Finer (15+ tiers)
  would require hand-range data to calibrate confidence scores that do not exist.

- Placing `hand-evaluator.ts` and `board-analyzer.ts` in `lib/poker/` (not inline in the
  extension script) is the correct separation: pure functions, independently testable,
  bundled into the extension by Bun.

- The confidence threshold approach (vs. always-local or always-AI) is architecturally
  sound for this use case. It creates a natural seam where ambiguous spots are handled by
  a stronger model without requiring a full solver infrastructure.

- The plan's identified gaps (Q1-Q7 from the flow analysis) are addressed in the
  implementation checklists in a way that is detailed enough to implement.

- The pre-existing `FOLD → CHECK` override in `onDecisionReceived()` demonstrates that
  the codebase already has awareness of the real-money risk surface. The plan preserves
  this pattern rather than replacing it.

---

## Risk Summary

| Risk | Severity | Phase |
|------|----------|-------|
| Executing flag double-lock (C2) | Critical | 0/4 |
| FOLD-safety not on both paths (C1/C4) | Critical | 0 |
| No watchdog on local path (C3) | High | 4 |
| `BTN/SB` silent FOLD heads-up (H5) | High | 1 |
| Top-pair kicker boundary ambiguity (H1) | Medium | 2 |
| `poker-content.ts` file growth (H4) | Medium | 4 |
| Confidence scores uncalibrated (C5) | Medium | 4 |
| Rule evaluation order unspecified (L3) | Medium | 4 |
