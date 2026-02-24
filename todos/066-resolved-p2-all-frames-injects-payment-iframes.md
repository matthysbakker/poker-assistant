---
status: pending
priority: p2
issue_id: "066"
tags: [code-review, security, extension, manifest]
dependencies: []
---

# `all_frames: true` Injects Poker Content Script into Payment iframes

## Problem Statement

`manifest.json` sets `all_frames: true` for the poker content script, meaning it is injected into every iframe on `games.hollandcasino.nl`, including payment/cashier iframes. This unnecessarily expands the attack surface and could interfere with sensitive payment flows.

## Findings

- `extension/manifest.json`: `"all_frames": true` in the poker content script entry
- Casino pages typically embed third-party payment processors in iframes (e.g., Paysafe, Trustly)
- Injecting the poker script into payment iframes is unintended and could:
  1. Break payment iframe due to unexpected DOM mutations
  2. Expose payment iframe DOM to the script
  3. Create XSS risk if the script relies on `window.postMessage` without origin checks (see #061)
- The `.table-area` selector will simply not match in payment iframes, but the script still loads and listens for messages

## Proposed Solutions

### Option 1: Remove `all_frames: true` (Recommended)

**Approach:** Set `"all_frames": false` (or remove the key — it defaults to false).

```json
{
  "js": ["dist/poker-content.js"],
  "matches": ["*://games.hollandcasino.nl/*"]
}
```

**Pros:**
- Script only runs in top-level game frame
- Zero change to normal poker functionality (`.table-area` is in the top frame)

**Cons:**
- If for some reason the table is embedded in an iframe, this could break; investigate first

**Effort:** 15 minutes
**Risk:** Low (verify game is in top frame)

---

### Option 2: Add Frame URL Match Restriction

**Approach:** Keep `all_frames: true` but add a `"exclude_matches"` for payment-related subdomains.

**Pros:** More surgical

**Cons:** Harder to maintain as payment providers change

**Effort:** 30 minutes
**Risk:** Medium

## Technical Details

**Affected files:**
- `extension/manifest.json` — `all_frames` key in `content_scripts`

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** security-sentinel (M-6)

## Acceptance Criteria

- [ ] Content script does not run in payment/cashier iframes
- [ ] Poker game table still detected and autopilot works in top frame
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
