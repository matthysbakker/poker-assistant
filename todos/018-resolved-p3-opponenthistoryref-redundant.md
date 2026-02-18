---
status: resolved
priority: p3
issue_id: "018"
tags: [code-review, simplicity]
---

# opponentHistoryRef dual tracking is redundant

## Problem Statement
Both a ref and state variable track the same opponent history data. The ref is always set to the same value as state and never read independently.

## Files
- `app/page.tsx` lines 27-28, 46-47, 60-61, 104-105

## Proposed Fix
Drop `opponentHistoryRef` and just use `setOpponentHistory(getOpponentContext())` directly. Saves ~5 lines.
