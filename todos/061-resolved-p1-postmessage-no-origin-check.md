---
status: pending
priority: p1
issue_id: "061"
tags: [code-review, security, extension, postmessage]
dependencies: []
---

# `content.ts` Relays `window.postMessage` Without Origin Check — Any Localhost Script Can Trigger Actions

## Problem Statement

`content.ts` listens for `window.postMessage` events and forwards them to the background script (which can then send `AUTOPILOT_ACTION` to the poker tab). There is no `event.origin` validation. Any JavaScript running on `localhost` — including a malicious third-party script on a different tab — can craft a message that causes the extension to fold, call, or raise on the active casino game.

## Findings

- `content.ts` line ~14: `window.addEventListener("message", (event) => { if (event.data?.source !== "poker-assistant-app") return; ... }`
- Only checks `event.data.source` string — attacker can trivially spoof `source: "poker-assistant-app"`
- No check on `event.origin` — any origin can post to this handler
- Forwarded messages include `PERSONA_RECOMMENDATION` and `CLAUDE_ADVICE` (which can trigger action buttons on the poker site via `AUTOPILOT_ACTION`)
- The poker content script (`poker-content.ts`) also listens for `AUTOPILOT_ACTION` from background with no sender validation

## Proposed Solutions

### Option 1: Origin Allowlist Check (Recommended)

**Approach:** Validate `event.origin` against the expected web app origin before processing any message.

```typescript
const ALLOWED_ORIGINS = ["http://localhost:3006", "https://poker-assistant.vercel.app"];

window.addEventListener("message", (event) => {
  if (!ALLOWED_ORIGINS.includes(event.origin)) return;
  if (event.data?.source !== "poker-assistant-app") return;
  // … rest of handler
});
```

**Pros:**
- Cryptographically bound to origin — cannot be spoofed
- Straightforward, standard approach

**Cons:**
- Port must be kept in sync with `package.json` dev port

**Effort:** 30 minutes
**Risk:** Low

---

### Option 2: Nonce-Based Authentication

**Approach:** Background script generates a nonce on extension startup, passes it to the web app tab via `EXTENSION_CONNECTED`, and `content.ts` verifies nonce on every message.

**Pros:** Works across arbitrary ports/origins

**Cons:** Higher complexity; nonce must be injected into the web app, which has its own race conditions

**Effort:** 3 hours
**Risk:** Medium

## Technical Details

**Affected files:**
- `extension/src/content.ts` — `window.addEventListener("message", ...)` handler

**Related components:**
- `extension/src/background.ts` — `AUTOPILOT_DECIDE` handler
- `extension/src/poker-content.ts` — `AUTOPILOT_ACTION` handler

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** security-sentinel (H-3)

## Acceptance Criteria

- [ ] Messages from non-allowlisted origins are silently dropped
- [ ] Web app on correct origin still works end-to-end
- [ ] No new origin-related console errors during normal use
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
