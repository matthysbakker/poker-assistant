---
status: pending
priority: p2
issue_id: "064"
tags: [code-review, security, autopilot, stale-state]
dependencies: []
---

# FOLD→CHECK Fallback Reads Stale `lastState` Instead of Live DOM

## Problem Statement

When the autopilot decides to FOLD but the FOLD button is absent (e.g., no bet facing), it falls back to CHECK. The fallback reads `lastState` (a cached snapshot) to decide this, rather than querying the live DOM. If `lastState` is stale (captured before a state transition), the fallback may take the wrong action or attempt a DOM operation on a button that no longer exists.

## Findings

- In `poker-content.ts`, FOLD→CHECK fallback logic uses `lastState.facingBet` or similar field
- `lastState` is set during `feedDetection()` on each captured frame — may be 1–2 seconds old by the time `executeAction()` runs
- A real bet could have arrived in that window, or the street could have advanced
- CHECK button existence should be verified against the live DOM at the moment of execution, not against a cached state
- Location: `extension/src/poker-content.ts` — FOLD fallback inside `executeAction()`

## Proposed Solutions

### Option 1: Live DOM Query at Execution Time (Recommended)

**Approach:** When falling back from FOLD to CHECK, query `document.querySelector("[data-action='check']")` (or the actual selector) live at execution time rather than reading `lastState`.

**Pros:**
- Always reflects current DOM state
- Simple change

**Cons:**
- Must know the correct selector for CHECK button

**Effort:** 1 hour
**Risk:** Low

---

### Option 2: Re-validate lastState Freshness

**Approach:** Record a timestamp when `lastState` is set; reject if older than 3s at execution time.

**Pros:** Catch-all staleness guard

**Cons:** Doesn't fix the underlying read of stale data — still uses cached values

**Effort:** 30 minutes
**Risk:** Medium

## Technical Details

**Affected files:**
- `extension/src/poker-content.ts` — FOLD→CHECK fallback in `executeAction()`

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** security-sentinel (H-1)

## Acceptance Criteria

- [ ] CHECK fallback verifies CHECK button exists in live DOM before clicking
- [ ] No stale-state reads in `executeAction()` action path
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
