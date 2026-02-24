---
status: pending
priority: p2
issue_id: "076"
tags: [code-review, race-condition, poker-content, stale-state]
dependencies: ["070"]
---

# `lastTableTemperature` Null When `localDecide()` Called Mid-Session

## Problem Statement

`localDecide()` reads `lastTableTemperature` which may still be `null` if the persona/temperature scrape hasn't completed yet when the first `heroTurn` fires. This is especially likely early in a session when `requestPersona()` hasn't been called yet, or after a table change mid-session. In this case the exploit layer silently runs with `opponentType = undefined` (UNKNOWN) and `handsObserved = 0`, giving no exploit signal.

## Findings

- `localDecide()` is called synchronously when `heroTurn` flips true
- `requestPersona()` is called at the same trigger point, but it is async (network call)
- `lastTableTemperature` is set inside `requestPersona()` after the async call returns
- First few `localDecide()` calls in a session will always see `lastTableTemperature = null`
- This is expected behaviour (degrades gracefully to UNKNOWN/0 hands), but not documented or tested
- Related to todo #070 (temperature not reset on new hand)
- Review agent: julik-frontend-races-reviewer (RACE-4)

## Proposed Solutions

### Option 1: Document as Intended Behaviour (Recommended for Now)

**Approach:** Add a comment in `localDecide()` noting that `lastTableTemperature` may be null early in session and the UNKNOWN fallback is intentional.

**Pros:**
- Zero code change
- Current behaviour is correct (UNKNOWN exploit = conservative)

**Cons:**
- Doesn't fix the underlying data race — just documents it

**Effort:** 5 minutes
**Risk:** Low

---

### Option 2: Separate Temperature Scrape from Persona Request

**Approach:** Scrape VPIP/AF synchronously from DOM before calling the async persona API, so `lastTableTemperature` is always populated before `localDecide()` reads it.

```typescript
function localDecide() {
  // Scrape temperature synchronously right now if stale
  if (!lastTableTemperature) {
    lastTableTemperature = scrapeDomTemperature();
  }
  // … rest of localDecide
}
```

**Pros:**
- `lastTableTemperature` always populated when needed

**Cons:**
- Synchronous DOM scrape on every `localDecide()` call (minor perf cost)

**Effort:** 1 hour
**Risk:** Low

## Technical Details

**Affected files:**
- `extension/src/poker-content.ts` — `localDecide()`, `requestPersona()`

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** julik-frontend-races-reviewer (RACE-4)
- **Related todo:** #070

## Acceptance Criteria

- [ ] Behaviour when `lastTableTemperature` is null is explicitly documented
- [ ] OR: temperature is guaranteed populated before `localDecide()` reads it
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
