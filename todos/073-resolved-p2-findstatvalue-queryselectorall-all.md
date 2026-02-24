---
status: pending
priority: p2
issue_id: "073"
tags: [code-review, performance, dom, poker-content]
dependencies: []
---

# `findStatValue()` Runs `querySelectorAll("*")` on Every Call — O(n) DOM Walk per Player per Tick

## Problem Statement

`findStatValue()` (used to scrape VPIP/AF from the casino DOM) calls `querySelectorAll("*")` — a full document traversal — on every invocation, for every player seat, on every detection tick (every 1–2 seconds). On a table with 6 players this is 6+ full DOM traversals per tick, degrading frame rate during continuous capture.

## Findings

- `extension/src/poker-content.ts` `findStatValue()` (or similar helper): calls `el.querySelectorAll("*")` or `document.querySelectorAll("*")`
- Called once per player seat in the stat-scraping loop
- 6 players × 1000 DOM nodes = ~6000 node visits per tick, every 1–2 seconds
- Review agent: performance-oracle flagged this as unnecessary
- The stats area is a small DOM subtree — a targeted selector should find the values directly

## Proposed Solutions

### Option 1: Targeted Selector (Recommended)

**Approach:** Replace `querySelectorAll("*")` with a specific selector for the stat label elements (e.g., `".player-stats [data-stat-label]"` or the actual class observed on the casino site).

**Pros:**
- O(1) lookup vs O(n) traversal
- Minimal change

**Cons:**
- Requires identifying the correct CSS selector (needs inspection of casino DOM)

**Effort:** 1 hour (including selector investigation)
**Risk:** Low

---

### Option 2: Cache Stat Elements

**Approach:** Query stat elements once per hand start and cache the NodeList. Invalidate cache on hand reset.

**Pros:**
- Zero DOM queries during normal play

**Cons:**
- Cache invalidation complexity if DOM changes between hands

**Effort:** 2 hours
**Risk:** Medium

## Technical Details

**Affected files:**
- `extension/src/poker-content.ts` — `findStatValue()` or inline stat-scraping logic

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** performance-oracle

## Acceptance Criteria

- [ ] No `querySelectorAll("*")` calls in stat-scraping path
- [ ] Stats still scraped correctly in continuous capture mode
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
