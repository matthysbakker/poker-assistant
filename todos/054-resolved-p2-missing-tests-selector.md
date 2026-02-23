---
status: pending
priority: p2
issue_id: "054"
tags: [code-review, testing, personas, bun-test]
dependencies: []
---

# Missing Tests: Fallback Path and tight_aggressive Rotation Coverage

## Problem Statement

Two test gaps in `lib/poker/__tests__/persona-selector.test.ts` leave important behavior paths unvalidated.

1. **Empty-candidates fallback** — `persona-selector.ts:65-75` handles the case where none of the `SELECTION_MATRIX` candidate IDs appear in the hand recommendations (e.g., a hand key the lookup can't resolve, or all candidates fold). It falls back to GTO Grinder. No test covers this branch. This path matters in a real-money context where silent fallback to the wrong action is possible.

2. **tight_aggressive rotation both options reachable** — the `tight_passive` test runs 200 iterations to confirm both `exploit_hawk` and `lag_assassin` are reachable via random rotation. The `tight_aggressive` test only asserts `rotated === true` and that the result is in `["gto_grinder", "tag_shark"]` — it never verifies both options are actually reachable. If one persona's chart FOLDs a specific hand/position combo, only one candidate would match and `rotated` would be false — the test would pass incorrectly.

## Findings

- `lib/poker/__tests__/persona-selector.test.ts:64-69` — `tight_aggressive` test: only checks `rotated === true` and ID in valid set; no reachability loop
- `lib/poker/persona-selector.ts:65-75` — empty candidates fallback path, zero test coverage
- Code quality review (2026-02-23): rated MEDIUM

## Proposed Solutions

### Option A: Add the two missing tests (Recommended)

**Test 1 — empty candidates fallback:**
```typescript
test("falls back to GTO Grinder when no candidates match recs", () => {
  // Use a hand/position that GTO Grinder raises but exploit_hawk/lag_assassin fold
  // OR mock getPersonaRecommendations to return only gto_grinder + tag_shark
  // to force tight_passive candidates (exploit_hawk, lag_assassin) to be absent
  // The fallback should return gto_grinder
  const result = selectPersona("tight_passive", "22", "UTG"); // 22 UTG: most personas fold
  // If all candidates fold/aren't in recs, fallback should still return non-null
  expect(result).not.toBeNull();
  expect(result!.persona.id).toBe("gto_grinder");
});
```

Note: the exact hand to trigger the empty path depends on the generated charts. Check if any hand has exploit_hawk=FOLD and lag_assassin=FOLD at a given position.

**Test 2 — tight_aggressive both options reachable:**
```typescript
test("tight_aggressive rotation — both options reachable", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const result = selectPersona("tight_aggressive", "Ah Kd", "CO", Math.random);
    if (result) ids.add(result.persona.id);
  }
  expect(ids.has("gto_grinder")).toBe(true);
  expect(ids.has("tag_shark")).toBe(true);
});
```

**Effort:** Small — add 2 test cases
**Risk:** None

## Recommended Action

Option A. The 200-iteration loop pattern is already used for `tight_passive` — apply the same for `tight_aggressive`. For the empty-candidates test, inspect the generated charts to find a hand where tight_passive candidates both fold; alternatively, mock `getPersonaRecommendations`.

## Technical Details

- **Affected files:** `lib/poker/__tests__/persona-selector.test.ts`
- **Lines:** After line 52 (tight_passive tests) and after line 69 (tight_aggressive tests)

## Acceptance Criteria

- [ ] Test for empty-candidates fallback path exists and passes
- [ ] Test for tight_aggressive rotation reachability (200 iterations) exists and passes
- [ ] `bun test` — 30+ tests pass, 0 fail

## Work Log

- 2026-02-23: Identified by code-quality review of PR #8
