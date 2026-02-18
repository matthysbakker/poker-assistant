---
status: resolved
priority: p3
issue_id: "014"
tags: [code-review, race-condition]
---

# analyzing flag reset on street transition could allow double Claude calls

## Problem Statement
A forward street transition sets `analyzing: false` (state-machine.ts line 149). If Claude is mid-response from a previous street, this reopens the gate for a new analysis trigger.

## Files
- `lib/hand-tracking/state-machine.ts` line 149

## Proposed Fix
Don't reset `analyzing` on street transition — let `ANALYSIS_COMPLETE` handle it. Or track analysis per-street.
