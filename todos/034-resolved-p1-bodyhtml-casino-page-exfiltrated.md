---
status: pending
priority: p1
issue_id: "034"
tags: [code-review, security, extension, autopilot, privacy]
dependencies: []
---

# Casino Page HTML (With Session Data) Sent to Background on Every Content Script Load

## Problem Statement

`poker-content.ts` unconditionally sends 500 bytes of `document.body.innerHTML` to the background script on every page load of `games.hollandcasino.nl`. Playtech's initial HTML may embed session tokens in script tags, CSRF nonces in meta tags, partial account state, and auth cookies. This data is sent on every load and re-logged by background.ts to the extension console, which is accessible to any extension with debugger API access.

## Findings

- `extension/src/poker-content.ts:100-111` — `bodyHTML: document.body?.innerHTML?.slice(0, 500)` sent unconditionally on script load
- `extension/src/background.ts:279-288` — the debug handler logs `JSON.stringify(message.data?.state, null, 2)` — state includes player names, stacks, cards
- This fires for **every iframe** due to `all_frames: true` (see todo 033), including payment frames
- Security review (2026-02-23, CRIT-4): "The Playtech poker client renders session-specific data into the initial HTML — session tokens embedded in script tags, CSRF nonces in meta tags"

## Proposed Solutions

### Option A: Remove `bodyHTML` from the debug startup message (Recommended)
The boolean flags `hasTableArea` and `hasBody` provide all needed diagnostic signal. Remove `bodyHTML` entirely:
```typescript
chrome.runtime.sendMessage({
  type: "AUTOPILOT_DEBUG",
  data: {
    type: "script_loaded",
    url: window.location.href,
    hasTableArea: !!document.querySelector(".table-area"),
    hasBody: !!document.body,
    // bodyHTML removed
  },
});
```
**Pros:** Eliminates session data exfiltration; still provides useful diagnostics
**Cons:** Slightly less debug info if body structure needs inspection (can be added back temporarily with a DEBUG flag)
**Effort:** Delete 1 line
**Risk:** None

### Option B: Gate behind DEBUG flag
```typescript
if (process.env.DEBUG_BODY_HTML) {
  data.bodyHTML = document.body?.innerHTML?.slice(0, 500);
}
```
**Pros:** Keeps diagnostic capability
**Cons:** Browser extensions don't have process.env — would need a build-time flag
**Effort:** Small
**Risk:** Low

### Option C: Reduce slice to headers only
Only send `document.head?.innerHTML?.slice(0, 200)` — likely contains fewer session tokens.
**Pros:** Reduces exposure
**Cons:** Still sends some page internals
**Effort:** 1 line change
**Risk:** Low, but doesn't fully solve the problem

## Recommended Action

Option A. The body HTML slice was Phase 0 discovery scaffolding. DOM structure is now understood. Remove it.

## Technical Details

- **File:** `extension/src/poker-content.ts:108`
- **Line:** `bodyHTML: document.body?.innerHTML?.slice(0, 500) || "(empty)"`

## Acceptance Criteria

- [ ] No casino page HTML sent to background on content script load
- [ ] Startup debug message only contains: `type`, `url`, `hasTableArea`, `hasBody`
- [ ] Same change applied if any other debug messages inadvertently contain page content

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by security-sentinel (CRIT-4). Phase 0 discovery artifact — can be safely removed.
