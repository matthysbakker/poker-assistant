---
status: pending
priority: p1
issue_id: "033"
tags: [code-review, security, extension, manifest, autopilot]
dependencies: []
---

# `all_frames: true` Injects Content Script Into Payment/Identity Iframes

## Problem Statement

The manifest injects `poker-content.js` into every iframe on `games.hollandcasino.nl`. Playtech poker clients load payment processing, identity verification, and banking operations in iframes from the same domain. Each such iframe independently calls `REGISTER_POKER_TAB`, and each overwrites `pokerTabId` in background.ts. The last iframe to load wins. `AUTOPILOT_ACTION` messages then go to the wrong frame; the poker game frame receives nothing and cannot act.

## Findings

- `extension/manifest.json:19-23` — `"all_frames": true` with `"matches": ["*://games.hollandcasino.nl/*"]`
- `extension/src/background.ts:226-237` — `pokerTabId = sender.tab.id` on each `REGISTER_POKER_TAB` — no deduplication, last frame wins
- `extension/src/poker-content.ts:100-111` — startup `AUTOPILOT_DEBUG` message sends `bodyHTML` slice from every iframe that loads (including payment pages)
- Security review (2026-02-23, HIGH-1): "A payment iframe's initial HTML may contain partial card numbers, masked account references, or authentication tokens"
- Architecture review (2026-02-23, H6): "A late-loading analytics, chat, or lobby iframe will silently replace the game iframe's tab ID"

## Proposed Solutions

### Option A: Narrow match pattern to specific game path (Recommended)
Identify the exact URL pattern of the poker game iframe from monitor-mode sessions, then narrow the manifest:
```json
{
  "matches": ["*://games.hollandcasino.nl/poker/*"],
  "js": ["dist/poker-content.js"],
  "run_at": "document_idle"
}
```
And remove `all_frames: true` (default is top-level frame only).
**Pros:** Surgical injection; eliminates payment iframe risk; eliminates pokerTabId collision
**Cons:** Requires discovering the exact iframe URL from a live session
**Effort:** Small (one monitor session + manifest change)
**Risk:** Low

### Option B: Add URL self-check before REGISTER_POKER_TAB
Inside `poker-content.ts`, only register if the current URL matches the expected game path:
```typescript
const isPokerFrame = window.location.href.includes("/poker/");
if (isPokerFrame) {
  chrome.runtime.sendMessage({ type: "REGISTER_POKER_TAB" }, ...);
}
```
**Pros:** Doesn't require knowing the URL upfront; self-filtering
**Cons:** Still injects into all frames; just silences non-poker ones. Payment iframes still get the script.
**Effort:** Very small
**Risk:** Low for correctness, still has the security concern

### Option C: Deduplication in background — accept first REGISTER, reject subsequent
Track the first registering tab ID and only update if the previous tab is no longer active.
**Pros:** Solves the overwrite problem
**Cons:** Doesn't solve injection into payment iframes
**Effort:** Small
**Risk:** Low

## Recommended Action

Option A + B in combination: narrow the manifest pattern (Option A) AND add URL check (Option B) as defense-in-depth.

## Technical Details

- **Files:** `extension/manifest.json:19-23`, `extension/src/background.ts:226-237`
- Monitor mode can be used to observe which URL the game actually loads in

## Acceptance Criteria

- [ ] `poker-content.js` does not inject into payment/identity/lobby iframes
- [ ] `REGISTER_POKER_TAB` comes from exactly one frame per session
- [ ] `pokerTabId` is stable and refers to the poker game frame throughout a session
- [ ] Payment iframe HTML is never sent in any debug message

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by security-sentinel (HIGH-1, CRIT-4), architecture-strategist (H6).
