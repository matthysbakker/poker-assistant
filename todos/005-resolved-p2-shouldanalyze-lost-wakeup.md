---
status: resolved
priority: p2
issue_id: "005"
tags: [code-review, race-condition]
---

# shouldAnalyze consumed non-atomically (lost wakeup)

## Problem Statement
Between the useEffect reading `shouldAnalyze = true` and dispatching `ANALYSIS_STARTED`, another `DETECTION` action can set `shouldAnalyze = true` again. `ANALYSIS_STARTED` then clears it, swallowing the second trigger.

## Findings
- `app/page.tsx` lines 40-49: useEffect reads and clears shouldAnalyze
- `lib/hand-tracking/state-machine.ts` line 98: `shouldAnalyze: shouldAnalyze || state.shouldAnalyze`
- Classic "lost wakeup" pattern when boolean flag is used across async boundaries

## Proposed Fix
Consider a generation counter instead of a boolean. The effect captures the generation at trigger time; `ANALYSIS_STARTED` only clears if generation hasn't advanced.
