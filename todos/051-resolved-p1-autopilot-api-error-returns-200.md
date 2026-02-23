---
status: pending
priority: p1
issue_id: "051"
tags: [code-review, security, autopilot, api, real-money]
dependencies: []
---

# Autopilot API Error Returns HTTP 200, Bypassing Background Fallback Path

## Problem Statement

`app/api/autopilot/route.ts` returns HTTP 200 with a fold action on Claude API errors. The background script's `fetchAutopilotDecision()` only calls `sendFallbackAction()` — the only logged error path — on non-2xx responses. Because 200 is returned on error, the error fold is forwarded silently to the real-money DOM executor as a valid decision. The `sendFallbackAction()` logging path is never reached, so the error is invisible in the background console.

This matters in a real-money context: an attacker who can exhaust the API quota or trigger rate limiting can force a fold on every hero turn with no operator alert.

## Findings

- `app/api/autopilot/route.ts:47-53` — `return Response.json({ action: "FOLD", ... }, { status: 200 })` in `catch` block
- `extension/src/background.ts:140-143` — `sendFallbackAction()` only called when `!res.ok` (non-2xx)
- Because API error returns 200, `action = await res.json()` succeeds, passes the shape validation check at line 149-158, and reaches `chrome.tabs.sendMessage(pokerTabId, { type: "AUTOPILOT_ACTION", action })` at line 165
- The fold executes on the real-money table; no log entry distinguishes it from a legitimate fold decision
- Security review (2026-02-23): rated HIGH

## Proposed Solutions

### Option A: Return HTTP 503 on API error (Recommended)

```typescript
} catch (err) {
  console.error("[autopilot] Claude API error:", err);
  return Response.json(
    { error: "Claude API unavailable" },
    { status: 503 },
  );
}
```

`background.ts:fetchAutopilotDecision()` already handles non-2xx:
```typescript
if (!res.ok) {
  console.error("[BG] Autopilot API error:", res.status);
  sendFallbackAction("API returned " + res.status);
  return;
}
```

This makes API failures visible in the background console and triggers `sendFallbackAction()` which logs the reason.

**Effort:** Change `status: 200` to `status: 503`, remove the fold object from the catch return
**Risk:** None — the background already handles this path

### Option B: Keep HTTP 200 but log explicitly in background

Keep current API behavior, add explicit logging in `background.ts` for when the returned fold has a reasoning string starting with "API error".

**Effort:** Fragile string matching, more complex
**Risk:** Brittle, still no distinction in autopilot action log

## Recommended Action

Option A. One-line change: `{ status: 200 }` → `{ status: 503 }` and replace the fold payload with `{ error: "..." }`. This properly uses HTTP semantics and makes the existing error handling in `background.ts` work as intended.

## Technical Details

- **Affected files:** `app/api/autopilot/route.ts`, `extension/src/background.ts`
- **Lines:** `route.ts:47-53`, `background.ts:140-160`
- **Impact:** Real-money DOM executor receives silent error folds indistinguishable from legitimate folds

## Acceptance Criteria

- [ ] `app/api/autopilot/route.ts` catch block returns HTTP 5xx (503 recommended)
- [ ] No fold payload returned on API error
- [ ] Background console shows `[BG] Autopilot API error: 503` when Claude is unavailable
- [ ] `sendFallbackAction("API returned 503")` correctly logged and forwarded
- [ ] Test: mock Claude API to throw → verify background logs the error

## Work Log

- 2026-02-23: Identified by security-sentinel review of PR #8
