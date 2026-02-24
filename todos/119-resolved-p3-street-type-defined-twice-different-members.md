---
status: pending
priority: p3
issue_id: "119"
tags: [code-review, code-quality, types]
---

# Street type defined in two files with different members

## Problem Statement
`Street` is defined twice with different members: `lib/poker/types.ts` excludes `"WAITING"` while `lib/hand-tracking/types.ts` includes it. Importing from the wrong module silently accepts or rejects `"WAITING"` values.

## Findings
- `lib/poker/types.ts:2` — `"PREFLOP" | "FLOP" | "TURN" | "RIVER"` (no WAITING)
- `lib/hand-tracking/types.ts:6` — same 4 + `"WAITING"`
- Architecture review recommends renaming the hand-tracking variant to `HandPhase`

## Proposed Fix
Rename `Street` in `lib/hand-tracking/types.ts` to `HandPhase`. Update all usages in `state-machine.ts`, `use-hand-tracker.ts`, `use-continuous-capture.ts`.

## Files
- `lib/hand-tracking/types.ts:6`
- `lib/hand-tracking/state-machine.ts`
- `lib/hand-tracking/use-hand-tracker.ts`

## Acceptance Criteria
- [ ] `HandPhase` used for the state machine variant
- [ ] `Street` in `lib/poker/types.ts` unchanged
- [ ] No import confusion between the two
