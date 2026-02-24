---
status: pending
priority: p2
issue_id: "117"
tags: [code-review, agent-native, api]
---

# No read API for hand records — agents cannot query history or statistics

## Problem Statement
`lib/storage/hand-records.ts` writes JSON files to `data/hands/<date>/<id>.json`. `lib/storage/hands.ts` maintains a parallel history in localStorage. Neither has a GET endpoint. An agent (or external tool) that wants to review past hands, check statistics, or query "what did I play from UTG today?" has zero access to this data.

## Findings
- `lib/storage/hand-records.ts:86-101` — writes records to disk, no read path
- `lib/storage/hands.ts` — localStorage-only, no server API
- `GET /api/hands` does not exist — returns 404
- Agent-native score: 4/9 capabilities agent-accessible; read history is the largest gap
- `app/api/decision/route.ts` JSDoc claims "hand history logging" which doesn't exist

## Proposed Fix
Add `GET /api/hands` endpoint:
- List records from `data/hands/` with optional filters: `?date=2026-02-24`, `?action=FOLD`, `?position=BTN`, `?limit=20`
- Return paginated array of `HandRecord` objects (without screenshot binary for list view)
- Add `GET /api/hands/[id]` for single record retrieval including screenshot if needed

## Files
- `app/api/hands/route.ts` (new file)
- `app/api/hands/[id]/route.ts` (new file)
- `lib/storage/hand-records.ts` (add `readHandRecords` function)

## Acceptance Criteria
- [ ] `GET /api/hands` returns paginated list with date/action/position filtering
- [ ] `GET /api/hands/[id]` returns single record
- [ ] Agent can call these endpoints without browser context
- [ ] Response is plain JSON (not streaming)
