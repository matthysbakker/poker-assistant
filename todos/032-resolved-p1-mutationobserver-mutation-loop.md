---
status: pending
priority: p1
issue_id: "032"
tags: [code-review, performance, correctness, autopilot, mutation-observer]
dependencies: []
---

# MutationObserver Mutation Loop: `scrapeGameState` Clears Checkboxes and Retriggers Observer

## Problem Statement

`scrapeGameState()` calls `.checked = false` on pre-action checkboxes. The MutationObserver watches with `attributes: true, subtree: true`. Unchecking a checkbox is an attribute mutation, which fires `onDomChange`, which schedules another `processGameState`, which clears checkboxes again, ad infinitum. During active play the system runs in a tight self-feeding 200ms loop continuously.

## Findings

- `extension/src/poker-content.ts:374-380` — `document.querySelectorAll(".pre-action-toggle:checked").forEach(el => el.checked = false)` inside `scrapeGameState()`
- `extension/src/poker-content.ts:862-867` — observer configured with `attributes: true` and `subtree: true`
- `extension/src/poker-content.ts:741-746` — 200ms debounce; each checkbox clear resets the debounce timer
- The mutation loop fires in **monitor mode too** — observer runs unconditionally once started
- Performance review (2026-02-23): "hand played inside a tight self-feeding 200ms loop for as long as any pre-action checkbox has ever been checked"
- Security review (2026-02-23, MED-5): "constitutes an unintended side effect on a real-money gambling interface"

## Proposed Solutions

### Option A: Move checkbox clearing to `onDecisionReceived`, play mode only (Recommended)
Remove the side effect from `scrapeGameState()` entirely. Call it once in `onDecisionReceived()` before executing, only when `autopilotMode === "play"`:
```typescript
function onDecisionReceived(action: AutopilotAction) {
  if (autopilotMode === "play") {
    document.querySelectorAll(".pre-action-toggle:checked").forEach(el => {
      (el as HTMLInputElement).checked = false;
    });
  }
  handMessages.push({ role: "assistant", content: action.reasoning });
  executeAction(action);
}
```
**Pros:** Breaks the loop; correct semantics (clear before acting, not before reading); monitor mode unaffected
**Cons:** None
**Effort:** Small (move ~4 lines)
**Risk:** None

### Option B: Add `attributeFilter: []` to exclude checkbox attributes from observation
Pass `attributeFilter: ['class']` to the observer to only watch class changes.
**Pros:** Stops the attribute loop without moving code
**Cons:** Misses legitimate attribute changes on non-checkbox elements that signal state
**Effort:** Very small
**Risk:** May break hero-turn detection if it relies on non-class attribute changes

### Option C: Remove `attributes: true` from observer config
**Pros:** Eliminates the feedback entirely
**Cons:** May miss state signals from attribute-only changes (visibility toggles like `pt-visibility-hidden`)
**Effort:** Very small
**Risk:** Medium — Playtech uses class/attribute toggling for visibility

## Recommended Action

Option A is correct — this is fundamentally a Command-Query Separation violation. `scrapeGameState` should be a pure read. The side effect belongs in the action path.

## Technical Details

- **File:** `extension/src/poker-content.ts`
- **Mutation source:** line 378 `el.checked = false`
- **Observer config:** lines 862-867
- **Side effects in scrape** also flagged separately by architecture-strategist (H4) and pattern-recognition-specialist

## Acceptance Criteria

- [ ] `scrapeGameState()` contains no DOM mutations
- [ ] Pre-action checkboxes are cleared exactly once per decision, in `onDecisionReceived`, only in play mode
- [ ] `processGameState` does not trigger additional mutations during scraping
- [ ] MutationObserver does not fire in a feedback loop during active sessions

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by performance-oracle (C1 — BLOCKER), architecture-strategist (H4), security-sentinel (MED-5).
