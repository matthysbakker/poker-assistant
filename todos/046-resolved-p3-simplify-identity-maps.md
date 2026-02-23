---
status: pending
priority: p3
issue_id: "046"
tags: [code-review, simplicity, autopilot]
dependencies: []
---

# Simplify `SVG_SUIT_MAP` Identity Map and `SVG_RANK_MAP` to Inline Logic

## Problem Statement

`SVG_SUIT_MAP` maps every suit character to itself (`c→c, d→d, h→h, s→s`) — a pure identity serving only as a membership check. `SVG_RANK_MAP` maps 10 of 13 values to themselves; only `a→A`, `j→J`, `q→Q`, `k→K` are actual transformations. Both can be eliminated in favor of simpler inline logic.

## Findings

- `extension/src/poker-content.ts:65-70` — `SVG_SUIT_MAP` — identity map
- `extension/src/poker-content.ts:72-86` — `SVG_RANK_MAP` — near-identity (only 4 transformations needed)
- `extension/src/poker-content.ts:154-158` — usage: `const suit = SVG_SUIT_MAP[suitChar]` + `const rank = SVG_RANK_MAP[rankStr]`
- Simplicity review (2026-02-23): "The regex already constrains the input to valid suit chars. Both maps can be deleted entirely."

## Proposed Solutions

### Option A: Inline with `.toUpperCase()` and regex membership check (Recommended)
```typescript
function parseCardFromSvg(src: string): string | null {
  const match = src.match(/\/([cdhs])([a2-9]|10|[jqka])\.svg$/i);
  if (!match) return null;
  const [, suitChar, rankStr] = match;
  const rank = rankStr.toUpperCase();  // a→A, j→J, q→Q, k→K, others unchanged
  return rank + suitChar;              // suitChar already validated by regex
}
```
**Pros:** Removes 20 lines of constant declarations; regex validates suit + rank in one step
**Cons:** None
**Effort:** Delete 2 constants, simplify function (~5 min)
**Risk:** None — regex captures are already validated

## Acceptance Criteria

- [ ] `SVG_SUIT_MAP` constant removed
- [ ] `SVG_RANK_MAP` constant removed
- [ ] Card parsing produces identical output (Ah, Kd, 10s, etc.)
- [ ] Unit-testable: `parseCardFromSvg("../../resources/images/cards-classic-assets/dq.svg")` → `"Qd"`

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by simplicity-reviewer, pattern-recognition-specialist.
