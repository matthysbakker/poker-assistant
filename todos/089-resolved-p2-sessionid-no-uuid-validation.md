---
status: pending
priority: p2
issue_id: "089"
tags: [code-review, security, quality]
dependencies: []
---

# sessionId and pokerHandId Accept Arbitrary Strings — No UUID Validation

## Problem Statement

Both `sessionId` and `pokerHandId` in the `/api/analyze` request schema use `z.string().optional()` with no format constraint. These values are written to persistent JSON hand records on disk. An attacker (or bug) can inject arbitrary strings — including path-traversal fragments, embedded newlines, or JSON-breaking sequences — that corrupt analytics output.

## Findings

- `app/api/analyze/route.ts:42-43` — both fields are bare `z.string()`
- The values are written directly to `HandRecord.sessionId` and `HandRecord.pokerHandId` on disk
- `scripts/query-hands.ts` reads them back without validation and renders them in `console.log()` output
- The canonical source (page.tsx and state-machine.ts) generates UUIDs via `crypto.randomUUID()` — the format is already fixed; the API just doesn't enforce it
- Security agent: "A caller can inject adversarial strings... that corrupt analytics output and could cause unexpected behavior in downstream tooling"

## Proposed Solutions

### Option 1: Add .uuid() constraint (Recommended)

**Approach:**
```ts
sessionId: z.string().uuid().optional(),
pokerHandId: z.string().uuid().nullable().optional(),
```

**Pros:**
- Trivial addition
- Enforces the contract that already exists in the client
- Prevents analytics data poisoning

**Cons:**
- None — UUIDs are the only values ever sent from the legitimate client

**Effort:** 5 minutes

**Risk:** Low

---

## Recommended Action

**To be filled during triage.** Add `.uuid()` to both fields. Fastest fix in this PR.

## Technical Details

**Affected files:**
- `app/api/analyze/route.ts:42-43`

## Resources

- **PR:** #12

## Acceptance Criteria

- [ ] `sessionId` uses `z.string().uuid().optional()`
- [ ] `pokerHandId` uses `z.string().uuid().nullable().optional()`
- [ ] Non-UUID values return 400

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (security-sentinel agent)
