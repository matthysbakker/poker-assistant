---
status: pending
priority: p3
issue_id: "077"
tags: [code-review, simplicity, exploit, typescript]
dependencies: []
---

# `isCallDownLine()` Used Once — Inline the Trivial Expression

## Problem Statement

`isCallDownLine()` in `exploit.ts` is a one-liner helper used in exactly one place. Naming a trivial expression as a function adds cognitive overhead (reader must look up the function definition) without adding clarity.

## Findings

- `exploit.ts` defines `isCallDownLine(action)` → `action === "CALL"`
- Used once in the calling context
- No future reuse anticipated — CALL action detection is not a shared concept
- Review agent: code-simplicity-reviewer

## Proposed Solutions

### Option 1: Inline the Expression

**Approach:** Replace the function call with `action === "CALL"` at the use site. Delete the helper.

**Effort:** 10 minutes
**Risk:** Low

## Technical Details

**Affected files:**
- `lib/poker/exploit.ts`

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** code-simplicity-reviewer

## Acceptance Criteria

- [ ] `isCallDownLine()` function removed
- [ ] Use site reads `action === "CALL"` (or semantically equivalent)
- [ ] All tests pass

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
