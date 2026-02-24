---
status: pending
priority: p3
issue_id: "078"
tags: [code-review, simplicity, poker-content, typescript]
dependencies: []
---

# `opponentTypeFromTemperature()` Used Once — Could Be an Inline Const Map

## Problem Statement

`opponentTypeFromTemperature()` in `poker-content.ts` is a named function used at a single call site. The function body is a simple object lookup (`map[dominantType]`). Defining it as a named function adds indirection without benefit.

## Findings

- `extension/src/poker-content.ts` defines `opponentTypeFromTemperature(temp)` as a standalone function
- Called in one place: inside `localDecide()`
- Body is essentially: `const map = {...}; return map[temp?.dominantType]`
- Review agent: code-simplicity-reviewer

## Proposed Solutions

### Option 1: Inline as a Const Map at Call Site

**Approach:** Replace the function with a module-level const map and inline the lookup.

```typescript
const TEMPERATURE_TO_OPPONENT: Record<string, string> = {
  loose_passive: "LOOSE_PASSIVE",
  tight_passive: "TIGHT_PASSIVE",
  loose_aggressive: "LOOSE_AGGRESSIVE",
  tight_aggressive: "TIGHT_AGGRESSIVE",
};

// In localDecide():
const opponentType = lastTableTemperature
  ? TEMPERATURE_TO_OPPONENT[lastTableTemperature.dominantType]
  : undefined;
```

**Pros:**
- Const map is still named and readable
- Removes function boilerplate

**Cons:**
- Slightly different structure; matters only stylistically

**Effort:** 15 minutes
**Risk:** Low

## Technical Details

**Affected files:**
- `extension/src/poker-content.ts`

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** code-simplicity-reviewer

## Acceptance Criteria

- [ ] `opponentTypeFromTemperature()` function removed
- [ ] Mapping logic replaced with const object
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
