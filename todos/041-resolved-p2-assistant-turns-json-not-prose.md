---
status: pending
priority: p2
issue_id: "041"
tags: [code-review, ai, conversation, autopilot]
dependencies: []
---

# Assistant Turns Stored as JSON Strings, Not Prose — Impairs Multi-Turn Reasoning

## Problem Statement

`onDecisionReceived()` stores Claude's response as `JSON.stringify(action)` in the conversation history. User messages are human-readable narrative ("New hand #123. Hero holds Ah Kd. Action to Hero."). Claude then reads back its own prior turns as stringified JSON blobs (`{"action":"CALL","amount":null,"reasoning":"..."}`). This inconsistency may impair its reasoning on subsequent turns in the hand.

## Findings

- `extension/src/poker-content.ts:673-677` — `handMessages.push({ role: "assistant", content: JSON.stringify(action) })`
- `extension/src/poker-content.ts:92` — `handMessages` accumulates across streets and is sent to Claude on each hero turn
- Pattern review (2026-02-23): "When this conversation history is sent back for the next hero turn, the model sees its own prior turn as a raw JSON blob, which may impair its reasoning"
- Architecture review (2026-02-23, H3): "A prose form like 'Hero calls €0.04.' would be more coherent with surrounding user messages"

## Proposed Solutions

### Option A: Store reasoning text only (Recommended)
```typescript
handMessages.push({
  role: "assistant",
  content: action.reasoning,
});
```
**Pros:** Natural conversational format; consistent with user messages; Claude reads its own reasoning naturally
**Cons:** Action type and amount not explicitly in the assistant turn (but they'll appear in the next user message's state diff)
**Effort:** 1 line change
**Risk:** None

### Option B: Store formatted prose with action
```typescript
const actionStr = action.amount ? `${action.action} €${action.amount.toFixed(2)}` : action.action;
handMessages.push({
  role: "assistant",
  content: `Hero ${actionStr.toLowerCase()}s. ${action.reasoning}`,
});
```
**Pros:** Explicitly records the action taken; readable; coherent
**Cons:** Slightly more formatting code
**Effort:** Small
**Risk:** None

### Option C: Status quo (JSON strings)
**Pros:** None
**Cons:** Potentially confusing for Claude; inconsistent format
**Risk:** Low (model handles JSON) but unnecessary

## Recommended Action

Option B. Recording both the action and reasoning in readable form gives Claude the cleanest context for subsequent decisions.

## Technical Details

- **File:** `extension/src/poker-content.ts:673-677`

## Acceptance Criteria

- [ ] `handMessages` assistant entries are prose, not JSON strings
- [ ] The action taken is visible in the assistant turn content
- [ ] Format is consistent with user turn narration style

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by architecture-strategist (H3), pattern-recognition-specialist.
