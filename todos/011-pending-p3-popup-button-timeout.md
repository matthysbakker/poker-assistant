---
status: pending
priority: p3
issue_id: "011"
tags: [code-review, reliability, extension]
---

# Popup toggle button stuck if background doesn't respond

## Problem Statement
If the background script crashes or doesn't call `sendResponse`, the popup toggle button stays disabled forever.

## Files
- `extension/src/popup.ts` lines 36-47

## Proposed Fix
Add a 3-second safety timeout that re-enables the button.
