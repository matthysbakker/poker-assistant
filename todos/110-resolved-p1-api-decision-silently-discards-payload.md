---
status: pending
priority: p1
issue_id: "110"
tags: [code-review, agent-native, reliability, api]
---

# /api/decision silently discards its payload — JSDoc claims logging that doesn't happen

## Problem Statement
`/api/decision` validates a complete decision schema and then only calls `console.log`. The JSDoc comment says it enables "observability and hand history logging" — neither happens. Every POST returns `{ ok: true }` while the record is dropped. This also makes the endpoint inaccessible for agent use (no history to query).

## Findings
- `app/api/decision/route.ts:34-39` — validates decision, calls `console.log`, returns `{ ok: true }`
- JSDoc at line 1-5 claims "enables observability and hand history logging"
- Called from `extension/src/poker-content.ts` autopilot path — all decisions are silently lost
- `SAVE_HANDS` env var pattern exists in `/api/record` but is not applied here

## Proposed Fix
Two options:
1. **Wire to persistence:** Apply the same `writeHandRecord` pattern from `/api/record`. Create a `DecisionRecord` type in `lib/storage/` and write to `data/decisions/<date>/<id>.json` when `SAVE_HANDS=true`.
2. **Honest no-op:** Update JSDoc to document that this is a stub, remove misleading claims, return `{ ok: true, saved: false }`.

Option 1 is strongly preferred — this data is valuable for review and agent querying.

## Files
- `app/api/decision/route.ts:1-39`
- `lib/storage/hand-records.ts` (for reference on writeHandRecord pattern)

## Acceptance Criteria
- [ ] Decisions are persisted to disk when `SAVE_HANDS=true` OR
- [ ] JSDoc accurately describes the endpoint as a no-op stub
- [ ] Response includes `{ ok: true, saved: boolean }` to inform callers
