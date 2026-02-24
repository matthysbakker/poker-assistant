---
status: pending
priority: p2
issue_id: "075"
tags: [code-review, race-condition, persona, poker-content]
dependencies: []
---

# Two Concurrent `requestPersona()` Calls Race — Second Overwrites First

## Problem Statement

`requestPersona()` is an async function with no guard against concurrent invocations. If it is called twice in quick succession (e.g., from two detection frames firing close together while `heroTurn` transitions), two concurrent requests race: the first may fetch persona A, the second fetches persona B, and whichever resolves last wins — overwriting the first result regardless of which request started first.

## Findings

- `requestPersona()` is async and has no mutex/in-flight guard
- Called from the detection loop when `heroTurn` flips true
- Two consecutive frames can both trigger this (hysteresis is 2 frames but concurrent timers can still fire)
- Second API call result overwrites `lastTableTemperature` and persona state regardless of ordering
- Similar pattern to `detectingRef` mutex used for `/api/detect` — that was the lesson learned from continuous capture (see MEMORY.md gotcha #14)
- Review agent: julik-frontend-races-reviewer (RACE-3)

## Proposed Solutions

### Option 1: Add `requestingPersonaRef` Mutex (Recommended)

**Approach:** Add a `useRef` (or module-level boolean) guard, same pattern as `detectingRef`.

```typescript
let requestingPersona = false;

async function requestPersona(): Promise<void> {
  if (requestingPersona) return;
  requestingPersona = true;
  try {
    // … async work
  } finally {
    requestingPersona = false;
  }
}
```

**Pros:**
- Consistent with existing `detectingRef` pattern in the codebase
- Simple and correct

**Cons:**
- First request wins; any update from second request is dropped. Acceptable since persona is stable per hand.

**Effort:** 30 minutes
**Risk:** Low

---

### Option 2: Debounce with Cancellation

**Approach:** Cancel any in-flight persona request when a new one is triggered. Last request wins.

**Pros:** Always uses most recent context

**Cons:** More complex; an AbortController is needed for the fetch

**Effort:** 1–2 hours
**Risk:** Low

## Technical Details

**Affected files:**
- `extension/src/poker-content.ts` — `requestPersona()` function

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** julik-frontend-races-reviewer (RACE-3)
- **Similar pattern:** `detectingRef` mutex (MEMORY.md)

## Acceptance Criteria

- [ ] Concurrent `requestPersona()` calls do not race
- [ ] Second call within same hand is silently dropped
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
