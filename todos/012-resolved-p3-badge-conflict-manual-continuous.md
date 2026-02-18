---
status: resolved
priority: p3
issue_id: "012"
tags: [code-review, extension, ui]
---

# Badge conflict between manual capture and continuous mode

## Problem Statement
Manual capture during continuous mode calls `setBadge("OK", "#22c55e")` with a 3s timeout. After timeout, the "ON" badge disappears despite continuous capture still running.

## Files
- `extension/src/background.ts` lines 11-17, 137

## Proposed Fix
Track timeout ID and cancel previous ones. Restore "ON" badge after manual capture timeout if continuous is active.
