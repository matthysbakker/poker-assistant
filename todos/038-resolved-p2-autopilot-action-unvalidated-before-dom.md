---
status: pending
priority: p2
issue_id: "038"
tags: [code-review, security, type-safety, autopilot]
dependencies: []
---

# `AUTOPILOT_ACTION` Not Schema-Validated Before Executing on Real-Money DOM

## Problem Statement

`message.action` from a Chrome extension message (typed `any`) is passed directly into `onDecisionReceived()` and then to `simulateClick()` on real-money buttons without runtime type checking. If the API route error fallback, a bug, or a compromised response returns a differently-shaped object, the executor receives bad data silently.

## Findings

- `extension/src/poker-content.ts:133-136` — `onDecisionReceived(message.action)` with no type guard
- `extension/src/poker-content.ts:672` — function signature `(action: AutopilotAction)` but TypeScript cannot enforce this across `chrome.tabs.sendMessage`
- `extension/src/background.ts:147` — `const action = await res.json()` forwarded directly without parsing
- Security review (2026-02-23, HIGH-4): "If the background script receives a spoofed response... arbitrary action data reaches the DOM executor"
- Pattern review (2026-02-23): "`message.action` passed without runtime type assertion on receipt"

## Proposed Solutions

### Option A: Validate in poker-content.ts using a type guard (Recommended)
```typescript
function isAutopilotAction(x: unknown): x is AutopilotAction {
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>;
  return (
    ["FOLD", "CHECK", "CALL", "RAISE", "BET"].includes(a.action as string) &&
    (a.amount === null || typeof a.amount === "number") &&
    typeof a.reasoning === "string"
  );
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "AUTOPILOT_ACTION") {
    if (!isAutopilotAction(message.action)) {
      console.error("[Poker] Invalid action shape:", message.action);
      return;
    }
    onDecisionReceived(message.action);
  }
});
```
**Pros:** Defensive; correct place to validate since it's the consumer; protects DOM execution
**Cons:** Duplicates schema shape (can't import Zod in extension)
**Effort:** Small
**Risk:** None

### Option B: Validate in background.ts before forwarding
```typescript
import { autopilotActionSchema } from "..."; // can import in background
const parsed = autopilotActionSchema.safeParse(action);
if (!parsed.success) { sendFallbackAction("Schema validation failed"); return; }
chrome.tabs.sendMessage(pokerTabId, { type: "AUTOPILOT_ACTION", action: parsed.data });
```
**Pros:** Uses existing Zod schema; validates at the source
**Cons:** Background.ts builds as a bundle — check if Zod tree-shakes correctly
**Effort:** Small
**Risk:** Low

### Option C: Keep as-is
**Pros:** None
**Cons:** Any malformed or spoofed action executes on real money buttons
**Risk:** Medium

## Recommended Action

Option B first (background.ts validates against the Zod schema before forwarding), Option A as defense-in-depth in the content script.

## Technical Details

- **Files:** `extension/src/poker-content.ts:133-136`, `extension/src/background.ts:147-156`
- **Zod schema:** `lib/ai/autopilot-schema.ts` — already imported in background build context

## Acceptance Criteria

- [ ] `AUTOPILOT_ACTION` payload validated against `autopilotActionSchema` before forwarding
- [ ] Invalid shape triggers fallback fold, not silent execution
- [ ] Content script has basic type guard before `onDecisionReceived`

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by security-sentinel (HIGH-4), pattern-recognition-specialist.
