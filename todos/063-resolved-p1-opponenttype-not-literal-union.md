---
status: pending
priority: p1
issue_id: "063"
tags: [code-review, typescript, exploit, type-safety]
dependencies: []
---

# `opponentType` Typed as `string` Instead of Literal Union — Silent Typo Pass-Through

## Problem Statement

`applyExploitAdjustments()` in `lib/poker/exploit.ts` accepts `opponentType` as `string | undefined`. The `DELTAS` table uses a `Record<string, ...>` lookup. If a typo is passed (e.g., `"LOOSE_PASIVE"` instead of `"LOOSE_PASSIVE"`), it silently falls through to the `UNKNOWN` path, misclassifying the opponent and applying wrong adjustments with no compile-time error.

## Findings

- `exploit.ts` function signature: `opponentType: string | undefined`
- `DELTAS` object keyed by plain strings: `LOOSE_PASSIVE`, `TIGHT_AGGRESSIVE`, etc.
- TypeScript cannot catch `"LOOSE_PASIVE"` passed as `opponentType`
- `opponentTypeFromTemperature()` in `poker-content.ts` maps DOM strings to these keys — a future edit to either the map or the key constants could silently desync
- Existing tests pass the correct strings, so incorrect strings are not caught by tests either
- Location: `lib/poker/exploit.ts:1`, `extension/src/poker-content.ts` `opponentTypeFromTemperature()`

## Proposed Solutions

### Option 1: Export a Literal Union Type (Recommended)

**Approach:** Define and export a `PlayerExploitType` literal union, use it in the function signature and `DELTAS` record.

```typescript
// lib/poker/exploit.ts
export type PlayerExploitType =
  | "LOOSE_PASSIVE"
  | "TIGHT_AGGRESSIVE"
  | "LOOSE_AGGRESSIVE"
  | "TIGHT_PASSIVE"
  | "UNKNOWN";

const DELTAS: Record<PlayerExploitType, ...> = { ... };

export function applyExploitAdjustments(
  base: LocalDecision,
  opponentType: PlayerExploitType | undefined,
  ...
```

**Pros:**
- Compile-time safety for all callers
- IDE autocomplete on the type
- Aligns with `RuleTreeInput.opponentType` if that field is also updated

**Cons:**
- Minor refactor needed in `opponentTypeFromTemperature()` return type

**Effort:** 1 hour
**Risk:** Low

---

### Option 2: Add Runtime Assertion

**Approach:** Keep `string` type, add `console.warn` when unknown type encountered.

**Pros:** Easier merge

**Cons:** No compile-time safety — TypeScript's whole value proposition lost

**Effort:** 30 minutes
**Risk:** Medium (silent bugs can still reach production)

## Technical Details

**Affected files:**
- `lib/poker/exploit.ts` — function signature, `DELTAS` type
- `extension/src/poker-content.ts` — `opponentTypeFromTemperature()` return type
- `lib/poker/rule-tree.ts` — `RuleTreeInput.opponentType` field type
- `lib/poker/__tests__/exploit.test.ts` — update test types

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** kieran-typescript-reviewer (C-1)

## Acceptance Criteria

- [ ] TypeScript errors on invalid `opponentType` strings
- [ ] `opponentTypeFromTemperature()` return type matches `PlayerExploitType | undefined`
- [ ] All existing tests still pass
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
