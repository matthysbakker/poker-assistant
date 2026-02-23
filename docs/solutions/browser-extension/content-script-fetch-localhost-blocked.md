---
title: Content Script Cannot Fetch Localhost
category: browser-extension
tags: [firefox, content-script, fetch, cors, localhost, background-script, debug]
symptoms: [fetch silently fails, debug data never arrives, no network error shown]
module: extension
severity: high
---

# Content Script Cannot Fetch Localhost

## Problem

Attempting to `fetch("http://localhost:3006/api/debug", ...)` from a content script silently failed. No error was thrown, no network request appeared in the game tab's DevTools network panel, and no data ever reached the dev server.

**Symptom:** `sendDebugLog()` completed without error in the content script, but the Next.js terminal showed nothing and the debug API never received requests.

## Root Cause

Content scripts run in the context of the host page (e.g. `https://games.hollandcasino.nl`). Fetching `http://localhost` from an HTTPS page is blocked by:

1. **Mixed content policy** — HTTPS → HTTP is blocked by the browser
2. **CORS** — `localhost` does not send CORS headers to arbitrary origins

The failure is silent because the browser blocks the request at the network layer before any JavaScript error is thrown. There is no `catch` path triggered.

## Fix

Route all outbound requests through the background script using `chrome.runtime.sendMessage`. The background script has full network access (it's a privileged extension context, not bound to any page origin).

**Before (broken):**

```typescript
// In content script — silently fails from HTTPS page
async function sendDebugLog(data: Record<string, unknown>) {
  await fetch("http://localhost:3006/api/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
```

**After (working):**

```typescript
// In content script — route through background
function sendDebugLog(data: Record<string, unknown>) {
  chrome.runtime.sendMessage({ type: "AUTOPILOT_DEBUG", data });
}
```

```typescript
// In background.ts — has network access, logs to console
case "AUTOPILOT_DEBUG":
  console.log("[BG] Debug data:", JSON.stringify(msg.data, null, 2));
  // Optionally: fetch to localhost here (background can reach it)
  break;
```

Debug output is then visible in the background page console at `about:debugging`.

## Prevention

**Rule:** Content scripts cannot make outbound network requests to origins other than the page they're running in. For localhost dev tooling or AI API calls, always proxy through the background script.

Pattern for any content script → localhost communication:

```typescript
// content script
chrome.runtime.sendMessage({ type: "MY_FETCH", payload: data });

// background.ts
case "MY_FETCH":
  fetch("http://localhost:PORT/endpoint", {
    method: "POST",
    body: JSON.stringify(msg.payload),
    headers: { "Content-Type": "application/json" },
  }).catch(console.error);
  break;
```

## Diagnosis

If you suspect this issue:

1. Check the **background page console** (`about:debugging` → Inspect → Console), not the tab console
2. Add a `chrome.runtime.sendMessage` call as a heartbeat to confirm the message pipeline works before attempting any fetch
3. Look for "Mixed Content" or "CORS" errors in the tab console — though they may not appear if blocked at a lower level

## Notes

- This also applies to `XMLHttpRequest` — same restrictions apply
- The background script in MV2 (`"persistent": true`) is always running and can receive messages at any time
- For MV3 service workers, use `chrome.runtime.onMessage.addListener` but be aware the SW may be inactive — use `chrome.action` or `chrome.alarms` to keep it alive if needed
