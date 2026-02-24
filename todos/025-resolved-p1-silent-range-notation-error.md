---
status: pending
priority: p1
issue_id: "025"
tags: [code-review, quality, correctness, persona-generator]
dependencies: []
---

# Silent FOLD on Unrecognized Range Notation

## Problem Statement

`parseRange()` in `scripts/generate-charts.ts` emits `console.warn` when it encounters an unrecognized token and silently continues. The resulting hands are never added to the chart and default to FOLD. The 169-entry validation at line 377 still passes because the chart has the right *count* — just wrong *values*. A typo in a range definition produces a silently narrower persona that no automated check will catch.

## Findings

- `scripts/generate-charts.ts:159` — `console.warn([warn] Unrecognized range notation: "${part}")` followed by `continue`
- A typo like `"ATs "` (trailing space), `"88++"`, or `"A10s+"` produces zero expansion and silent FOLD assignment
- The 169-entry count validation (`process.exit(1)` on wrong count) does NOT catch this — chart has 169 entries, just missing intended hands
- Three independent reviewers flagged this as the top correctness risk

## Proposed Solutions

### Option A: Throw on unrecognized notation (Recommended)
Change line 159 from `console.warn` to `throw new Error`:
```typescript
throw new Error(`Unrecognized range notation: "${part}" in: "${notation}"`);
```
**Pros:** Fatal on any typo, prevents bad generation, zero ambiguity
**Cons:** None — this is a build script, not user-facing
**Effort:** 1 line
**Risk:** None

### Option B: console.error + process.exit(1)
```typescript
console.error(`ERROR: Unrecognized range notation: "${part}" in: "${notation}"`);
process.exit(1);
```
**Pros:** Consistent with existing guard pattern in the file
**Cons:** Slightly more verbose than a throw
**Effort:** 2 lines
**Risk:** None

### Option C: Keep warn, add separate validation pass
After generation, check that every non-default (FOLD) hand was actually intended by verifying call+raise notation expands to exactly N hands.
**Pros:** More structural validation
**Cons:** Much more code for the same outcome as Option A
**Effort:** Large
**Risk:** Low

## Recommended Action

Option A — throw on unrecognized notation. Build scripts should fail loudly.

## Technical Details

- **File:** `scripts/generate-charts.ts`
- **Line:** 159
- **Context:** Inside `parseRange()`, after all regex branches fail and `ALL_HANDS.includes(part)` is false

## Acceptance Criteria

- [ ] `parseRange()` throws (or exits 1) instead of warns on unrecognized notation
- [ ] `bun run generate-charts` with a deliberate typo in a range def fails with a clear error
- [ ] `bun run generate-charts` with valid range defs continues to succeed

## Work Log

- 2026-02-21: Created from PR #6 review. Flagged by TypeScript reviewer (critical), security reviewer (low for personal tool but recommends fix), and pattern reviewer.
