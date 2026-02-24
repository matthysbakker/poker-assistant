---
status: pending
priority: p1
issue_id: "101"
tags: [code-review, correctness, race-condition, play-mode, autopilot]
dependencies: []
---

# Stale Pre-fetch Guard Is Monitor-Only — Play Mode Has Identical Double-Action Race

## Problem Statement

The guard in `onDecisionReceived` that discards the stale pre-fetch response only fires when `autopilotMode === "monitor"`. In play mode, the identical race exists: pre-fetch fires at hand start, fast-path fires at hero's turn, fast-path acts and clears `executing`, then pre-fetch response arrives and calls `safeExecuteAction` a second time. In play mode this is a second real-money button click.

## Findings

- `extension/src/poker-content.ts:1070` — `if (autopilotMode === "monitor" && preflopFastPathFired)`
- The `&&` condition means play mode is unprotected
- Race sequence in play mode:
  1. Hand starts → pre-fetch fires, `executing = true`
  2. Hero's turn → `executing` may still be true (blocks fast-path tick)
  3. Pre-fetch response arrives → `executing = false`, `safeExecuteAction` called
  4. Next tick → fast-path fires (now `executing = false`), acts again
  - OR:
  1. Hand starts → pre-fetch fires
  2. Hero's turn → fast-path fires, acts, clears `executing`
  3. Pre-fetch response arrives → guard is `false` (play mode) → `safeExecuteAction` called again
- Flagged by both pattern-recognition-specialist and security-sentinel

## Proposed Solutions

### Option A: Remove the mode condition (Recommended, one-line fix)
```typescript
// Before:
if (autopilotMode === "monitor" && preflopFastPathFired) {

// After:
if (preflopFastPathFired) {
```
Keep the mode-specific log message inside a nested check:
```typescript
if (preflopFastPathFired) {
  if (autopilotMode === "monitor") {
    console.log("[Poker] [MONITOR] Discarding stale pre-fetch — preflop fast-path already acted");
  } else {
    console.log("[Poker] [PLAY] Discarding stale pre-fetch — preflop fast-path already acted");
  }
  executing = false;
  return;
}
```

**Pros:** Symmetric protection for both modes, minimal change
**Cons:** None

### Option B: Tagged pre-fetch requests
Assign each `requestDecision()` call a generation ID and discard responses from old generations.
**Pros:** More principled, also handles the issue-102 timing race
**Cons:** More invasive

## Recommended Action

Option A immediately. Option B as a follow-up once the system is more stable.

## Technical Details

- File: `extension/src/poker-content.ts`
- Line: ~1070
- Related: `preflopFastPathFired`, `executing`, `safeExecuteAction`, `autopilotMode`

## Acceptance Criteria

- [ ] In play mode, a Claude pre-fetch response that arrives after the fast-path has acted is discarded
- [ ] In monitor mode, behavior is unchanged
- [ ] No double-action on any preflop hand in either mode

## Work Log

- 2026-02-24: Found during code review of commits b24f0a9..b81eda6. Flagged by pattern-recognition-specialist and security-sentinel.
