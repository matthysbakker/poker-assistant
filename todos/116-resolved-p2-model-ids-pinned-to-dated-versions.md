---
status: pending
priority: p2
issue_id: "116"
tags: [code-review, reliability, ai]
---

# Model IDs pinned to dated version strings across multiple files

## Problem Statement
Three files pin model IDs to dated release strings (`claude-haiku-4-5-20251001`, `claude-sonnet-4-20250514`). Dated strings will be deprecated. When deprecated, all Claude features silently return 503. The global CLAUDE.md explicitly requires unversioned aliases.

## Findings
- `lib/ai/analyze-hand.ts:7-9` — `continuous: "claude-haiku-4-5-20251001"` and `manual: "claude-sonnet-4-20250514"`
- `app/api/autopilot/route.ts:36` — `model: anthropic("claude-haiku-4-5-20251001")`
- Previously flagged as todo 040 (resolved) but fix did not land in current code

## Proposed Fix
Replace with unversioned aliases. Verify current alias names in `@ai-sdk/anthropic` docs before changing:
```typescript
// lib/ai/analyze-hand.ts
const MODELS = {
  continuous: "claude-haiku-4-5",
  manual: "claude-sonnet-4-5",
} as const;

// app/api/autopilot/route.ts
model: anthropic("claude-haiku-4-5"),
```

## Files
- `lib/ai/analyze-hand.ts:7-9`
- `app/api/autopilot/route.ts:36`

## Acceptance Criteria
- [ ] All model IDs use unversioned aliases
- [ ] Verify alias names are valid against `@ai-sdk/anthropic` package
- [ ] Manual and continuous mode both call Claude successfully
