---
status: pending
priority: p2
issue_id: "036"
tags: [code-review, correctness, autopilot, dom]
dependencies: []
---

# nth-child Selector Resolved Before Delay, Executed After — Wrong Button Clicked Silently

## Problem Statement

`findActionButton()` computes a positional `:nth-child(N)` CSS selector at call time. `executeAction()` then waits up to 8 seconds (humanization delay) before re-querying the DOM with that selector. If the poker client modifies the actions area DOM during the delay (timer animation, opponent action, brief state change), `nth-child(N)` resolves to a different element. The `simulateClick` return value is discarded after the delay, so a wrong-target click is silent.

## Findings

- `extension/src/poker-content.ts:604-618` — `findActionButton` returns `.actions-area .base-button:nth-child(${i + 1})` positional string
- `extension/src/poker-content.ts:651-668` — `await humanDelay(minDelay, maxDelay)` (1500ms–8000ms) fires before `simulateClick(selector)`
- `extension/src/poker-content.ts:668` — `simulateClick(selector)` return value discarded: `false` = element not found, no retry
- Architecture review (2026-02-23, C3): "If Playtech re-renders the actions area during that window, nth-child(N) resolves to the wrong element"
- Pattern review (2026-02-23): "positional index may refer to different button"

## Proposed Solutions

### Option A: Return Element reference directly, pass to simulateClick (Recommended)
Change `findActionButton` to return the `Element` reference instead of a selector string. Change `simulateClick` to accept an `Element | string`:
```typescript
function findActionButton(actionType: string): Element | null {
  const buttons = document.querySelector(".actions-area")?.querySelectorAll(".base-button");
  for (const btn of buttons ?? []) {
    if (btn.textContent?.trim().toLowerCase().startsWith(actionType.toLowerCase())) return btn;
  }
  return null;
}

function simulateClick(target: Element) {
  const rect = target.getBoundingClientRect();
  // ...dispatch events...
}
```
**Pros:** Element reference remains valid (or detectably detached) through the delay; no positional ambiguity
**Cons:** Minor refactor across both functions
**Effort:** Small
**Risk:** Low

### Option B: Re-query at click time
Store the matched `textContent` or a data attribute as the selector key, then re-query immediately before clicking (after the delay) to find the still-matching button.
**Pros:** Simple; same robustness
**Cons:** Still O(N) scan at click time; slightly less clean than holding a reference
**Effort:** Small
**Risk:** Low

### Option C: Check selector validity after delay
After the delay, confirm the selector still resolves to the expected element (check `textContent` matches expected action type) before clicking.
**Pros:** Safeguard without refactoring `findActionButton`
**Cons:** Doesn't fix the root cause; adds a conditional
**Effort:** Very small
**Risk:** None

## Recommended Action

Option A. Passing an `Element` reference is the correct pattern and removes the category of bug entirely.

## Technical Details

- **File:** `extension/src/poker-content.ts:594-618, 651-668`

## Acceptance Criteria

- [ ] No positional CSS selector strings used for clicking action buttons
- [ ] Button reference captured before delay, validated/re-captured after delay
- [ ] Wrong-target click is detectable (log or fallback if reference is detached)

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by architecture-strategist (C3), pattern-recognition-specialist, performance-oracle.
