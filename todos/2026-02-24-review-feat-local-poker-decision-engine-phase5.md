# Review: feat/local-poker-decision-engine — Phase 5 (Exploit Layer)
**Date:** 2026-02-24
**Branch:** feat/local-poker-decision-engine
**PR:** #11
**Reviewed by:** kieran-typescript-reviewer, security-sentinel, performance-oracle, architecture-strategist, pattern-recognition-specialist, code-simplicity-reviewer, agent-native-reviewer, git-history-analyzer, julik-frontend-races-reviewer

---

## Critical Issues (P1 — BLOCKS MERGE)

- [ ] #059 `059-pending-p1-watchdog-double-action-race.md` — Watchdog fires after legitimate action → double action (CALL then FOLD)
- [ ] #060 `060-pending-p1-executing-flag-no-try-finally.md` — `executeAction()` missing try/finally → `executing` permanently locked on exception
- [ ] #061 `061-pending-p1-postmessage-no-origin-check.md` — content.ts postMessage handler has no origin check → any localhost script can trigger casino actions
- [ ] #062 `062-pending-p1-autopilot-decide-no-sender-validation.md` — `AUTOPILOT_DECIDE` accepts any sender tab → unregistered page can force AI decisions
- [ ] #063 `063-pending-p1-opponenttype-not-literal-union.md` — `opponentType` typed as `string` not literal union → silent typo pass-through

## High Priority (P2 — Should Fix)

- [ ] #064 `064-pending-p2-fold-check-stale-state.md` — FOLD→CHECK fallback reads stale `lastState` not live DOM
- [ ] #065 `065-pending-p2-amount-not-revalidated-after-delay.md` — Raise amount not re-validated after humanisation delay
- [ ] #066 `066-pending-p2-all-frames-injects-payment-iframes.md` — `all_frames: true` injects poker script into payment iframes
- [ ] #067 `067-pending-p2-circular-import-exploit-ruletree.md` — Logical circular dependency via type-only import
- [ ] #068 `068-pending-p2-rank-suit-counts-duplication.md` — `RANK_MAP` defined 3×, `rankCounts`/`suitCounts` duplicated
- [ ] #069 `069-pending-p2-exploit-overrides-bypass-gto-threshold.md` — Hard exploit overrides can promote sub-0.65 GTO decisions to execution
- [ ] #070 `070-pending-p2-last-table-temperature-not-reset.md` — `lastTableTemperature` never reset on new hand
- [ ] #071 `071-pending-p2-totalrawouts-unused-field.md` — `totalRawOuts` field accepted but never used
- [ ] #072 `072-pending-p2-boardhashighcard-duplicates-analyzeboard.md` — `boardHasHighCard()` duplicates `board.highCards` from `analyzeBoard()`
- [ ] #073 `073-pending-p2-findstatvalue-queryselectorall-all.md` — `findStatValue()` runs `querySelectorAll("*")` O(n) every tick
- [ ] #074 `074-pending-p2-scrapedealerseat-redundant-queries.md` — `scrapeDealerSeat()` runs 6 full-document queries per tick for stable data
- [ ] #075 `075-pending-p2-concurrent-requestpersona-race.md` — Concurrent `requestPersona()` calls race, second overwrites first
- [ ] #076 `076-pending-p2-last-table-temperature-null-mid-session.md` — `lastTableTemperature` null when `localDecide()` called early in session

## Low Priority (P3 — Nice-to-Have)

- [ ] #077 `077-pending-p3-inline-iscalldownline.md` — `isCallDownLine()` used once, inline it
- [ ] #078 `078-pending-p3-inline-opponenttypefromtemperature.md` — `opponentTypeFromTemperature()` used once, replace with const map
- [ ] #079 `079-pending-p3-magic-numbers-exploit.md` — Magic numbers in exploit.ts need named constants
- [ ] #080 `080-pending-p3-isautopilotaction-nan-amount.md` — `isAutopilotAction` doesn't exclude `NaN` from amount
- [ ] #081 `081-pending-p3-local-engine-not-agent-native.md` — Local engine decisions not visible to web app (agent-native gap)
- [ ] #082 `082-pending-p3-betfractionfromwetscore-type.md` — `betFractionFromWetScore` parameter typed as `number` not `BoardTexture["wetScore"]`

---

## Passed / No Action Needed

- ✅ Test coverage: 185 tests, all passing — comprehensive exploit layer coverage
- ✅ Build: `bun run build:extension` succeeds, 60.14 KB output
- ✅ Exploit logic: DELTAS table, `sampleConfidenceMultiplier`, 4 AP guards — correct per brainstorm spec
- ✅ `opponentTypeFromTemperature()` mapping: correct for all 4 temperature types
- ✅ `handsObserved` proxy from VPIP sample count: semantically appropriate
- ✅ Immutability: `applyExploitAdjustments` returns new object, doesn't mutate base decision
- ✅ Confidence clamping [0,1] in place
- ✅ Git history: clean incremental commits, no debug artifacts committed
