---
status: resolved
priority: p3
issue_id: "024"
tags: [code-review, consistency]
---

# Inconsistent INITIAL_STATE return in reducer

## Problem Statement
The `RESET` case returns `INITIAL_STATE` directly (same reference), while the WAITING hysteresis path returns `{ ...INITIAL_STATE }` (new reference). React skips re-render when same reference is returned.

## Files
- `lib/hand-tracking/state-machine.ts` lines 72 and 109-111

## Proposed Fix
Both should spread: `return { ...INITIAL_STATE };` for consistency.
