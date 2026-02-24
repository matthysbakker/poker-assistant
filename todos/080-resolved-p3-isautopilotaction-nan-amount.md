---
status: pending
priority: p3
issue_id: "080"
tags: [code-review, typescript, type-safety, autopilot]
dependencies: []
---

# `isAutopilotAction` Type Guard Doesn't Exclude `NaN` from `amount`

## Problem Statement

The `isAutopilotAction()` type guard (or equivalent validation in `background.ts`) checks that `action.amount` is `null` or `typeof amount === "number"`. `typeof NaN === "number"` is true in JavaScript, so a response containing `{"amount": null + NaN}` or a malformed API response with `NaN` passes the guard. Downstream code that does arithmetic on `action.amount` would then produce `NaN` silently.

## Findings

- `background.ts` line ~96: `action.amount !== null && typeof action.amount !== "number"` — does not exclude NaN
- `Number.isFinite()` correctly rejects `NaN` and `Infinity`; `typeof` does not
- A malformed `/api/autopilot` response with `{"amount": null}` is handled, but `{"amount": NaN}` is not
- Review agent: kieran-typescript-reviewer

## Proposed Solutions

### Option 1: Replace `typeof` Check with `Number.isFinite()`

**Approach:**

```typescript
// Before:
action.amount !== null && typeof action.amount !== "number"

// After:
action.amount !== null && !Number.isFinite(action.amount)
```

**Pros:**
- Correctly rejects NaN and Infinity
- One-line change

**Cons:**
- None

**Effort:** 10 minutes
**Risk:** Low

## Technical Details

**Affected files:**
- `extension/dist/background.js` / `extension/src/background.ts` — `fetchAutopilotDecision()` validation (~line 96)

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** kieran-typescript-reviewer

## Acceptance Criteria

- [ ] `NaN` amount fails validation and triggers fallback
- [ ] Valid numeric amount still passes
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
