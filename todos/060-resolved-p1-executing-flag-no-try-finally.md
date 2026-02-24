---
status: pending
priority: p1
issue_id: "060"
tags: [code-review, race-condition, autopilot, javascript]
dependencies: []
---

# `executeAction()` Missing try/finally — `executing` Permanently Locks on Exception

## Problem Statement

`executeAction()` in `poker-content.ts` sets `executing = true` at the start but has no `try/finally` block. If any DOM query throws (e.g., the raise input is unexpectedly absent), `executing` is never reset to `false`, permanently locking the autopilot and preventing any further actions for the remainder of the session.

## Findings

- `executeAction()` sets `executing = true` on entry
- If `document.querySelector()` returns null and code does `.value = ...` on it → TypeError thrown
- No try/finally → `executing` stays `true` forever
- Autopilot silently stops functioning; no badge update, no error shown to user
- Location: `extension/src/poker-content.ts` in `executeAction()`
- This bug is distinct from the watchdog race (todo #059) but the fix is complementary

## Proposed Solutions

### Option 1: Wrap with try/finally (Recommended)

**Approach:** Wrap the entire body of `executeAction()` in `try { … } finally { executing = false; }`.

```typescript
async function executeAction(action: AutopilotAction): Promise<void> {
  executing = true;
  try {
    // … all DOM manipulation
  } finally {
    executing = false;
  }
}
```

**Pros:**
- Guarantees `executing` is always reset regardless of exit path
- Standard JS async pattern

**Cons:**
- None

**Effort:** 30 minutes
**Risk:** Low

---

### Option 2: Null-guard every DOM query and return early

**Approach:** Add null checks before every `querySelector` use, return gracefully on null.

**Pros:** Makes null cases explicit with logging

**Cons:** Doesn't protect against unanticipated throw sites; `try/finally` is still recommended as a safety net

**Effort:** 1–2 hours
**Risk:** Low (but incomplete without Option 1)

## Technical Details

**Affected files:**
- `extension/src/poker-content.ts` — `executeAction()`

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** julik-frontend-races-reviewer (RACE-1)
- **Related todo:** #059 (watchdog race)

## Acceptance Criteria

- [ ] `executing` is always reset after `executeAction()` returns, including on exception
- [ ] Error is logged to console when exception occurs
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
