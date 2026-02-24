---
status: pending
priority: p2
issue_id: "114"
tags: [code-review, architecture, code-quality]
---

# Card-priority override logic duplicated with divergent placeholder behaviour

## Problem Statement
The DOM-vs-image card priority logic runs twice in `app/api/analyze/route.ts`: once to build `detectedCards` for Claude (lines 116-146) and again inside `.then()` to enforce ground truth in the stored record (lines 175-197). The two blocks are nearly identical but diverge: the storage path adds `??` placeholders for missing hero cards; the Claude path does not. This means Claude sees different data than what gets stored.

## Findings
- `app/api/analyze/route.ts:116-146` — first pass: builds `detectedCards` for Claude prompt
- `app/api/analyze/route.ts:175-197` — second pass (inside `.then()`): overrides stored record fields
- The filter chain `.filter(m => HIGH|MEDIUM).map(m => m.card).filter(Boolean).join(" ")` appears 3× verbatim
- Placeholder `??.repeat(2 - count)` logic only exists in storage path — semantic divergence
- See simplicity review (todo P1-A): ~30 LOC of deduplication opportunity

## Proposed Fix
Extract a single `resolveCards(domCards, detection, addPlaceholders = false)` helper:
```typescript
function resolveCards(domCards: { heroCards: string[], communityCards: string[] }, detection: DetectionResult | null, addPlaceholders = false) {
  const hero = domCards.heroCards.length > 0
    ? domCards.heroCards.join(" ")
    : extractConfident(detection?.heroCards ?? [], addPlaceholders);
  const board = domCards.communityCards.length > 0
    ? domCards.communityCards.join(" ")
    : extractConfident(detection?.communityCards ?? []);
  return { hero, board };
}
```
Call once for Claude (no placeholders) and once for storage (with placeholders).

## Files
- `app/api/analyze/route.ts:116-197`

## Acceptance Criteria
- [ ] Single `resolveCards` helper used for both Claude and storage paths
- [ ] Placeholder behaviour made explicit and documented
- [ ] Claude and stored record use same card data (or intentional difference is documented)
