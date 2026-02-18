---
status: resolved
priority: p3
issue_id: "015"
tags: [code-review, yagni, simplicity]
---

# Remove unused handId and timestamp from state

## Problem Statement
`handId` is generated per hand and `timestamp` per street snapshot, but neither is consumed anywhere — not by UI, API, or storage. YAGNI violation.

## Files
- `lib/hand-tracking/types.ts`: `handId`, `StreetSnapshot.timestamp`
- `lib/hand-tracking/state-machine.ts`: `generateHandId()`, `timestamp: Date.now()`

## Proposed Fix
Remove `handId`, `generateHandId()`, and `timestamp` from types and state machine. Saves ~10 lines.
