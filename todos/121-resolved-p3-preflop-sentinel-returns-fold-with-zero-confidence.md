---
status: pending
priority: p3
issue_id: "121"
tags: [code-review, architecture, correctness]
---

# Preflop sentinel in rule-tree.ts returns FOLD with confidence 0 — real-money risk

## Problem Statement
`rule-tree.ts` returns `{ action: "FOLD", confidence: 0 }` as a sentinel meaning "not applicable for post-flop". A caller that forgets to check confidence before acting on this return value would execute a real fold at a live table. `CHECK` is always a no-op and would be a safer sentinel.

## Findings
- `lib/poker/rule-tree.ts:73-75` — `return { action: "FOLD", amount: null, confidence: 0, reasoning: "Pre-flop: use persona chart" }`
- All current callers check confidence before acting — but this is a silent footgun
- `"FOLD"` as a no-op sentinel is semantically wrong

## Proposed Fix
Change sentinel to `CHECK`:
```typescript
return { action: "CHECK", amount: null, confidence: 0, reasoning: "Pre-flop: use persona chart" };
```
Or return `null` and require callers to handle the preflop case explicitly.

## Files
- `lib/poker/rule-tree.ts:73-75`

## Acceptance Criteria
- [ ] Sentinel action is `CHECK` or function returns `null`
- [ ] All callers updated if return type changes to nullable
- [ ] Tests in `lib/poker/__tests__/rule-tree.test.ts` updated
