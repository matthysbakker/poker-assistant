---
status: pending
priority: p1
issue_id: "031"
tags: [code-review, correctness, real-money, autopilot, reliability]
dependencies: []
---

# `executing` Flag Locks Permanently When AUTOPILOT_ACTION Never Arrives

## Problem Statement

`executing = true` is set in `requestDecision()` and only reset when `executeAction()` completes a click. The reset depends on the full round-trip: background receiving the message → Claude API responding → `chrome.tabs.sendMessage` delivering `AUTOPILOT_ACTION` back. If any step silently fails (extension suspend, message port closed), the autopilot is permanently frozen for the rest of the hand. The plan specified "auto-fold if no response within 12 seconds" but this was not implemented.

## Findings

- `extension/src/poker-content.ts:523-527` — `executing = true` set, then message sent with no response callback
- `extension/src/poker-content.ts:669` — only reset: `executing = false` after `simulateClick(selector)`
- `extension/src/poker-content.ts:793-795` — partial rescue: `executing = false` reset on new hand start, but not within current hand
- `extension/src/background.ts:164-176` — `sendFallbackAction()` sends FOLD on API error, but NOT on silent message delivery failure
- `docs/plans/2026-02-19-feat-dom-autopilot-plan.md` — explicitly planned 12-second timeout, not implemented

## Proposed Solutions

### Option A: AbortController timeout in background + content-script watchdog (Recommended)
In `requestDecision()` (poker-content.ts), start a timeout based on the remaining timer:
```typescript
const timeout = Math.max(3000, (timerSeconds ?? 12) * 1000 - 3000);
const watchdog = setTimeout(() => {
  console.warn("[Poker] Decision timeout — auto-fold");
  executing = false;
  executeAction({ action: "FOLD", amount: null, reasoning: "timeout" });
}, timeout);
// Store watchdog, cancel in onDecisionReceived
```
In background.ts, add `AbortController` to `fetchAutopilotDecision` with matching timeout.
**Pros:** Exactly what the plan specified; handles all failure modes; cleans up gracefully
**Cons:** Slight complexity
**Effort:** Small
**Risk:** Low

### Option B: Reset `executing` in `requestDecision` response callback
In `chrome.runtime.sendMessage({ type: "AUTOPILOT_DECIDE" }, callback)`, reset `executing = false` on `chrome.runtime.lastError`.
**Pros:** Handles delivery failure
**Cons:** Doesn't handle Claude API timeouts
**Effort:** Very small
**Risk:** None, but incomplete

### Option C: Status quo
Accept that a network hiccup freezes the bot for the rest of the hand.
**Pros:** None
**Cons:** Bot becomes unresponsive; real money may time out
**Risk:** High

## Recommended Action

Option A. The 12-second timeout was already planned and just needs implementation.

## Technical Details

- **File:** `extension/src/poker-content.ts:520-534, 669`
- **Related:** `extension/src/background.ts:131-162` (fetch function)
- `timerSeconds` is available in `scrapeTimer()` output

## Acceptance Criteria

- [ ] After requesting a decision, a timeout fires if AUTOPILOT_ACTION not received
- [ ] Timeout duration: `max(3000, timerSeconds * 1000 - 3000)` (leave 3s buffer)
- [ ] Timeout triggers auto-fold/check with logged reason
- [ ] `executing` is always reset whether action succeeds, times out, or errors
- [ ] Watchdog is cleared when `onDecisionReceived` fires normally

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by architecture-strategist (C2), performance-oracle (C2), pattern-recognition-specialist. Plan already specified this feature — just needs implementation.
