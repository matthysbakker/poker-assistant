# Review: preflop fast-path + scraping fixes (b24f0a9..b81eda6)
**Date:** 2026-02-24
**Commits:** b24f0a9, 448cbc2, b81eda6
**Files changed:** `extension/src/poker-content.ts` (+49/-17)
**Reviewed by:** kieran-typescript-reviewer, security-sentinel, pattern-recognition-specialist, code-simplicity-reviewer

---

## Critical Issues (P1 — BLOCKS PLAY MODE)

- [ ] **100** `pot / 1.5` BB derivation wrong on limped pots — over-raises 30–70% → `100-pending-p1-preflop-raise-sizing-wrong-on-limped-pots.md`
- [ ] **101** Stale pre-fetch guard is monitor-only — play mode has identical double-action race → `101-pending-p1-stale-prefetch-guard-monitor-only.md`

## Important (P2)

- [ ] **102** `preflopFastPathFired` set too late — narrow race where pre-fetch arrives before fast-path tick → `102-pending-p2-preflop-fastpath-flag-set-too-late.md`
- [ ] **103** Bet input absent on fast-path timing → silent abort → watchdog FOLDs strong hands → `103-pending-p2-bet-input-absent-aborts-raise-watchdog-folds.md`

## Nice-to-Have (P3)

- [ ] **104** `bbTag` double-`parseCurrency` + nullable `preflopAmount` + `SUIT_NAMES` inline allocation → `104-pending-p3-bbTag-simplification-and-SUIT_NAMES-hoist.md`

---

## Passed / No Action Needed

- **Leaf-span join** (`scrapeAvailableActions`): Correct fix. Properly handles split labels like "Raise To €1.25".
- **Adjacent dedup** `["Fold","Fold"] → ["Fold"]`: Correct for documented Playtech aria duplication.
- **`/` filter** for pre-action toggles: Still applied correctly after the join.
- **`preflopFastPathFired` reset** on hand reset: Correctly positioned before new-hand logic.
- **Suit description**: Functionally correct; full suit names improve Claude's understanding.
- **`state.heroCards.length === 2` guard** on pre-fetch: Good defensive addition.
- **`executing = true` before fast-path fires**: Mutex acquired before `safeExecuteAction` — correct.
- **Raise multipliers** (2.5× BTN/CO, 3.0× elsewhere): Standard GTO sizes — correct values, wrong base (issue 100).
- **`Math.round(... * 100) / 100`**: Correct euro rounding.
- **`"BTN/SB" → "BTN"` normalisation**: Handles HU edge case correctly.

---

## Pre-existing Issue Surfaced

The `PERSONA_RECOMMENDATION` handler initialises `lastPersonaRec` without `rotated`/`allPersonas` fields. TypeScript should flag this — confirm the compiler catches it. Low urgency but confirm types align.
