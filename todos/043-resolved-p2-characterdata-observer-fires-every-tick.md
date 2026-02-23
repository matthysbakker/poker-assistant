---
status: pending
priority: p2
issue_id: "043"
tags: [code-review, performance, autopilot, mutation-observer]
dependencies: []
---

# `characterData: true` Observer Fires on Every Timer Tick, Causing Continuous DOM Rescrapes

## Problem Statement

The MutationObserver is configured with `characterData: true` which fires for every text node character change in the entire `.table-area` subtree. On an animated poker table (countdown timer decrementing every second, chip animations, live text updates) this produces tens to hundreds of observer callbacks per second, each resetting the 200ms debounce and scheduling a full `processGameState()` call (50-60 DOM queries).

## Findings

- `extension/src/poker-content.ts:862-867` — observer config includes `characterData: true`
- `extension/src/poker-content.ts:741-746` — 200ms debounce; timer ticks every 1000ms reset debounce repeatedly → near-continuous scraping during player turns
- Performance review (2026-02-23, H1): "On an animated poker table this produces tens to hundreds of observer callbacks per second"
- Combined with todo 032 (checkbox mutation loop), the two issues compound into: timer tick → scrape → clear checkbox → re-tick → scrape → ...

## Proposed Solutions

### Option A: Remove `characterData: true`, add `attributeFilter` (Recommended)
```typescript
observer.observe(tableArea, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["class"],  // only watch class attribute changes (visibility toggles)
  // characterData: removed — we don't need to watch text node content changes
});
```
`scrapeTimer()` uses `querySelector` which reads the current text at scrape time — we don't need to trigger on every character change.
**Pros:** Eliminates hundreds of spurious callbacks; `class` filter handles `pt-visibility-hidden` toggles
**Cons:** May miss non-class attribute signals; needs testing against Playtech client
**Effort:** Small (2-line change in observer config)
**Risk:** Low — worth testing in monitor mode to confirm no state signals are missed

### Option B: Remove only `characterData: true`
```typescript
observer.observe(tableArea, {
  subtree: true,
  childList: true,
  attributes: true,  // keep broad attribute watching
});
```
**Pros:** Removes the worst offender with minimal change
**Cons:** Still watches all attribute changes (but not character-level changes)
**Effort:** 1 line deletion
**Risk:** None

### Option C: Status quo
**Pros:** Maximum coverage
**Cons:** High CPU; continuous scraping during timer countdown; compounds with mutation loop (todo 032)
**Risk:** Performance issues on slow machines

## Recommended Action

Option B first (immediate safe improvement), then refine to Option A after monitoring which signals are actually used.

## Technical Details

- **File:** `extension/src/poker-content.ts:862-867`
- `scrapeTimer()` at line 296 reads `.countdown-text` text at scrape time — no need for characterData observation

## Acceptance Criteria

- [ ] `characterData: true` removed from observer configuration
- [ ] State detection still works: hero turn, new cards, pot changes, folds all trigger correctly
- [ ] CPU usage during active play is measurably lower (test in monitor mode)

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by performance-oracle (H1). Compounds with mutation loop (todo 032).
