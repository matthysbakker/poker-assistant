---
title: "FOLD overridden to CHECK when pre-action toggle is active alongside real CALL button"
date: 2026-02-24
module: poker-assistant
problem_type: logic_error
component: browser_extension
symptoms:
  - "Assistant folds instead of calling when CALL option is available"
  - "Pre-action 'Check' toggle triggers FOLD-to-CHECK override incorrectly"
  - "Hero folds a hand that should have been called"
root_cause: "FOLD-to-CHECK override guarded only by findActionButton('CHECK') !== null, but Playtech shows the pre-action Check toggle as a CHECK button even when a real CALL button is simultaneously visible — the guard must also require CALL to be absent"
severity: high
tags: [fold, check, call, pre-action-toggle, action-execution, false-positive, safeExecuteAction, overlay, playtech]
---

# FOLD overridden to CHECK when pre-action toggle is active alongside real CALL button

## Problem Statement

The poker-content script has a safety rule: if the local engine returns FOLD but a
free CHECK is available, override FOLD → CHECK (since folding when you can check for
free is always a mistake).

However, Playtech's UI has a "pre-action Check" toggle button — visible in the action
area even when there is a pending bet to call. This button **looks like** a CHECK
button in the DOM but represents "check if nobody bets between now and hero's turn".

The original guard:
```typescript
if (action.action === "FOLD" && findActionButton("CHECK") !== null) {
  // override to CHECK  ← fires falsely when CALL is also present
}
```

fires whenever the pre-action Check toggle is selected, even if a real CALL button
is also in the DOM. Result: the assistant incorrectly checks (or shows CHECK in the
overlay) instead of calling or folding.

## Root Cause

Playtech renders both the pre-action Check toggle and the real CALL button in the
same `.actions-area` simultaneously. `findActionButton("CHECK")` matches the
pre-action toggle's label text.

The semantic distinction: a "truly free check" is one where **no CALL option exists**
in the action area.

## Solution

Add `&& findActionButton("CALL") === null` to both places where the override is
applied:

### `safeExecuteAction()` — execution path

```typescript
// Safety: never fold when checking is free — query live DOM, not stale lastState.
// Only override when CHECK is available AND CALL is NOT.
// If both appear, the Playtech pre-action "Check" toggle is selected alongside a
// real CALL button — folding is a valid option there.
let finalAction = action;
if (
  action.action === "FOLD" &&
  findActionButton("CHECK") !== null &&
  findActionButton("CALL") === null      // ← key fix
) {
  console.warn("[Poker] Overriding FOLD → CHECK (check is truly free — no call available)");
  finalAction = { ...action, action: "CHECK", amount: null };
}
```

### `updateOverlay()` — display path

```typescript
// CHECK is truly free only when CHECK is available AND CALL is not.
const checkFree = state.availableActions.some(a => a.type === "CHECK") &&
                  !state.availableActions.some(a => a.type === "CALL");  // ← key fix

// Used downstream: p.action === "FOLD" && checkFree ? "CHECK" : p.action
```

## Playtech-Specific Gotcha

Playtech's pre-action toggles appear as regular buttons in `.actions-area` and have
the same label text as the real action buttons. The only reliable way to distinguish
"free check available" from "pre-action check toggle with real CALL pending" is to
check whether a CALL button is simultaneously present.

## Prevention

- Whenever reading action buttons from Playtech DOM, remember that pre-action toggles
  coexist with real action buttons and share label text.
- "Free check" semantics = CHECK present AND CALL absent.
- The same principle applies to any "action override" logic: always check that the
  override doesn't silently fire in the presence of a conflicting option.
