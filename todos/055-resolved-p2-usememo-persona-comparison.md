---
status: pending
priority: p2
issue_id: "055"
tags: [code-review, performance, react, personas]
dependencies: []
---

# Missing useMemo for getPersonaRecommendations in PersonaComparison

## Problem Statement

`PersonaComparison.tsx` calls `getPersonaRecommendations(heroCards, heroPosition)` in the render body without memoization. During AI streaming, `experimental_useObject` delivers partial schema updates ~100ms apart, causing `AnalysisResult` to re-render 10-20 times per hand. `PersonaComparison` re-renders on each delivery and repeats the lookup even though `heroCards` and `heroPosition` arrive early in the stream and do not change.

While individual call cost is sub-microsecond (O(1) lookup, 4 personas), this is a correct-React-practice issue: pure computation that depends only on props should be memoized.

## Findings

- `components/analyzer/PersonaComparison.tsx:39` — `getPersonaRecommendations(heroCards, heroPosition)` called in render body, no `useMemo`
- `heroCards` and `heroPosition` resolve early in the AI stream and remain constant for the hand's duration
- During streaming: ~10-20 re-renders per hand × O(1) lookup = no measurable cost, but semantically wrong
- Performance review (2026-02-23): rated P2

## Proposed Solutions

### Option A: Add useMemo (Recommended)

```typescript
import { useMemo } from "react";

const recommendations = useMemo(
  () => getPersonaRecommendations(heroCards, heroPosition),
  [heroCards, heroPosition],
);
```

**Effort:** 2 lines — add import + wrap with useMemo
**Risk:** None

### Option B: Lift computation to AnalysisResult

Compute `getPersonaRecommendations` in `AnalysisResult` and pass the result down as a prop, eliminating the need for the computation in the component body.

**Effort:** Larger refactor, moves data-fetching responsibility up the tree
**Risk:** Couples AnalysisResult to persona-lookup concerns

## Recommended Action

Option A. Trivial change, correct React practice.

## Technical Details

- **Affected files:** `components/analyzer/PersonaComparison.tsx`
- **Line:** 39

## Acceptance Criteria

- [ ] `getPersonaRecommendations` call wrapped in `useMemo` with `[heroCards, heroPosition]` deps
- [ ] `useMemo` imported from react
- [ ] Component still renders correctly during streaming

## Work Log

- 2026-02-23: Identified by performance-oracle review of PR #8
