---
status: pending
priority: p1
issue_id: "035"
tags: [code-review, security, api, debug, autopilot]
dependencies: []
---

# `/api/autopilot-debug` Endpoint Has No Auth, No Validation, No try/catch

## Problem Statement

`app/api/autopilot-debug/route.ts` accepts arbitrary POST bodies, logs them (including raw DOM HTML), and returns 200. There is no authentication, no schema validation, no rate limiting, no try/catch around `req.json()`, and no `NODE_ENV` guard. Any local process can trigger it. A deployed Vercel version would expose this endpoint publicly. The background.ts `AUTOPILOT_DEBUG` handler (lines 279-288) already logs the same data to the extension console, making this HTTP route redundant.

## Findings

- `app/api/autopilot-debug/route.ts:1-23` — 23 lines, zero validation
- `app/api/autopilot-debug/route.ts:2` — `const data = await req.json()` with no try/catch; malformed body throws unhandled exception (stack trace leak)
- `app/api/autopilot-debug/route.ts:8-19` — logs `data.dom.heroCards` directly — caller-controlled string; no size bounds
- `extension/src/background.ts:279-288` — already handles `AUTOPILOT_DEBUG` messages and logs state + DOM to background console
- Security review (2026-02-23, CRIT-1): "A caller can inject multi-megabyte strings into server logs, cause memory pressure via JSON.stringify, or probe error responses for information"
- Simplicity review (2026-02-23): "Redundant with background console log, unguarded"

## Proposed Solutions

### Option A: Delete the route (Recommended if background logging is sufficient)
The `AUTOPILOT_DEBUG` messages are already routed through `background.ts:279-288` to the extension's background console. The HTTP route duplicates this. Remove `app/api/autopilot-debug/route.ts` entirely.
**Pros:** Zero attack surface; simplest fix; background console logging still works
**Cons:** Loses server-side log aggregation path (only a concern if Vercel is used)
**Effort:** Delete 1 file
**Risk:** None

### Option B: Gate behind NODE_ENV check + add try/catch + add schema validation
```typescript
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  let data: unknown;
  try { data = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  // ... log only bounded fields
}
```
**Pros:** Keeps the route for local development; safe in production
**Cons:** More lines; still a local risk
**Effort:** Small
**Risk:** Low

### Option C: Add shared secret header check (if keeping route)
```typescript
const secret = req.headers.get("X-Debug-Token");
if (secret !== process.env.DEBUG_TOKEN) {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
```
**Pros:** Minimal auth for local use
**Cons:** Requires env var; doesn't add much for a localhost-only tool
**Effort:** Small
**Risk:** None

## Recommended Action

Option A now (delete). If server-side logging proves needed, add it back with Option B guards.

## Technical Details

- **File:** `app/api/autopilot-debug/route.ts` (23 lines)
- **Background logging equivalent:** `extension/src/background.ts:279-288`

## Acceptance Criteria

- [ ] Route either deleted or guarded behind `NODE_ENV !== "production"` check
- [ ] `req.json()` wrapped in try/catch if route is kept
- [ ] Input size bounded if route is kept (max content-length or Zod schema)
- [ ] No functional regression — background console logging covers all debug needs

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by security-sentinel (CRIT-1), architecture-strategist (H5), simplicity-reviewer. Redundant with background logging.
