---
status: pending
priority: p2
issue_id: "006"
tags: [code-review, react]
---

# Stale closure risk in analysis trigger useEffect

## Problem Statement
The shouldAnalyze `useEffect` reads `handState` via `buildHandContext(handState)` but only has primitive fields (`shouldAnalyze`, `street`) in the dependency array. The full `handState` object could theoretically be stale.

## Findings
- `app/page.tsx` lines 40-49
- Works by coincidence: `shouldAnalyze` flipping always produces a new `handState` reference
- Fragile if reducer ever returns state where `shouldAnalyze` stays true across dispatches

## Proposed Fix
Either add `handState` to deps (with appropriate guard), or pass only the specific fields `buildHandContext` needs.
