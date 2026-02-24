---
status: pending
priority: p2
issue_id: "026"
tags: [code-review, quality, correctness, persona-generator]
dependencies: []
---

# No Validation That Non-BB Positions Have Zero CALL Entries

## Problem Statement

The MEMORY.md rule "No CALL in RFI persona charts" is enforced by convention only. The generator validates entry count (169) and unknown notation, but never asserts that non-BB positions produce 0 CALL entries. A developer who accidentally adds `call: "A2s+"` to an MP position would see no error, and the resulting chart would contain CALL entries in a raise-first-in context.

## Findings

- `scripts/generate-charts.ts:386` — `callCount` is computed and logged per position, but never checked against a constraint
- Pattern reviewer identified this as a "High priority" gap
- The per-position log line (e.g., `GTO Grinder MP: 15R 0C 154F`) shows call count visually, but this is easy to miss in script output
- Rule is documented in MEMORY.md and PR description but not enforced in code

## Proposed Solutions

### Option A: Add assertion after callCount computation (Recommended)
In the validation loop at ~line 386, immediately after `callCount` is computed:
```typescript
if (callCount > 0 && pos !== "BB") {
  console.error(
    `ERROR: ${persona.name} ${pos} has ${callCount} CALL entries — CALL is only valid in BB`
  );
  process.exit(1);
}
```
**Pros:** Enforces the invariant in code, not docs. 4 lines.
**Effort:** Small
**Risk:** None

### Option B: Validate in RangeDef type by position
Use TypeScript to express that non-BB positions can't have a call field. Requires a discriminated union or two separate types (`BBRange` vs `RFIRange`).
**Pros:** Compile-time enforcement
**Cons:** More structural change, overengineered for a build script
**Effort:** Medium
**Risk:** Low

## Recommended Action

Option A — runtime assertion in the existing validation loop. Matches the style of the existing 169-count guard.

## Technical Details

- **File:** `scripts/generate-charts.ts`
- **Line:** ~386 (inside the `for pos of POSITIONS` loop, after callCount is computed)
- **Constraint:** `callCount === 0` for all positions except `"BB"`

## Acceptance Criteria

- [ ] Generator exits with error if any non-BB position has CALL entries
- [ ] All 4 existing personas pass validation (they all have empty call strings for non-BB)
- [ ] Error message clearly names the persona and position

## Work Log

- 2026-02-21: Created from PR #6 review. Identified by pattern reviewer (High priority) and corroborated by TypeScript reviewer.
