---
status: resolved
priority: p3
issue_id: "022"
tags: [code-review, observability]
---

# Silent catch in handleContinuousFrame

## Problem Statement
The `catch {}` block in `handleContinuousFrame` silently swallows all errors. In a long session, repeated failures are invisible.

## Files
- `app/page.tsx` lines 96-98

## Proposed Fix
Add `console.debug("[continuous] Detection fetch failed:", e)` for dev visibility.
