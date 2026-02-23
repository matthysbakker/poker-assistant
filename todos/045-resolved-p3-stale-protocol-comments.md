---
status: pending
priority: p3
issue_id: "045"
tags: [code-review, documentation, autopilot]
dependencies: []
---

# Stale Protocol Comments Reference Non-Existent Message Types

## Problem Statement

The protocol header in `background.ts` documents three message types that don't exist in the codebase. A maintainer debugging a missed mode-change will look for handlers that were never created.

## Findings

- `extension/src/background.ts:15` — `AUTOPILOT_ENABLED  bg → poker-content   Toggle autopilot on/off` — no handler exists; actual message is `AUTOPILOT_MODE`
- `extension/src/background.ts:21` — `AUTOPILOT_START    popup → bg       Enable autopilot` — no handler exists; actual message is `AUTOPILOT_SET_MODE`
- `extension/src/background.ts:22` — `AUTOPILOT_STOP     popup → bg       Disable autopilot` — no handler exists; actual message is `AUTOPILOT_SET_MODE`

## Proposed Solutions

### Option A: Delete stale entries, add correct ones (Recommended)
```
// Replace:
AUTOPILOT_ENABLED     bg → poker-content   Toggle autopilot on/off
AUTOPILOT_START       popup → bg       Enable autopilot
AUTOPILOT_STOP        popup → bg       Disable autopilot

// With:
AUTOPILOT_SET_MODE    popup → bg       Set mode: "off" | "monitor" | "play"
AUTOPILOT_MODE        bg → poker-content   Apply mode change
```
**Effort:** 5 lines
**Risk:** None

## Acceptance Criteria

- [ ] Background.ts protocol comment accurately reflects all handled message types
- [ ] No references to `AUTOPILOT_ENABLED`, `AUTOPILOT_START`, `AUTOPILOT_STOP`

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by pattern-recognition-specialist, architecture-strategist.
