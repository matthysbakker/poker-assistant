---
status: pending
priority: p2
issue_id: "068"
tags: [code-review, architecture, duplication, poker-logic]
dependencies: []
---

# `_rankCounts` / `_suitCounts` Duplicated Across Multiple Modules

## Problem Statement

The logic for counting ranks and suits from a card array is duplicated in at least 2–3 places across the poker logic modules (`rule-tree.ts`, `exploit.ts`, `board-analysis.ts` or similar). Any bug fix or edge-case improvement must be applied in each location.

## Findings

- `RANK_MAP` (mapping rank string → numeric value) is defined independently 3 times across the codebase
- `_rankCounts` / `_suitCounts` computation is similarly repeated
- Identified in: `lib/poker/rule-tree.ts`, `lib/poker/exploit.ts`, and at least one other file
- Review agent: pattern-recognition-specialist flagged this as a violation of DRY principle
- Each definition is slightly different in edge cases, creating inconsistency risk

## Proposed Solutions

### Option 1: Consolidate in `lib/poker/hand-utils.ts` (Recommended)

**Approach:** Create (or expand existing) `hand-utils.ts` with:
- `RANK_MAP: Record<Rank, number>` (exported constant)
- `rankCounts(cards: Card[]): Map<Rank, number>`
- `suitCounts(cards: Card[]): Map<Suit, number>`

All callers import from this single source.

**Pros:**
- Single bug-fix target
- Easier testing
- Consistent behaviour everywhere

**Cons:**
- Import churn

**Effort:** 1–2 hours
**Risk:** Low

---

### Option 2: Move to `lib/poker/types.ts`

**Approach:** Add `RANK_MAP` as an exported constant in `types.ts`.

**Pros:** Minimal new files

**Cons:** `types.ts` should be type-only; mixing runtime values muddies separation of concerns

**Effort:** 30 minutes
**Risk:** Low

## Technical Details

**Affected files:**
- `lib/poker/rule-tree.ts`
- `lib/poker/exploit.ts`
- Any other file with local `RANK_MAP` definition
- `lib/poker/hand-utils.ts` (new or existing)

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** pattern-recognition-specialist

## Acceptance Criteria

- [ ] `RANK_MAP` defined exactly once, exported from a shared module
- [ ] `rankCounts` / `suitCounts` helpers defined exactly once
- [ ] All existing tests still pass
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
