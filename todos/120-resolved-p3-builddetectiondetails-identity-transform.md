---
status: pending
priority: p3
issue_id: "120"
tags: [code-review, simplicity, code-quality]
---

# buildDetectionDetails is an identity transform — 27 LOC of unnecessary abstraction

## Problem Statement
`DetectionDetail` is `CardMatch` plus a `group` tag. `mapMatchToDetail` copies every field. `buildDetectionDetails` iterates both arrays and calls the mapper. Nothing reads `DetectionDetail[]` at runtime for any logic — it is only serialized to disk for debugging. This is a premature normalization for an analytics use case that doesn't exist.

## Findings
- `lib/storage/hand-records.ts:58-84` — `DetectionDetail`, `mapMatchToDetail`, `buildDetectionDetails`
- `app/api/analyze/route.ts:207` — `detectionDetails: buildDetectionDetails(detection)` is the only call site
- `HandRecord.detectionDetails` is stored to JSON but never read back by any code
- ~27 LOC of boilerplate for a field that only exists in debug files

## Proposed Fix
Option A (recommended): Drop `DetectionDetail`, `mapMatchToDetail`, and `buildDetectionDetails`. Store raw detection arrays directly:
```typescript
// In HandRecord type
heroCards: CardMatch[] | null;
communityCards: CardMatch[] | null;
```
Call site becomes: `heroCards: detection?.heroCards ?? null`.

Option B: Remove the field entirely — JSON debug files are sufficient without the group tag.

## Files
- `lib/storage/hand-records.ts:47-84`
- `app/api/analyze/route.ts:207`

## Acceptance Criteria
- [ ] `buildDetectionDetails` and `DetectionDetail` type removed
- [ ] `HandRecord` stores raw `CardMatch[]` or drops the field
- [ ] TypeScript compiles without errors
