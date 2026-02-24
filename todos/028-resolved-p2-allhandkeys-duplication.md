---
status: pending
priority: p2
issue_id: "028"
tags: [code-review, duplication, correctness, persona-generator]
dependencies: []
---

# `allHandKeys` Function Duplicated in Generator and hand-notation.ts

## Problem Statement

The `allHandKeys()` function is defined identically in two files. They use the same rank string and the same nested loop to produce all 169 hand keys. If the hand ordering logic ever changes in `lib/poker/hand-notation.ts` (e.g., to produce suit-aware keys or change ordering), `scripts/generate-charts.ts` won't be updated automatically. The generated chart keys would then silently mismatch the lookup keys used at runtime.

## Findings

**`scripts/generate-charts.ts` lines 15, 20-33:**
```typescript
const RANKS = "AKQJT98765432";
function allHandKeys(): string[] {
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i; j < RANKS.length; j++) {
```

**`lib/poker/hand-notation.ts` lines 11, 58-71:**
```typescript
const RANK_ORDER = "AKQJT98765432";
export function allHandKeys(): string[] {
  for (let i = 0; i < RANK_ORDER.length; i++) {
    for (let j = i; j < RANK_ORDER.length; j++) {
```

Even the constant name differs (`RANKS` vs `RANK_ORDER`), hiding that they are the same concept. Flagged by TypeScript reviewer (Low), simplicity reviewer (Medium: "correctness risk"), and pattern reviewer (Medium).

## Proposed Solutions

### Option A: Import from hand-notation.ts (Recommended)
Since the generator runs with `bun` (not the browser), it can import from lib:
```typescript
import { allHandKeys } from "../lib/poker/hand-notation";
const ALL_HANDS = allHandKeys();
```
Remove the local `allHandKeys` definition and the local `RANKS` constant (if only used by that function).

**Pros:** Single source of truth, eliminates drift risk
**Cons:** Creates a dev-time dependency from scripts/ on lib/ — but this already exists semantically
**Effort:** Small (-14 LOC)
**Risk:** Low

### Option B: Extract to shared scripts/lib/hand-keys.ts
Create `scripts/lib/hand-keys.ts` with the function, import it in both `generate-charts.ts` and use the same source in tests.
**Pros:** Clean architectural separation
**Cons:** More files for a simple function
**Effort:** Medium
**Risk:** Low

### Option C: Add cross-reference comments only
Leave both implementations but add:
```typescript
// NOTE: This must match allHandKeys() in lib/poker/hand-notation.ts
// The generator cannot import lib/ modules at build time.
```
**Pros:** Zero code change
**Cons:** Doesn't prevent drift, just makes it visible
**Effort:** 2 comments
**Risk:** Low

## Recommended Action

Option A — import from hand-notation.ts. The generator already runs in Node.js/Bun context, so the import is valid.

## Technical Details

- **Files:** `scripts/generate-charts.ts` (lines 15, 20-33), `lib/poker/hand-notation.ts` (lines 11, 58-71)
- Must verify `allHandKeys` is exported from `hand-notation.ts` (it is: `export function allHandKeys()`)

## Acceptance Criteria

- [ ] `allHandKeys` defined in exactly one place
- [ ] Generator imports it rather than redefining it
- [ ] `bun run generate-charts` produces identical output to current

## Work Log

- 2026-02-21: Created from PR #6 review. Flagged by simplicity reviewer and pattern reviewer as Medium priority correctness risk.
