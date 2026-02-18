---
status: pending
priority: p2
issue_id: "010"
tags: [code-review, type-safety]
---

# heroCards/communityCards use string[] instead of CardCode[]

## Problem Statement
The hand-tracking types use `string[]` for card arrays, losing the `CardCode` type safety that exists in the card-detection layer. If a non-card string is pushed into these arrays, nothing catches it at compile time.

## Findings
- `lib/hand-tracking/types.ts` lines 7-8 and 18-20: `heroCards: string[]`
- `CardCode` type (`${Rank}${Suit}`) exists in `lib/card-detection/types.ts`
- The `cardCodes()` function in `state-machine.ts` also returns `string[]`

## Proposed Fix
Import `CardCode` from `lib/card-detection/types` and use `CardCode[]` in StreetSnapshot, HandState, and cardCodes return type.
