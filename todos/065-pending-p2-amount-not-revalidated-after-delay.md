---
status: pending
priority: p2
issue_id: "065"
tags: [code-review, security, autopilot, timing]
dependencies: []
---

# Raise/Bet Amount Not Re-Validated After Humanisation Delay

## Problem Statement

`executeAction()` applies a humanisation delay (random ms) before clicking the raise/bet button. The `action.amount` is validated before the delay but the bet size input is not re-read or re-validated after the delay. During the delay, the pot or blinds could change (e.g., on a new street), making the original amount stale or outside the allowed range.

## Findings

- Humanisation delay is a `setTimeout` / `await sleep()` of several hundred ms
- After the delay, `executeAction()` directly writes `action.amount` to the input field
- No check that the input field still accepts the same range, or that `facingBet` is still what it was
- If min-bet increased during the delay, entering an amount below the new minimum could cause the casino UI to reject the action silently
- Location: `extension/src/poker-content.ts` — raise/bet path in `executeAction()`

## Proposed Solutions

### Option 1: Re-read Input Constraints After Delay (Recommended)

**Approach:** After the delay, read `input.min` and `input.max` from the raise input element and clamp `action.amount` to `[min, max]` before setting value.

```typescript
await sleep(humanDelay);
const input = document.querySelector<HTMLInputElement>(RAISE_INPUT_SELECTOR);
if (!input) return sendFallback("raise input gone");
const min = parseFloat(input.min) || 0;
const max = parseFloat(input.max) || Infinity;
const safeAmount = Math.max(min, Math.min(max, action.amount));
input.value = String(safeAmount);
```

**Pros:**
- Ensures submitted amount is always within current allowed range
- No extra API calls

**Cons:**
- Slightly changes the exact amount (clamping vs original intent)

**Effort:** 1 hour
**Risk:** Low

---

### Option 2: Abort and Retry on Stale State

**Approach:** After the delay, check `facingBet` against live DOM; if changed, abort this action and re-trigger decision logic.

**Pros:** Avoids acting on fundamentally stale context

**Cons:** More complex; could loop if state keeps changing

**Effort:** 3 hours
**Risk:** Medium

## Technical Details

**Affected files:**
- `extension/src/poker-content.ts` — `executeAction()`, raise/bet branch

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** security-sentinel (M-1)

## Acceptance Criteria

- [ ] Amount is clamped to live input min/max after humanisation delay
- [ ] If raise input is absent after delay, fallback is sent
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
