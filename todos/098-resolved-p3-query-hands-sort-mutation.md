---
status: pending
priority: p3
issue_id: "098"
tags: [code-review, quality]
dependencies: []
---

# groupByHand Mutates Shared Map Arrays In-Place via .sort()

## Problem Statement

`groupByHand()` in `scripts/query-hands.ts` calls `.sort()` directly on the array stored in the `Map`, mutating the shared data structure. This is benign for current CLI-only usage but is a footgun if the function is ever called before other passes over the data.

## Findings

- `scripts/query-hands.ts:102` — `const sorted = streetRecords.sort(...)` mutates the array returned by `hands.get(handKey)`, which is the same array stored in the `Map`
- Performance agent: "This is benign for the current CLI-only usage since `groupByHand` is the last operation, but it is a footgun if the function is ever called before other passes"
- Non-null assertions at lines 75 and 79 are logically safe but fragile against restructuring

## Proposed Solutions

### Option 1: Sort a shallow copy (Recommended)

**Approach:**
```ts
// Change:
const sorted = streetRecords.sort((a, b) => ...);
// To:
const sorted = [...streetRecords].sort((a, b) => ...);
```

**Pros:**
- One character change (`[...` prefix)
- Prevents mutation of Map's internal arrays

**Effort:** 2 minutes

**Risk:** None

---

### Option 2: Also replace non-null assertions with safe access

**Approach:**
```ts
const hands = sessions.get(sessionKey);
if (!hands) continue;  // makes invariant explicit instead of !
```

**Pros:**
- Removes suppression of TypeScript correctness checks

**Effort:** 5 minutes

**Risk:** None

---

## Recommended Action

**To be filled during triage.** Both fixes are trivial. Apply together.

## Technical Details

**Affected files:**
- `scripts/query-hands.ts:75, 79, 102`

## Resources

- **PR:** #12

## Acceptance Criteria

- [ ] `.sort()` called on `[...streetRecords]` (shallow copy)
- [ ] Non-null assertions replaced with explicit guards

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (performance-oracle + pattern-recognition-specialist agents)
