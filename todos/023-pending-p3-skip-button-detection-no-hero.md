---
status: pending
priority: p3
issue_id: "023"
tags: [code-review, performance]
---

# Button detection runs even when no hero cards detected

## Problem Statement
`detectActionButtons()` always runs (~15-25ms), even in WAITING state when the result is irrelevant.

## Files
- `lib/card-detection/detect.ts` line 39

## Proposed Fix
```typescript
const heroTurn = heroCards.length > 0
  ? await detectActionButtons(imageBuffer)
  : false;
```
Also consider running button detection in parallel with card processing via `Promise.all`.
