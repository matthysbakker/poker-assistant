---
title: Content Script Not Loading in Iframe
category: browser-extension
tags: [firefox, content-script, iframe, manifest, playtech]
symptoms: [content script silent, waitForTable loops forever, no .table-area found]
module: extension
severity: critical
---

# Content Script Not Loading in Iframe

## Problem

The content script was injected into the top-level frame of the Playtech poker client (`games.hollandcasino.nl`) but not into the iframe where the actual game DOM lives. The script logged "No .table-area found" indefinitely — not because the selector was wrong, but because it was querying the wrong document entirely.

**Symptom:** `waitForTable()` would poll forever with no `.table-area` found, even though the game was clearly visible.

## Root Cause

The Playtech browser client loads the actual game (cards, actions, pot, seats) inside an `<iframe>`. By default, Firefox/Chrome only injects content scripts into top-level frames. The top-level document had no `.table-area` — that element only exists in the iframe's document.

The manifest entry was:

```json
{
  "matches": ["*://games.hollandcasino.nl/*"],
  "js": ["dist/poker-content.js"],
  "run_at": "document_idle"
}
```

## Fix

Add `"all_frames": true` to the content script manifest entry:

```json
{
  "matches": ["*://games.hollandcasino.nl/*"],
  "js": ["dist/poker-content.js"],
  "run_at": "document_idle",
  "all_frames": true
}
```

This causes the script to be injected into every frame on the matched origin — including the game iframe. The `waitForTable()` check then finds `.table-area` in the frame where it actually exists.

## Prevention

When writing content scripts for sites that embed games or SPAs in iframes:

1. **Check the DOM first** — open DevTools, look at the frame tree. If the target elements are inside an `<iframe>`, you need `all_frames: true`.
2. **Add a heartbeat log** immediately at script load time so you can confirm which frames the script was injected into:

```typescript
// Top of content script — proves injection happened
chrome.runtime.sendMessage({ type: "CONTENT_HEARTBEAT", url: location.href });
```

If the heartbeat only fires once (from the top-level frame), `all_frames: true` is missing.

## Notes

- `all_frames: true` means the script runs in every subframe matching the URL pattern. If there are many iframes, add a guard:
  ```typescript
  // Only run in the game frame, not top-level or other iframes
  if (!document.querySelector('.table-area')) return;
  ```
- This issue is invisible in normal debugging because the top-level frame loads without errors — the script just never finds its target elements.
