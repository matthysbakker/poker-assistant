---
status: pending
priority: p3
issue_id: "082"
tags: [code-review, typescript, type-safety, board-analyzer]
dependencies: []
---

# `betFractionFromWetScore` Parameter Typed as `number` Instead of `BoardTexture["wetScore"]`

## Problem Statement

`betFractionFromWetScore()` in `lib/poker/board-analyzer.ts` accepts `wetScore` as plain `number`. The actual field on `BoardTexture` is a narrower type (e.g., `0 | 1 | 2 | 3`). Using `number` allows callers to pass any numeric value and loses the discrete-range contract that the board analyzer enforces.

## Findings

- `betFractionFromWetScore(wetScore: number)` in `lib/poker/board-analyzer.ts`
- `BoardTexture.wetScore` has a discrete set of values (0–3 based on board wetness scoring)
- Using `number` means passing `99` or `-1` is a TypeScript no-op — the function silently clamps or returns an unexpected fraction
- A caller who accidentally passes `board.wetScore * 10` would see no compile-time error
- Review agent: kieran-typescript-reviewer

## Proposed Solutions

### Option 1: Use `BoardTexture["wetScore"]` (Recommended)

**Approach:** Change the parameter type to the indexed access type of `BoardTexture`.

```typescript
// Before:
export function betFractionFromWetScore(wetScore: number): number

// After:
export function betFractionFromWetScore(wetScore: BoardTexture["wetScore"]): number
```

If `BoardTexture.wetScore` is currently typed as `number`, also narrow it to a literal union:
```typescript
export interface BoardTexture {
  wetScore: 0 | 1 | 2 | 3;
  // ...
}
```

**Pros:**
- Callers that pass wrong values get compile-time errors
- Documents the valid range directly in the type

**Cons:**
- Minor refactor if `wetScore` field is currently `number` in `BoardTexture`

**Effort:** 30 minutes
**Risk:** Low

---

### Option 2: Add Runtime Range Check

**Approach:** Assert `wetScore >= 0 && wetScore <= 3` at the start of the function and clamp.

**Pros:** Defensive for runtime bypasses

**Cons:** Doesn't add compile-time safety; TypeScript's value proposition lost

**Effort:** 15 minutes
**Risk:** Low (but incomplete)

## Technical Details

**Affected files:**
- `lib/poker/board-analyzer.ts` — `betFractionFromWetScore()` signature, `BoardTexture` interface

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** kieran-typescript-reviewer

## Acceptance Criteria

- [ ] `BoardTexture.wetScore` is a literal union type (not `number`)
- [ ] `betFractionFromWetScore` parameter uses `BoardTexture["wetScore"]`
- [ ] All existing tests still pass

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
