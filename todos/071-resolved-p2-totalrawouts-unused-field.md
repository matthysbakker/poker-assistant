---
status: pending
priority: p2
issue_id: "071"
tags: [code-review, typescript, dead-code, poker-logic]
dependencies: []
---

# `totalRawOuts` in `DirtyOutsInput` Accepted But Never Used

## Problem Statement

The `DirtyOutsInput` interface (or equivalent) accepts a `totalRawOuts` field, but `applyExploitAdjustments()` or the calling context never reads it. This is dead API surface that misleads callers into thinking the field influences the calculation.

## Findings

- `DirtyOutsInput.totalRawOuts` (or similar typed input field) is accepted by `exploit.ts` or `rule-tree.ts`
- No code path inside the function reads this field
- TypeScript allows passing it silently — no warning that it has no effect
- Callers may populate it expecting it to change behaviour
- Location: `lib/poker/exploit.ts` or `lib/poker/rule-tree.ts` — input type definition

## Proposed Solutions

### Option 1: Remove the Field (Recommended)

**Approach:** Delete `totalRawOuts` from the input interface. Update callers to stop passing it.

**Pros:**
- Honest API
- No dead code

**Cons:**
- If field was planned for future use, remove it when actually needed (YAGNI)

**Effort:** 30 minutes
**Risk:** Low

---

### Option 2: Use the Field

**Approach:** Implement logic that uses `totalRawOuts` (e.g., equity estimation in exploit confidence).

**Pros:** Enriches exploit calculation

**Cons:** Scope creep; should be a separate feature, not a bug fix

**Effort:** 3–4 hours
**Risk:** Medium

## Technical Details

**Affected files:**
- `lib/poker/exploit.ts` (or `rule-tree.ts`) — input type + function body
- `lib/poker/__tests__/exploit.test.ts` — remove from test fixtures if present

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** kieran-typescript-reviewer (finding 6)

## Acceptance Criteria

- [ ] `totalRawOuts` removed from input interface (if not used)
- [ ] No callers pass the removed field
- [ ] All tests pass

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
