---
status: pending
priority: p2
issue_id: "115"
tags: [code-review, code-quality, duplication]
---

# parseCard function and RANK_MAP/SUIT_MAP duplicated across hand-evaluator and equity module

## Problem Statement
`lib/poker/hand-evaluator.ts:41-51` contains a private `parseCard` that is structurally identical to `lib/poker/equity/card.ts:23-33`. Both share the same `RANK_MAP` and `SUIT_MAP` values verbatim. The straight-counting algorithm is also duplicated (and has already diverged). This creates a maintenance risk where tuning one implementation doesn't update the other.

## Findings
- `lib/poker/hand-evaluator.ts:41-68` — private `parseCard`, `flushOutCount`, `straightOutCount`
- `lib/poker/equity/card.ts:23-33` — canonical `parseCard` with type-guard filter
- `lib/poker/equity/outs.ts:20-56` — canonical `countFlushOuts` and `countStraightOuts`
- Straight counting has already behaviorally diverged: `hand-evaluator` returns single int, `outs.ts` returns `{ oesd, gutshot }` struct
- 3x uses of `.filter(Boolean) as ParsedCard[]` in `hand-evaluator.ts:143-145` — unsafe cast that `equity/card.ts:37` solves correctly

## Proposed Fix
1. Import `parseCard` / `parseCards` from `lib/poker/equity/card.ts` in `hand-evaluator.ts`
2. Import `countFlushOuts` / `countStraightOuts` from `lib/poker/equity/outs.ts`
3. Replace the 3 unsafe `.filter(Boolean) as ParsedCard[]` casts with `.filter((c): c is Card => c !== null)`
4. Delete the private duplicate implementations

## Files
- `lib/poker/hand-evaluator.ts:41-68` (remove duplicates)
- `lib/poker/equity/card.ts:23-37` (canonical source)
- `lib/poker/equity/outs.ts:20-56` (canonical source)

## Acceptance Criteria
- [ ] `hand-evaluator.ts` imports from `equity/` instead of duplicating
- [ ] All 3 unsafe filter casts replaced with type-guard form
- [ ] All tests in `lib/poker/__tests__/` pass
