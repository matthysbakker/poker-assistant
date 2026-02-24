---
status: pending
priority: p2
issue_id: "074"
tags: [code-review, performance, dom, poker-content]
dependencies: []
---

# `scrapeDealerSeat()` Runs 6 Full-Document Queries per Detection Tick for Stable Data

## Problem Statement

`scrapeDealerSeat()` in `poker-content.ts` executes 6 or more full `document.querySelector` calls on every detection tick to find the dealer button position. The dealer seat changes at most once per hand (~every 30–90 seconds), so re-querying it on every 1-second tick is wasteful.

## Findings

- `scrapeDealerSeat()` called every detection frame in continuous capture mode
- Performs 6 querySelector calls (one per seat candidate) every invocation
- Dealer position is stable for the entire duration of a hand — only changes between hands
- Unnecessary repeated work contributes to slow detection ticks
- Review agent: performance-oracle

## Proposed Solutions

### Option 1: Cache Dealer Seat Per Hand (Recommended)

**Approach:** Store the detected dealer seat in a module-level variable. Reset to `null` in `resetHandState()`. Only re-query if the cached value is null.

```typescript
let cachedDealerSeat: number | null = null;

function scrapeDealerSeat(): number | null {
  if (cachedDealerSeat !== null) return cachedDealerSeat;
  // … full query …
  cachedDealerSeat = result;
  return result;
}

function resetHandState() {
  cachedDealerSeat = null;
  // … rest of reset
}
```

**Pros:**
- At most one query set per hand
- Zero change to observable behaviour

**Cons:**
- Must ensure `resetHandState()` is called on every new hand (already the case)

**Effort:** 30 minutes
**Risk:** Low

---

### Option 2: Single querySelector with Attribute Selector

**Approach:** Replace 6 individual queries with one `querySelector("[data-dealer], .dealer-button, ...")` using a broad selector.

**Pros:** Single DOM access per tick instead of 6

**Cons:** Still queries every tick

**Effort:** 30 minutes
**Risk:** Low

## Technical Details

**Affected files:**
- `extension/src/poker-content.ts` — `scrapeDealerSeat()`, `resetHandState()`

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** performance-oracle

## Acceptance Criteria

- [ ] `scrapeDealerSeat()` does not query DOM if result already cached for this hand
- [ ] Cache invalidated on new hand start
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
