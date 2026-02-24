---
status: pending
priority: p2
issue_id: "088"
tags: [code-review, security, quality]
dependencies: []
---

# handContext and opponentHistory Have No Length Limits — API Cost Amplification

## Problem Statement

`handContext` and `opponentHistory.actions[]` in the `/api/analyze` request schema have no maximum length constraints. Both are concatenated verbatim into the Claude prompt. In continuous mode (every 2 seconds), unbounded input can create extremely expensive API calls.

## Findings

- `app/api/analyze/route.ts:39` — `handContext: z.string().optional()` — no `.max()`
- `app/api/analyze/route.ts:20-23` — `opponentHistory.actions` is `z.array(z.string())` — no array length cap, no per-string cap
- `lib/ai/analyze-hand.ts:38-43` — both are injected verbatim into the Claude prompt
- In continuous mode, analysis is triggered every time `heroTurn` flips true — potentially every 2 seconds
- A caller can send a multi-megabyte `handContext` string that inflates token count and API cost exponentially
- Security agent flagged this as a prompt injection surface as well

## Proposed Solutions

### Option 1: Add Zod length limits (Recommended)

**Approach:** Add `.max()` constraints that reflect realistic poker game data:

```ts
handContext: z.string().max(5_000).optional(),  // ~1000 words max

// In opponentHistorySchema:
actions: z.array(z.string().max(200)).max(20),  // 20 actions, 200 chars each
notes: z.string().max(500).optional(),
```

**Pros:**
- Simple one-line additions
- Prevents both cost amplification and prompt injection
- Realistic bounds for actual poker game data

**Cons:**
- May need adjustment if legitimate use generates longer strings

**Effort:** 15 minutes

**Risk:** Low

---

### Option 2: Add server-side truncation before Claude call

**Approach:** Truncate handContext and actions at `lib/ai/analyze-hand.ts` before building the prompt, log a warning if truncation occurs.

**Pros:**
- Graceful degradation (doesn't reject the request)

**Cons:**
- Silently loses information — hard to debug
- Doesn't address the input validation gap

**Effort:** 30 minutes

**Risk:** Low

---

## Recommended Action

**To be filled during triage.** Option 1 is the correct approach: validate at the boundary.

## Technical Details

**Affected files:**
- `app/api/analyze/route.ts:20-23, 39` — add `.max()` constraints

## Resources

- **PR:** #12

## Acceptance Criteria

- [ ] `handContext` has `.max(5000)` or similar reasonable limit
- [ ] `opponentHistory.actions` has array length `.max()` and per-item `.max()`
- [ ] Oversized requests return a 400 with a descriptive error message

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (security-sentinel agent)
