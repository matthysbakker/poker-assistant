---
status: pending
priority: p3
issue_id: "104"
tags: [code-review, simplicity, cleanup, preflop]
dependencies: []
---

# Simplify bbTag Expression and Hoist SUIT_NAMES to Module Scope

## Problem Statement

Three simplification issues in the preflop/suit-tag code:

1. `bbTag` calls `parseCurrency(state.pot)` twice and recomputes `bb` from scratch inside the expression when both values are already in scope.
2. `preflopAmount` is an unnecessary nullable variable — the value is computed and immediately formatted; a single block suffices.
3. `SUIT_NAMES` is declared inside `buildHandStartMessage()` on every call, allocating a 4-entry object each time. It should be a module-level constant alongside `SUIT_MAP`.

## Findings

From code-simplicity-reviewer:

**Issue 1 & 2** (`processGameState`, ~lines 1389-1403):
```typescript
// Current — parseCurrency called twice, bb recomputed
const bbTag = preflopAmount != null && parseCurrency(state.pot) > 0
  ? ` (${(preflopAmount / (parseCurrency(state.pot) / 1.5)).toFixed(1)}BB)`
  : "";
```
`preflopAmount / (parseCurrency(state.pot) / 1.5)` equals `multiplier` which is already in scope.

**Issue 3** (`buildHandStartMessage`, ~line 618):
```typescript
// Current — new object every call
const SUIT_NAMES: Record<string, string> = { d: "diamonds", h: "hearts", s: "spades", c: "clubs" };
```

## Proposed Solutions

### Simplify bbTag block
```typescript
let bbTag = "";
if (personaAction === "RAISE" || personaAction === "BET") {
  const pot = parseCurrency(state.pot);
  if (pot > 0) {
    const bb = pot / 1.5;
    const activePlayers = ...;
    const pos = ...;
    const multiplier = ["BTN", "CO"].includes(pos) ? 2.5 : 3.0;
    const preflopAmount = Math.round(bb * multiplier * 100) / 100;
    bbTag = ` (${multiplier.toFixed(1)}BB)`;
    // pass preflopAmount to safeExecuteAction below
  }
}
```

This removes: the nullable `preflopAmount` variable, 2 extra `parseCurrency` calls, the redundant `pot > 0` guard in the ternary, and the recomputed `bb`. Saves ~4 lines.

### Hoist SUIT_NAMES
Move to module scope near `SUIT_MAP`:
```typescript
const SUIT_NAMES: Record<string, string> = { d: "diamonds", h: "hearts", s: "spades", c: "clubs" };
```

## Technical Details

- File: `extension/src/poker-content.ts`
- Lines: ~618 (SUIT_NAMES), ~1389-1403 (bbTag)

## Acceptance Criteria

- [ ] `parseCurrency` called at most once per preflop fast-path execution
- [ ] `SUIT_NAMES` defined at module scope
- [ ] Behavior identical to before (same raise amounts, same log output)

## Work Log

- 2026-02-24: Found by code-simplicity-reviewer and kieran-typescript-reviewer during review of b24f0a9..b81eda6.
