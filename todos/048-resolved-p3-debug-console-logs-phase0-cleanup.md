---
status: pending
priority: p3
issue_id: "048"
tags: [code-review, cleanup, performance, autopilot]
dependencies: []
---

# Phase 0 Debug `outerHTML` Console Logs Left in Production Code

## Problem Statement

Two `console.log(outerHTML)` calls added during Phase 0 DOM discovery were never removed. They fire on every scrape cycle (every ~200ms during active play), dumping full card holder and actions area HTML to the console continuously. This pollutes the background console and adds serialization overhead.

## Findings

- `extension/src/poker-content.ts:180` — `console.log("[Poker] Hero cards HTML:", holder.outerHTML)` inside `scrapeHeroCards()` — fires every scrape
- `extension/src/poker-content.ts:322-323` — `// LOG THE RAW HTML for Phase 0 discovery` + `console.log("[Poker] Actions area HTML:", actionsArea.outerHTML)` inside `scrapeAvailableActions()` — fires every scrape
- `extension/src/poker-content.ts:787` — `console.log("[Poker] Game state:", JSON.stringify(state, null, 2))` — fires on every new hand; large allocation
- Performance review (2026-02-23, O3): "Gate all debug outerHTML console.log calls behind a DEBUG flag"
- Simplicity review (2026-02-23): "Phase 0 discovery artifacts — can be safely removed"

## Proposed Solutions

### Option A: Remove the Phase 0 discovery logs entirely (Recommended)
Delete lines 180, 322-323. These were explicitly for Phase 0 and commented as such. Monitor-mode `sendDebugLog` (lines 769-782) already provides full DOM capture when needed via the background console.
**Effort:** Delete 3 lines
**Risk:** None

### Option B: Gate behind `const DEBUG = false` constant
```typescript
const DEBUG = false; // Set true for DOM discovery
// ...
if (DEBUG) console.log("[Poker] Hero cards HTML:", holder.outerHTML);
```
**Pros:** Easy to re-enable for future debugging
**Cons:** Dead code at `DEBUG = false`; still requires manual toggle
**Effort:** Small
**Risk:** None

## Recommended Action

Option A. Monitor mode provides all needed DOM capture for future debugging. Phase 0 is complete.

## Technical Details

- **File:** `extension/src/poker-content.ts:180, 322-323, 787`

## Acceptance Criteria

- [ ] `outerHTML` console.log calls removed from `scrapeHeroCards` and `scrapeAvailableActions`
- [ ] `JSON.stringify(state)` on new hand either removed or gated (it fires every hand)
- [ ] Monitor-mode sendDebugLog (lines 769-782) continues to provide DOM capture when needed

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by performance-oracle (O3), simplicity-reviewer, security-sentinel (MED-3).
