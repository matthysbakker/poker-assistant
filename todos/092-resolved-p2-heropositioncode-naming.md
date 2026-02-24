---
status: pending
priority: p2
issue_id: "092"
tags: [code-review, quality]
dependencies: []
---

# heroPositionCode vs heroPosition — Inconsistent Naming Across Layers

## Problem Statement

The same `Position` value has two different field names across adjacent layers with no documented reason for the difference. This forces a dual-lookup in the query script and will confuse future contributors reading the data pipeline.

## Findings

The naming inconsistency is visible across the stack:

| Location | Field name |
|---|---|
| `lib/card-detection/types.ts:56` | `heroPosition` |
| `lib/hand-tracking/types.ts:35` | `heroPosition` |
| `lib/storage/hand-records.ts:46` | `heroPositionCode` |
| `app/api/analyze/route.ts:46` | `heroPositionCode` |

The fallback chain in `scripts/query-hands.ts:110` makes the inconsistency visible:
```ts
const pos = (r.heroPositionCode ?? r.analysis.heroPosition ?? "?").padEnd(3);
```

The `Code` suffix implies it's a short code (like `"UTG"`), but `Position` is already a code type — `heroPosition` without the suffix is equally clear and consistent with upstream naming.

## Proposed Solutions

### Option 1: Rename heroPositionCode → heroPosition across storage and API (Recommended)

**Approach:** Update `lib/storage/hand-records.ts`, `app/api/analyze/route.ts`, and `scripts/query-hands.ts` to use `heroPosition` consistently.

**Pros:**
- Consistent naming across all layers
- `query-hands.ts` fallback becomes cleaner

**Cons:**
- Breaking change for existing stored records (need null fallback in query script — already handled by `?? record.id` pattern)

**Effort:** 30 minutes

**Risk:** Low — existing records will have `heroPositionCode: undefined` which is equivalent to null in the query fallback

---

### Option 2: Document the distinction with JSDoc

**Approach:** Add a JSDoc comment to `heroPositionCode` in `hand-records.ts` explaining why the name differs from the upstream `heroPosition` field.

**Pros:**
- No breaking change

**Cons:**
- Preserves confusing naming

**Effort:** 5 minutes

**Risk:** None

---

## Recommended Action

**To be filled during triage.** Option 1 (rename) is correct. Existing records already use null-fallback patterns.

## Technical Details

**Affected files:**
- `lib/storage/hand-records.ts:46`
- `app/api/analyze/route.ts:46`
- `scripts/query-hands.ts:110`

## Resources

- **PR:** #12

## Acceptance Criteria

- [ ] Consistent field name used across `hand-records.ts`, `route.ts`, and `query-hands.ts`
- [ ] Query script null-fallback updated if needed
- [ ] TypeScript compiles cleanly

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (pattern-recognition-specialist agent)
