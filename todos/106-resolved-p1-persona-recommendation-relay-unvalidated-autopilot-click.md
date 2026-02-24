---
status: pending
priority: p1
issue_id: "106"
tags: [code-review, security, extension, autopilot]
---

# PERSONA_RECOMMENDATION relayed without action validation — real-money autopilot click risk

## Problem Statement
The content script relays `PERSONA_RECOMMENDATION` messages from the page to the background without validating the `action` field. In "play" mode, `lastPersonaRec.action` feeds directly into `safeExecuteAction()` in `poker-content.ts`, which clicks real poker buttons. Any same-origin JavaScript (XSS payload, injected content script) can trigger a real fold/call/raise by posting a crafted message.

## Findings
- `extension/src/content.ts:33-51` — forwards `event.data.action` and `event.data.personaName` unvalidated
- `extension/src/poker-content.ts:181` — `lastPersonaRec.action` stored with no enum check before `safeExecuteAction()`
- `extension/src/background.ts` has `isAutopilotAction()` guard for `AUTOPILOT_ACTION` but no equivalent for persona actions
- Contrast: `AUTOPILOT_ACTION` at `poker-content.ts:1367` is protected by `isAutopilotAction()` validation

## Proposed Fix
1. Add action validation in `content.ts` before forwarding:
   ```typescript
   const VALID_ACTIONS = ["FOLD","CHECK","CALL","RAISE","BET"] as const;
   if (!VALID_ACTIONS.includes(event.data.action)) return;
   ```
2. Apply same guard in `poker-content.ts:181` before storing into `lastPersonaRec`.

## Files
- `extension/src/content.ts:33-51`
- `extension/src/poker-content.ts:181`

## Acceptance Criteria
- [ ] `action` validated against enum before forwarding in content.ts
- [ ] `action` validated before storing in poker-content.ts
- [ ] Crafted postMessage with invalid action is silently dropped
- [ ] Rebuild extension after change
