---
status: pending
priority: p2
issue_id: "070"
tags: [code-review, typescript, stale-state, poker-content]
dependencies: []
---

# `lastTableTemperature` Never Reset on New Hand

## Problem Statement

`lastTableTemperature` is a module-level variable in `poker-content.ts` that stores the most recently scraped VPIP/AF table temperature. It is never reset when a new hand starts. If the poker session moves to a new table or the stats reset on the site, `lastTableTemperature` retains stale data, causing exploit adjustments to be applied with an opponent profile from a previous table.

## Findings

- `lastTableTemperature` set only in `requestPersona()` after `deriveTemperatureFromDomStats()` succeeds
- Never cleared on hand reset (`resetHandState()`), table change, or `AUTOPILOT_MODE` transition
- If VPIP scraping fails for a few frames, stale temperature remains active indefinitely
- `handsObserved` proxy from stale temperature would overstate sample confidence
- Location: `extension/src/poker-content.ts` — module-level `let lastTableTemperature`

## Proposed Solutions

### Option 1: Reset in `resetHandState()` (Recommended)

**Approach:** Add `lastTableTemperature = null;` to the existing `resetHandState()` function (or the hand-reset logic).

```typescript
function resetHandState() {
  lastTableTemperature = null;
  // … existing reset logic
}
```

**Pros:**
- Clean hand boundary
- `localDecide()` falls back to UNKNOWN exploit type (safest)

**Cons:**
- Temperature scrape must complete before first localDecide call in new hand

**Effort:** 15 minutes
**Risk:** Low

---

### Option 2: Add Temperature TTL (Time-to-Live)

**Approach:** Store a timestamp alongside the temperature; treat as null if older than 30 seconds.

```typescript
type TemperatureWithAge = { temp: TableTemperatureLocal; ts: number };
let lastTemperatureWithAge: TemperatureWithAge | null = null;

function getTemperature() {
  if (!lastTemperatureWithAge) return null;
  if (Date.now() - lastTemperatureWithAge.ts > 30_000) return null;
  return lastTemperatureWithAge.temp;
}
```

**Pros:**
- Handles cases where `resetHandState()` isn't called (e.g., table tab switch)

**Cons:**
- More complex; 30s TTL may need tuning

**Effort:** 1 hour
**Risk:** Low

## Technical Details

**Affected files:**
- `extension/src/poker-content.ts` — `lastTableTemperature` variable, `resetHandState()`

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** kieran-typescript-reviewer (finding 3)

## Acceptance Criteria

- [ ] `lastTableTemperature` is null at start of each new hand
- [ ] `localDecide()` treats null temperature as UNKNOWN opponent type
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
