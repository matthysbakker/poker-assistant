---
status: pending
priority: p2
issue_id: "112"
tags: [code-review, performance, storage]
---

# localStorage hand history is unbounded — JSON.parse blocks main thread at scale

## Problem Statement
`saveHand` in `lib/storage/hands.ts` always appends and never trims. Thumbnails are ~20-50KB each in base64. After 100 hands the stored blob is ~5MB. `JSON.parse` and `JSON.stringify` on 5MB blocks the main thread for 50-100ms. At 200+ hands this risks hitting browser localStorage quotas (5-10MB). `deleteHand` repeats the full parse/stringify cycle.

## Findings
- `lib/storage/hands.ts:35-37` — `getStoredHands()` (full JSON.parse) + `unshift` + `setItem` (full JSON.stringify) on every save
- No cap exists in `saveHand`
- `deleteHand` at line 43 repeats the same full parse/stringify cycle
- Main thread blocked during parse — causes visible jank during active sessions

## Proposed Fix
Add a `MAX_HANDS = 50` constant. In `saveHand`, after `unshift`, trim to `MAX_HANDS`:
```typescript
const MAX_HANDS = 50;
hands.unshift(hand);
if (hands.length > MAX_HANDS) hands.length = MAX_HANDS;
```

## Files
- `lib/storage/hands.ts:35-37`

## Acceptance Criteria
- [ ] `saveHand` trims to MAX_HANDS=50 after insert
- [ ] Existing hands load correctly (no crash if >50 already stored)
- [ ] HandHistory component renders correctly with trimmed history
