---
status: pending
priority: p3
issue_id: "057"
tags: [code-review, cleanup, security, autopilot]
dependencies: []
---

# Delete autopilot-debug Route File

## Problem Statement

`app/api/autopilot-debug/route.ts` exists but returns 410 (Gone) in development and 404 in production. Its original functionality was removed — background.ts `AUTOPILOT_DEBUG` handler provides the same logging. The file's presence signals unresolved cleanup and creates maintenance risk: a future refactor could accidentally re-enable it. A disabled endpoint should be deleted, not left as a stub.

## Findings

- `app/api/autopilot-debug/route.ts` — entire file is a "this endpoint was removed" stub returning 410/404
- `extension/src/background.ts:292-301` — `AUTOPILOT_DEBUG` message handler provides equivalent logging
- Security review (2026-02-23): rated HIGH to delete
- No code in the project calls this endpoint

## Proposed Solutions

### Option A: Delete the file (Recommended)

```bash
rm app/api/autopilot-debug/route.ts
```

**Effort:** Delete 1 file
**Risk:** None — the file serves no purpose

## Recommended Action

Delete `app/api/autopilot-debug/route.ts`.

## Technical Details

- **Affected files:** `app/api/autopilot-debug/route.ts`

## Acceptance Criteria

- [ ] `app/api/autopilot-debug/route.ts` deleted
- [ ] No references to `/api/autopilot-debug` anywhere in the codebase
- [ ] `bun run build` passes

## Work Log

- 2026-02-23: Identified by security-sentinel review of PR #8
