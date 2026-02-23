---
status: pending
priority: p2
issue_id: "042"
tags: [code-review, performance, memory-leak, autopilot, mutation-observer]
dependencies: []
---

# MutationObserver Not Stored — Cannot Disconnect; `observerActive` Never Reset

## Problem Statement

The `MutationObserver` instance is a local variable inside `startObserving()` with no module-level reference. It can never be disconnected. If `.table-area` is removed (SPA navigation, seat change, session timeout), the observer fires against a detached subtree. `observerActive = true` is never reset to `false`, so `startObserving()` returns immediately and never creates a valid replacement observer.

## Findings

- `extension/src/poker-content.ts:861-869` — `const observer = new MutationObserver(onDomChange)` is local; `observerActive = true` never reset
- `extension/src/poker-content.ts:738` — `let observerActive = false` — only ever set to `true`
- Performance review (2026-02-23, C2): "If `.table-area` is removed from the DOM, the observer continues to fire against a detached subtree. `observerActive` stays `true` permanently, so `startObserving()` will never re-create a valid observer."
- Pattern review (2026-02-23): "SPA remount causes silently dead observer"

## Proposed Solutions

### Option A: Store observer in module scope, add disconnect path (Recommended)
```typescript
let activeObserver: MutationObserver | null = null;

function startObserving() {
  if (activeObserver) {
    activeObserver.disconnect();
    activeObserver = null;
    observerActive = false;
  }
  const tableArea = document.querySelector(".table-area");
  if (!tableArea) {
    sendDebugLog({ type: "no_table", url: window.location.href });
    setTimeout(startObserving, 2000);
    return;
  }
  activeObserver = new MutationObserver(onDomChange);
  activeObserver.observe(tableArea, { subtree: true, childList: true, attributes: true });
  observerActive = true;
  processGameState();
}
```
Also use a `MutationObserver` on `document.body` to detect `.table-area` removal and call `startObserving()` when it disappears.
**Pros:** Handles SPA navigation; can reconnect; no memory leak
**Cons:** Slightly more code
**Effort:** Small
**Risk:** Low

### Option B: Observe `document.body` instead of `.table-area`
Observe a stable ancestor that never gets unmounted.
**Pros:** Never needs reconnection
**Cons:** Massively more events to debounce; higher CPU in Option A is better
**Effort:** 1 line change
**Risk:** High (performance degradation)

### Option C: Status quo
**Pros:** None
**Cons:** Silently dead observer after any SPA navigation
**Risk:** Medium (bot appears to work but doesn't)

## Recommended Action

Option A.

## Technical Details

- **File:** `extension/src/poker-content.ts:738, 847-874`

## Acceptance Criteria

- [ ] `MutationObserver` stored in module-level variable
- [ ] `startObserving()` disconnects previous observer before creating new one
- [ ] `observerActive` reset to `false` when observer is disconnected
- [ ] SPA navigation (`.table-area` removed + re-added) results in valid observation

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by performance-oracle (C2 — BLOCKER), pattern-recognition-specialist.
