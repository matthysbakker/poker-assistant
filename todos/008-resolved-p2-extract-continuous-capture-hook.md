---
status: resolved
priority: p2
issue_id: "008"
tags: [code-review, architecture]
---

# Extract useContinuousCapture hook from page.tsx

## Problem Statement
`page.tsx` manages 8 state vars, 3 refs, 6 callbacks, and 2 effects — growing toward a god component with dual-mode logic. The continuous capture logic (detection loop, analysis trigger, captureMode, handContext, detectingRef) should be its own hook.

## Findings
- `app/page.tsx` at 265 lines with both manual and continuous mode logic
- Would also eliminate the `eslint-disable-next-line react-hooks/exhaustive-deps`
- The `handleContinuousFrame` function is a plain function (not `useCallback`) captured by a stale closure in the message listener effect

## Proposed Fix
Extract `useContinuousCapture` hook exposing:
```typescript
{ captureMode, handState, handContext, handleFrame, handleManualCapture, reset }
```
