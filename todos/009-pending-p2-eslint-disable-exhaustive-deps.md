---
status: pending
priority: p2
issue_id: "009"
tags: [code-review, react, code-quality]
---

# eslint-disable for react-hooks/exhaustive-deps hides stale closure risk

## Problem Statement
The message listener `useEffect` in `page.tsx` suppresses the exhaustive-deps lint rule. While currently safe (all captured values are stable), this hides a maintenance hazard — anyone adding a state read to `handleContinuousFrame` will get stale closures with no warning.

## Findings
- `app/page.tsx` line 75: `// eslint-disable-next-line react-hooks/exhaustive-deps`
- `handleContinuousFrame` is a plain function, not `useCallback`, recreated on every render
- The effect captures the initial version via closure

## Proposed Fix
Either wrap `handleContinuousFrame` in `useCallback`, use a ref for the handler, or extract into `useContinuousCapture` hook (see #008). At minimum, list stable deps explicitly.
