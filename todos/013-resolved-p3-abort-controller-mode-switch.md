---
status: resolved
priority: p3
issue_id: "013"
tags: [code-review, race-condition]
---

# No AbortController on in-flight /api/detect when switching modes

## Problem Statement
When switching from continuous to manual mode, any in-flight `/api/detect` fetch is not aborted. When it completes, `feedDetection` and `latestFrameRef` update could interfere with the manual capture.

## Files
- `app/page.tsx` lines 78-101

## Proposed Fix
Use an `AbortController` stored in a ref. Abort on mode switch to manual.
