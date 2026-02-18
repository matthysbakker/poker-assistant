---
status: pending
priority: p2
issue_id: "001"
tags: [code-review, reliability, api]
---

# Missing error handling in /api/detect

## Problem Statement
The `/api/detect` endpoint has no try/catch around `req.json()` or `detectCards()`. Both can throw — invalid JSON returns a 500 with stack trace instead of clean JSON error. Since this endpoint is called every 2 seconds during continuous capture, transient sharp errors should be handled gracefully.

## Findings
- `req.json()` throws on invalid JSON body (line 10)
- `detectCards()` throws on corrupt image data or sharp failure (line 18)
- Compare with `/api/analyze` which wraps `detectCards` in try/catch

## Files
- `app/api/detect/route.ts`

## Proposed Fix
Wrap both in try/catch, return clean JSON errors with appropriate status codes.
