---
status: resolved
priority: p3
issue_id: "019"
tags: [code-review, dead-code]
---

# Dead isMac ternary in popup.ts

## Problem Statement
`hotkeyEl.textContent = isMac ? "Ctrl+Shift+P" : "Ctrl+Shift+P"` — both branches produce the same string.

## Files
- `extension/src/popup.ts` lines 6-7

## Proposed Fix
Replace with `hotkeyEl.textContent = "Ctrl+Shift+P"` and remove the `isMac` variable.
