---
status: pending
priority: p2
issue_id: "102"
tags: [code-review, race-condition, preflop, timing]
dependencies: ["101"]
---

# preflopFastPathFired Set Too Late — Race Window With Fast Pre-fetch Response

## Problem Statement

`preflopFastPathFired` is set to `true` on the fast-path in `processGameState`. But if the pre-fetch response arrives before the fast-path fires (e.g. local network, warm Claude), `onDecisionReceived` runs with the flag still `false`. The guard passes, Claude acts. Then the fast-path fires and acts again. The fix from todo-101 (removing the monitor condition) helps but does not close this window: the ordering race between pre-fetch arrival and fast-path execution still exists.

## Findings

- `extension/src/poker-content.ts:1325` — pre-fetch fires with `executing = false`
- `extension/src/poker-content.ts:1384` — `preflopFastPathFired = true` set only when fast-path runs
- Race: pre-fetch arrives → flag is still false → guard passes → Claude acts → fast-path runs → acts again
- Most likely on fast API responses (< 500ms) or when the hand-start and hero-turn happen in the same tick

## Proposed Solutions

### Option A: Set flag at pre-fetch dispatch time (not fast-path execution time)
Set `preflopFastPathFired = true` at the same time as `requestDecision()` in the new-hand block, not when the fast-path executes. This means: "a preflop decision will come from the fast-path chart — discard any pre-fetch response":
```typescript
// In the new-hand block, alongside requestDecision():
if (autopilotMode === "monitor" && state.heroCards.length === 2) {
  preflopFastPathFired = true; // pre-fetch is auxiliary; fast-path takes priority
  requestDecision([...handMessages]);
}
```
**Pros:** Closes the race entirely — flag is set before the response can arrive
**Cons:** Slightly misleading name (flag says "fast-path fired" but it's set pre-emptively). Could rename to `preflopFastPathTakesPriority`.

### Option B: Generation counter
Each hand gets a generation ID (`handGeneration++`). `requestDecision()` is called with the current generation. `onDecisionReceived()` checks if the response generation matches the current one.
**Pros:** Robust against all orderings
**Cons:** More invasive — requires threading the ID through the API call

### Option C: Accept the narrow race for now
In practice, API responses rarely arrive in < 200ms. The window is narrow and observable only under local/mocked conditions. Document it and ship Option A as a follow-up.

## Recommended Action

Option A — simple one-line move. Rename `preflopFastPathFired` → `preflopFastPathTakesPriority` for accuracy.

## Technical Details

- File: `extension/src/poker-content.ts`
- Lines: ~1325 (pre-fetch dispatch), ~1384 (flag set)
- Related: `requestDecision()`, `onDecisionReceived()`, todo-101

## Acceptance Criteria

- [ ] Pre-fetch response discarded even when it arrives before the fast-path tick
- [ ] Fast-path still executes correctly when pre-fetch never arrives
- [ ] No timing-dependent double-action in either mode

## Work Log

- 2026-02-24: Found during code review. Flagged by pattern-recognition-specialist as a narrower but real race.
