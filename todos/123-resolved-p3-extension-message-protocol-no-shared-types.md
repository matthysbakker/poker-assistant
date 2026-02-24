---
status: pending
priority: p3
issue_id: "123"
tags: [code-review, architecture, extension, types]
---

# Extension message protocol has no shared type definition — rename one handler, miss another

## Problem Statement
Twelve message type strings are documented in a comment block in `background.ts` but are plain string literals at every handler site. A rename in one handler does not produce a TypeScript error in others. Payload-bearing messages like `AUTOPILOT_ACTION` and `CLAUDE_ADVICE` are especially risky.

## Findings
- `extension/src/background.ts:1-31` — 12 message types as comment block, not types
- String literals used at every handler site in background, content, and poker-content
- No discriminated union covering cross-boundary message types

## Proposed Fix
Create `extension/src/messages.ts` with a discriminated union:
```typescript
export type ExtensionMessage =
  | { type: "CAPTURE"; base64: string }
  | { type: "FRAME"; base64: string }
  | { type: "AUTOPILOT_ACTION"; action: string; amount?: string }
  | { type: "CLAUDE_ADVICE"; reasoning: string; action: string }
  // ... all 12 types
```
Import and use in `background.ts`, `content.ts`, and `poker-content.ts`.

## Files
- `extension/src/messages.ts` (new)
- `extension/src/background.ts`
- `extension/src/content.ts`
- `extension/src/poker-content.ts`

## Acceptance Criteria
- [ ] `messages.ts` defines all message types as discriminated union
- [ ] All three extension files import and use the shared types
- [ ] TypeScript catches any handler that uses an unknown type string
