---
status: pending
priority: p2
issue_id: "094"
tags: [code-review, architecture, quality]
dependencies: []
---

# pokerHandId Generated in Two Independent Callsites with No Shared Abstraction

## Problem Statement

`crypto.randomUUID()` is called for poker hand IDs in two different places with different semantics, no shared abstraction, and no documentation of the distinction. Adding a third capture path (e.g., an extension mode) would require a third independent UUID call.

## Findings

- `lib/hand-tracking/state-machine.ts:143-146` — generates `pokerHandId` at `WAITING → PREFLOP` transition (after 2-frame hysteresis). Tied to a confirmed hand boundary.
- `app/page.tsx:63` — generates `manualPokerHandIdRef.current = crypto.randomUUID()` in the CAPTURE message handler. Tied to a capture event, not a confirmed street transition.
- The semantics differ: continuous-mode IDs are post-hysteresis confirmed hands; manual-mode IDs are per-capture-event. There's no comment documenting this.
- Architecture agent: "there is no documentation of this distinction, and adding a third capture path requires a third independent UUID call"

## Proposed Solutions

### Option 1: Extract generatePokerHandId() factory (Recommended)

**Approach:** Create a small factory function in `lib/hand-tracking/`:

```ts
// lib/hand-tracking/poker-hand-id.ts
export function generatePokerHandId(): string {
  return crypto.randomUUID();
}
```

Import and call it from both `state-machine.ts` and `page.tsx`. Add a JSDoc comment explaining the semantic difference between the two call sites.

**Pros:**
- Single searchable pattern
- Documents that both paths use the same ID format
- Future capture paths can follow the established convention

**Cons:**
- Very thin abstraction — mostly organizational

**Effort:** 15 minutes

**Risk:** None

---

### Option 2: Document the distinction inline (Minimal fix)

**Approach:** Add comments at both call sites explaining the semantic difference and the reason for separate generation.

**Pros:**
- No new files or abstractions

**Cons:**
- Two places still need to stay in sync

**Effort:** 5 minutes

**Risk:** None

---

## Recommended Action

**To be filled during triage.** Option 2 is sufficient for a personal tool. Option 1 if the codebase is expected to grow.

## Technical Details

**Affected files:**
- `lib/hand-tracking/state-machine.ts:143-146`
- `app/page.tsx:63`

## Resources

- **PR:** #12

## Acceptance Criteria

- [ ] Both callsites documented with comments explaining their distinct semantics, OR
- [ ] Shared `generatePokerHandId()` function used at both call sites

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (architecture-strategist agent)
