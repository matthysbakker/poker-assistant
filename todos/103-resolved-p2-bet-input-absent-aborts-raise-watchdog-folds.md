---
status: pending
priority: p2
issue_id: "103"
tags: [code-review, correctness, timing, raise, dom-animation, play-mode]
dependencies: []
---

# Bet Input Absent on Fast-Path Timing — Silent Abort Causes Watchdog FOLD

## Problem Statement

The fast-path fires on the rising edge of hero's turn (detected via MutationObserver, debounced 200ms). Playtech animates action buttons into view. If `executeAction()` runs before the animation completes, `document.querySelector(".betInput")` returns `null`. The current code aborts with a warn and returns — `executing` clears — then the watchdog timer fires a FOLD when no action is taken before the timeout.

Result: hero folds strong preflop opening hands when the DOM is slow.

## Findings

- `extension/src/poker-content.ts` — `executeAction()`, the `!betInput` branch: `console.warn("[Poker] Bet input gone after delay — aborting raise"); return;`
- Fast-path fires ~200ms after hero-turn detection
- Playtech button animation is typically 150–300ms
- Race is timing-dependent and intermittent — hard to reproduce consistently
- Flagged by security-sentinel

## Proposed Solutions

### Option A: Retry loop with exponential backoff (Recommended)
```typescript
if (!betInput) {
  if (retryCount < 3) {
    console.log(`[Poker] Bet input not ready, retrying in 100ms (attempt ${retryCount + 1}/3)`);
    setTimeout(() => executeAction(decision, source, retryCount + 1), 100);
    return;
  }
  console.warn("[Poker] Bet input absent after 3 retries — aborting raise");
  executing = false;
  return;
}
```
Add `retryCount = 0` parameter to `executeAction`. Max 3 retries covers 300ms animation window.
**Pros:** Handles the animation race without blocking the event loop
**Cons:** Adds parameter to `executeAction`; `executing` stays `true` during retry window (correct — prevents double-fire)

### Option B: MutationObserver on betInput appearance
Instead of polling, watch for the bet input element to appear and then act.
**Pros:** Event-driven, no busy-wait
**Cons:** More complex setup/teardown

### Option C: Delay the fast-path by 300ms
Add a `setTimeout(300)` before `safeExecuteAction` in the fast-path.
**Pros:** Trivial
**Cons:** Adds 300ms latency to every preflop action even when buttons are ready

## Recommended Action

Option A. The retry loop is a minimal, targeted fix.

## Technical Details

- File: `extension/src/poker-content.ts`
- Function: `executeAction()`
- Related: `watchdogTimer`, `executing` flag, `safeExecuteAction`

## Acceptance Criteria

- [ ] Raise actions succeed even when bet input renders 100–300ms after hero-turn detection
- [ ] After 3 failed retries the action is properly aborted (not silently dropped)
- [ ] `executing` flag is correctly cleared on both success and final failure

## Work Log

- 2026-02-24: Found during security review. Pre-existing code path exposed by the fast-path now triggering sooner than before.
