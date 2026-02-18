---
status: resolved
priority: p3
issue_id: "021"
tags: [code-review, security]
---

# postMessage uses wildcard "*" origin

## Problem Statement
All `window.postMessage` calls use `"*"` as target origin. The page's message handler checks `event.data.source` but not `event.origin`. Any script on the page could inject fake messages.

## Files
- `extension/src/content.ts` lines 18, 34, 40
- `app/page.tsx` line 73 (listener), line 54 (source check only)

## Proposed Fix
- Content script: use `window.location.origin` instead of `"*"`
- Page: add `if (event.origin !== window.location.origin) return;`
