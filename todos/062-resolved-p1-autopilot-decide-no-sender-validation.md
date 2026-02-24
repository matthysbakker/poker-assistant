---
status: pending
priority: p1
issue_id: "062"
tags: [code-review, security, extension, background]
dependencies: []
---

# `AUTOPILOT_DECIDE` Handler Doesn't Validate Sender Tab

## Problem Statement

`background.ts` handles `AUTOPILOT_DECIDE` messages from any sender tab, including the web app tab (`localhost`). Any JavaScript running on localhost can send an `AUTOPILOT_DECIDE` message with arbitrary `messages` content, causing the background to call `/api/autopilot` and then relay the resulting action to the casino poker tab.

## Findings

- `background.ts` line ~209: `if (message.type === "AUTOPILOT_DECIDE") { fetchAutopilotDecision(message.messages); }`
- No `sender.tab?.id` check — any registered or unregistered tab can trigger this
- The `messages` array is passed directly to the API without sanitisation
- Combined with todo #061 (postMessage origin bypass), an attacker page can force arbitrary AI decisions on an active poker game
- Even without #061, any tab the user visits while the extension is loaded could abuse this

## Proposed Solutions

### Option 1: Restrict to Registered Web App Tab

**Approach:** Only process `AUTOPILOT_DECIDE` when `sender.tab?.id === webAppTabId`.

```typescript
if (message.type === "AUTOPILOT_DECIDE") {
  if (sender.tab?.id !== webAppTabId) {
    console.warn("[BG] AUTOPILOT_DECIDE from unregistered tab, ignoring");
    return;
  }
  fetchAutopilotDecision(message.messages);
  return;
}
```

**Pros:**
- Simple one-liner guard
- Consistent with existing `REGISTER_WEB_APP` trust model

**Cons:**
- `webAppTabId` must be set before any `AUTOPILOT_DECIDE` can fire (already the case in normal flow)

**Effort:** 30 minutes
**Risk:** Low

---

### Option 2: Validate messages Array Schema

**Approach:** In `fetchAutopilotDecision`, validate that `messages` is an array of `{role, content}` objects before forwarding to the API.

**Pros:** Defense in depth even if tab validation bypassed

**Cons:** Doesn't prevent the sender-tab problem; should be combined with Option 1

**Effort:** 1 hour
**Risk:** Low

## Technical Details

**Affected files:**
- `extension/dist/background.js` / `extension/src/background.ts` — `AUTOPILOT_DECIDE` handler (~line 209)

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** security-sentinel (H-2)
- **Related todo:** #061

## Acceptance Criteria

- [ ] `AUTOPILOT_DECIDE` from non-registered tab is rejected and logged
- [ ] Normal autopilot flow still works from web app tab
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
