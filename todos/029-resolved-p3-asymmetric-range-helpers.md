---
status: pending
priority: p3
issue_id: "029"
tags: [code-review, simplicity, duplication, persona-generator]
dependencies: []
---

# Asymmetric Range Expansion Helpers and Inline Duplication

## Problem Statement

Three simplification opportunities exist in `scripts/generate-charts.ts`:

1. `expandSuitedPlus` and `expandOffsuitPlus` are identical except for the `"s"`/`"o"` suffix
2. The offsuit range case in `parseRange` (lines 139-151) inlines the same expansion logic as `expandSuitedRange`, without an equivalent `expandOffsuitRange` helper
3. `expandSuitedRange` has an unnecessary min/max swap guard (line 82) — the range data is always authored low-rank-first and the swap never fires

## Findings

**Duplication 1 — `expandSuitedPlus` / `expandOffsuitPlus` (lines 52-72):**
Both functions have identical body; only `"s"` vs `"o"` differs. The simplicity reviewer estimates -10 LOC by merging.

**Duplication 2 — inline offsuit range in `parseRange` (lines 139-151):**
```typescript
// Inline — duplicates expandSuitedRange logic
const fromIdx = RANKS.indexOf(offsuitRange[3]);
const toIdx = RANKS.indexOf(offsuitRange[2]);
const [hi, lo] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
for (let i = hi; i <= lo; i++) {
  hands.push(`${highRank}${RANKS[i]}o`);
}
```
`expandSuitedRange` already encodes this loop with a suffix — the offsuit case just needed a `suffix` parameter. Estimates -9 LOC.

**Dead guard — `expandSuitedRange` line 82:**
```typescript
const [hi, lo] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
```
The conditional swap guards against reversed range notation (e.g., `A5s-A2s` instead of `A2s-A5s`). No persona definition uses reversed notation. The simplicity reviewer recommends removing it (-1 LOC, clearer intent).

## Proposed Solutions

### Option A: Merge suited/offsuit helpers with suffix param (Recommended)
```typescript
function expandConnectedPlus(highRank: string, minLowRank: string, suffix: "s" | "o"): string[] {
  const hiIdx = RANKS.indexOf(highRank);
  const loIdx = RANKS.indexOf(minLowRank);
  const result: string[] = [];
  for (let i = hiIdx + 1; i <= loIdx; i++) {
    result.push(`${highRank}${RANKS[i]}${suffix}`);
  }
  return result;
}
```
Also extract `expandRange(highRank, lowFrom, lowTo, suffix)` used for both suited and offsuit range cases.
**Effort:** Small (-20 LOC)
**Risk:** Low

### Option B: Just add the comment and leave structure
Add comments pointing out the duplication without changing code.
**Effort:** Tiny
**Risk:** None
**Cons:** Duplication persists

## Recommended Action

Option A — merge the helpers. This is the right call for a code-generation script that may need to add new range forms in the future.

## Technical Details

- **File:** `scripts/generate-charts.ts`
- Lines affected: 52-72 (two helper functions), 139-151 (inline offsuit range), 82 (dead guard)

## Acceptance Criteria

- [ ] `expandSuitedPlus` and `expandOffsuitPlus` merged into one function with suffix param
- [ ] Offsuit range case uses a shared helper matching `expandSuitedRange`'s structure
- [ ] `bun run generate-charts` output is identical to current (regression-test by diffing)

## Work Log

- 2026-02-21: Created from PR #6 review. Simplicity reviewer identified 3 duplication sites, ~20 LOC reduction possible.
