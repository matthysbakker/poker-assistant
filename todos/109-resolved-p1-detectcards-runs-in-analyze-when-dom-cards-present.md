---
status: pending
priority: p1
issue_id: "109"
tags: [code-review, performance, api]
---

# Full detectCards() runs in /api/analyze even when DOM cards cover all fields

## Problem Statement
In continuous mode (the dominant code path), the client sends `heroPosition` and DOM-scraped cards via `handContext`. Despite this, `/api/analyze` always runs the full `detectCards()` pipeline — consuming 50-150ms of Sharp processing before the Claude call — even though the only value it extracts afterward is `heroPosition`, which is already in the request body.

## Findings
- `app/api/analyze/route.ts:109-114` — `detection = await detectCards(parsed.data.image)` runs unconditionally
- `app/api/analyze/route.ts:119` — `heroPosition` is the only thing extracted from `detection` when DOM cards are present
- `requestSchema:65` — `heroPosition` is already a validated field in the request body
- `parseDomCards()` at line 101 extracts both hero and community cards from handContext

## Proposed Fix
Skip detection when `heroPosition` is already provided:
```typescript
let detection: DetectionResult | null = null;
if (!parsed.data.heroPosition) {
  try {
    detection = await detectCards(parsed.data.image);
  } catch (err) {
    console.error("[card-detection] Failed:", err);
  }
}
```
Use `parsed.data.heroPosition` directly as the position source when detection is skipped.

## Files
- `app/api/analyze/route.ts:108-114` and position extraction at line 119

## Acceptance Criteria
- [ ] Detection skipped when `heroPosition` is present in request
- [ ] `heroPosition` from request body used as fallback source
- [ ] Manual mode (no heroPosition in body) still runs detection normally
- [ ] Response unchanged for both code paths
