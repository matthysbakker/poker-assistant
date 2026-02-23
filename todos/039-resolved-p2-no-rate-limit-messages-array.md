---
status: pending
priority: p2
issue_id: "039"
tags: [code-review, security, api, autopilot, rate-limiting]
dependencies: []
---

# No Rate Limiting or Content Bounds on `/api/autopilot` Messages Array

## Problem Statement

The `/api/autopilot` route validates message role/content types but places no limits on message count or individual content length. A runaway extension loop (e.g. the MutationObserver feedback loop from todo 032) or a hostile local caller can submit unbounded messages, each triggering a full Claude API call, rapidly exhausting API quota.

## Findings

- `app/api/autopilot/route.ts:9-16` — `messages: z.array(messageSchema).min(1)` — no `.max()`
- `app/api/autopilot/route.ts:11` — `content: z.string()` — no `.max()`
- A single poker hand with 4 streets × multiple turns accumulates ~8-12 messages realistically; anything above ~20 is anomalous
- Content from DOM HTML dumps in monitor mode could be unexpectedly large if passed through
- Security review (2026-02-23, CRIT-3): "A runaway extension loop can exhaust the Anthropic API quota in seconds"

## Proposed Solutions

### Option A: Add `.max()` bounds to the schema (Recommended)
```typescript
const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000),  // ~1 poker street of context
});
const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(20),  // max ~5 streets × 4 messages
});
```
**Pros:** One-line change; validates with existing Zod pipeline; 400 returned on oversized requests
**Cons:** None
**Effort:** 2 lines
**Risk:** None — legitimate poker hands fit easily within these bounds

### Option B: Add per-IP rate limiting middleware
Use a simple in-memory counter (since this is local-only):
```typescript
const callsThisMinute = new Map<string, number>();
```
**Pros:** Prevents quota exhaustion from rapid repeated calls
**Cons:** Overkill for a localhost tool; stateful in serverless context
**Effort:** Medium
**Risk:** Low

### Option C: Status quo
**Pros:** None
**Cons:** Any malfunction → potential large API bill
**Risk:** Medium

## Recommended Action

Option A. Adding `.max()` bounds is a 2-line change that eliminates the category of risk without any complexity.

## Technical Details

- **File:** `app/api/autopilot/route.ts:9-16`

## Acceptance Criteria

- [ ] `messages` array limited to max 20 entries
- [ ] Each `content` string limited to max 4000 characters
- [ ] Oversized requests return 400 with clear error message
- [ ] Legitimate poker conversation (8-12 messages, normal length) passes validation

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by security-sentinel (CRIT-3). 2-line fix.
