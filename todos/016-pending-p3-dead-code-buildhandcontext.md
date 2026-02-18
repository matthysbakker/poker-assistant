---
status: pending
priority: p3
issue_id: "016"
tags: [code-review, dead-code, simplicity]
---

# Dead code in buildHandContext fallback block

## Problem Statement
Lines 53-62 of `buildHandContext` check if the current street differs from the last snapshot and appends it. But `shouldAnalyze` only triggers after a street transition is confirmed (which adds to `streets`), or on a same-street heroTurn flip (where `lastSnap.street === state.street`). The fallback block never executes.

## Files
- `lib/hand-tracking/use-hand-tracker.ts` lines 53-62

## Proposed Fix
Remove the fallback block. Simplify to `state.streets.map(...).join(". ")`. Saves ~15 lines.
