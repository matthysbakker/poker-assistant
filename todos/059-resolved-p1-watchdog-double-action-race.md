---
status: pending
priority: p1
issue_id: "059"
tags: [code-review, race-condition, autopilot, javascript]
dependencies: []
---

# Watchdog Fires After Legitimate Action — Double Action Bug

## Problem Statement

In `poker-content.ts`, the `executing` flag is used as a mutex to prevent double actions. However, the watchdog `setTimeout` callback can fire after a legitimate action has already been executed, triggering a second FOLD action even though the original action succeeded.

## Findings

- `executeAction()` sets `executing = true`, fires `setTimeout(watchdog, 15_000)`, then asynchronously clicks DOM elements
- If the action completes normally (e.g., CALL button clicked), `executing` is reset to `false`
- The already-scheduled watchdog `clearTimeout()` may not have been called if execution succeeded via a different code path
- Watchdog fires and calls `sendFallbackAction("timeout")` → FOLD sent to poker tab AFTER real action already executed
- Result: two actions sent to the casino table (e.g., CALL then FOLD)
- Location: `extension/src/poker-content.ts` in `executeAction()` / watchdog setup

## Proposed Solutions

### Option 1: Cancellation Token (Recommended)

**Approach:** Replace the single `clearTimeout` call with a shared cancellation object. Every watchdog checks a `cancelled` flag set before it fires.

```typescript
const token = { cancelled: false };
const watchdogId = setTimeout(() => {
  if (token.cancelled) return;
  // … fallback
}, 15_000);

// Normal completion:
token.cancelled = true;
clearTimeout(watchdogId);
executing = false;
```

**Pros:**
- Safe even if `clearTimeout` races with `setTimeout` callback scheduling
- Easy to audit — `cancelled` flag is explicit

**Cons:**
- Minor boilerplate per `executeAction` call

**Effort:** 1 hour
**Risk:** Low

---

### Option 2: Increment/Check Generation Counter

**Approach:** Increment a `generation` counter on each `executeAction` call; watchdog captures start generation and no-ops if current generation has advanced.

**Pros:** Same safety properties, no extra object allocation

**Cons:** Slightly less readable

**Effort:** 1 hour
**Risk:** Low

## Technical Details

**Affected files:**
- `extension/src/poker-content.ts` — `executeAction()`, watchdog closure

**Related components:**
- `autopilotMode` state machine
- `AUTOPILOT_ACTION` message handler

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** julik-frontend-races-reviewer (RACE-2)

## Acceptance Criteria

- [ ] Watchdog never fires after normal action completion
- [ ] Watchdog still fires after genuine 15s timeout
- [ ] No duplicate actions visible in background console logs
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)

**Actions:**
- Identified race condition in watchdog/executeAction pair
- Drafted cancellation token fix
