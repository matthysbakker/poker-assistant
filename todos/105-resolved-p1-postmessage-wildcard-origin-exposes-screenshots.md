---
status: pending
priority: p1
issue_id: "105"
tags: [code-review, security, extension]
---

# postMessage wildcard origin exposes screenshots with hole cards

## Problem Statement
`content.ts` relays screenshot frames to the poker assistant page using `window.postMessage(data, "*")`. Any cross-origin `<iframe>` on the page can receive the full base64 screenshot containing hole cards, player stacks, and financial data. The same file correctly uses `window.location.origin` for `EXTENSION_CONNECTED` messages, making this an inconsistency.

## Findings
- `extension/src/content.ts:61` — CAPTURE relay uses `"*"` as target origin
- `extension/src/content.ts:67` — FRAME relay (continuous 2s captures) also uses `"*"`
- Correct usage at `content.ts:20` uses `window.location.origin`
- `FRAME` messages run every 1-2 seconds in continuous mode — frequent exposure window

## Proposed Fix
Replace `"*"` with `window.location.origin` on lines 61 and 67 in `content.ts`. One-liner fix, zero behaviour change for the intended recipient.

## Files
- `extension/src/content.ts:61,67`

## Acceptance Criteria
- [ ] Both `postMessage` calls for CAPTURE and FRAME use `window.location.origin`
- [ ] No regressions in manual or continuous capture modes
- [ ] Rebuild extension after change: `bun run build:extension`
