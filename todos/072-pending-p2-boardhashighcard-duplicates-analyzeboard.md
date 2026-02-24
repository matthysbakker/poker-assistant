---
status: pending
priority: p2
issue_id: "072"
tags: [code-review, duplication, poker-logic, architecture]
dependencies: []
---

# `boardHasHighCard()` in `rule-tree.ts` Duplicates `board.highCards` from `analyzeBoard()`

## Problem Statement

`rule-tree.ts` introduced a local `boardHasHighCard()` helper that checks whether any community card has rank ≥ Q. This is redundant: `analyzeBoard()` already computes `board.highCards` (or equivalent) which captures the same information. The duplicate computation means a future change to "high card" definition must be made in two places.

## Findings

- `lib/poker/rule-tree.ts`: `boardHasHighCard(communityCards)` iterates cards and checks rank against `['A','K','Q']`
- `lib/poker/board-analysis.ts`: `analyzeBoard()` returns an object including `highCards` (or similar field)
- `applyRuleTree()` already calls `analyzeBoard()` and has access to the result
- `boardHasHighCard()` was added to compute the AP-2 guard condition — but `board.highCards.length > 0` already provides the same check
- Location: `lib/poker/rule-tree.ts` — `boardHasHighCard()` function definition, usage in `applyRuleTree()`

## Proposed Solutions

### Option 1: Remove `boardHasHighCard()`, Use `board.highCards` (Recommended)

**Approach:** Replace `boardHasHighCard(communityCards)` with `board.highCards.length > 0` (or the appropriate field name from `analyzeBoard()`).

**Pros:**
- Single source of truth for "high card board" definition
- Removes 8 lines of duplicated logic

**Cons:**
- Must verify that `analyzeBoard().highCards` is available at the call site (it is — `applyRuleTree()` calls `analyzeBoard()` before exploit)

**Effort:** 15 minutes
**Risk:** Low

---

### Option 2: Extend `analyzeBoard()` Return Type if Missing

**Approach:** If `board` doesn't expose `highCards`, add it to `analyzeBoard()` and remove the local helper.

**Pros:** Enriches the board analysis result for all callers

**Cons:** Slightly larger change

**Effort:** 30 minutes
**Risk:** Low

## Technical Details

**Affected files:**
- `lib/poker/rule-tree.ts` — `boardHasHighCard()` function + call site

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** pattern-recognition-specialist

## Acceptance Criteria

- [ ] `boardHasHighCard()` function removed from `rule-tree.ts`
- [ ] AP-2 guard uses `board.highCards` (or equivalent) instead
- [ ] All tests pass

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
