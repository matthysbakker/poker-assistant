---
status: pending
priority: p3
issue_id: "047"
tags: [code-review, cleanup, simplicity, autopilot]
dependencies: []
---

# Dead Code Cleanup: `isPreAction`, Duplicate `handId` Check, `waitForTable` Wrapper

## Problem Statement

Three pieces of dead/duplicate code accumulated during development:
1. `isPreAction` variable computed but never used
2. Duplicate `handId` check block (same condition evaluated twice in sequence)
3. `waitForTable` wrapper function is redundant — `startObserving` already retries on missing table

## Findings

- `extension/src/poker-content.ts:333` — `const isPreAction = btn.classList.contains("pre-action")` — never read
- `extension/src/poker-content.ts:785-788` — `if (state.handId && state.handId !== currentHandId) { console.log(...) }` — identical condition at line 791 does the actual state update
- `extension/src/poker-content.ts:880-889` — `waitForTable()` polls every 1s; `startObserving()` at line 855-858 already retries every 2s when `.table-area` is absent — two retry paths at different intervals

## Proposed Solutions

### Option A: Remove all three dead items (Recommended)
1. Delete `const isPreAction = ...` (line 333)
2. Merge the two `handId` blocks:
```typescript
if (state.handId && state.handId !== currentHandId) {
  console.log("[Poker] New hand:", state.handId);
  currentHandId = state.handId;
  handMessages = [];
  executing = false;
  lastHeroTurn = false;
  if (state.heroCards.length > 0) {
    handMessages.push({ role: "user", content: buildHandStartMessage(state) });
  }
}
```
3. Replace `waitForTable()` call at line 889 with `startObserving()` directly; delete the function
**Effort:** ~10 minutes
**Risk:** None

## Acceptance Criteria

- [ ] `isPreAction` variable removed from `scrapeAvailableActions`
- [ ] Duplicate handId check collapsed into single block
- [ ] `waitForTable` function deleted; entry point is `startObserving()`
- [ ] No behavioral change — all logic preserved

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by simplicity-reviewer, pattern-recognition-specialist.
