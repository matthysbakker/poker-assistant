---
status: pending
priority: p1
issue_id: "030"
tags: [code-review, correctness, real-money, autopilot, dom-autopilot]
dependencies: []
---

# RAISE/BET Clicks Button Without Entering the Bet Amount

## Problem Statement

Claude computes a calibrated euro amount for RAISE/BET actions (e.g. `amount: 0.15` from pot-relative sizing rules in the system prompt) but `executeAction()` discards it and clicks the button at whatever default size the Playtech client displays. Every aggressive action executes at the wrong size. This is the highest-impact correctness gap for real-money play.

## Findings

- `extension/src/poker-content.ts:664-668` — explicit `// TODO: For RAISE/BET, enter amount in the sizing input first` comment, then `simulateClick(selector)` without entering the amount
- `extension/src/poker-content.ts:621-669` — `executeAction(decision: AutopilotAction)` receives `decision.amount` but never passes it to any input field
- The system prompt at `lib/ai/autopilot-prompt.ts:19-22` instructs Claude to return exact euro amounts (preflop 2.5-3x BB, post-flop 50-75% pot) — those values are computed but silently dropped
- Architecture review (2026-02-23): "every aggressive action uses the wrong size"

## Proposed Solutions

### Option A: Safe fallback — RAISE/BET → CALL/CHECK until Phase 0 complete (Recommended)
In `executeAction()`, when `decision.action` is `"RAISE"` or `"BET"` and the bet input cannot be set, fall through to the next entry in `FALLBACK_MAP` (CALL or CHECK).
```typescript
if ((decision.action === "RAISE" || decision.action === "BET") && !canSetBetAmount()) {
  console.warn("[Poker] RAISE/BET requested but bet input not yet supported, falling back");
  for (const fallback of FALLBACK_MAP[decision.action]) {
    selector = findActionButton(fallback);
    if (selector) break;
  }
}
```
**Pros:** Stops money loss from wrong-sized bets immediately; safe by default
**Cons:** Autopilot plays purely passive until Phase 0 DOM discovery complete
**Effort:** Small
**Risk:** None — passive play is safer than wrong bets

### Option B: Complete Phase 0 DOM discovery and implement bet-input entry
Discover the Playtech bet-input selector, implement amount entry sequence (clear → type amount → confirm), then remove the fallback.
**Pros:** Full functionality
**Cons:** Requires live session with DOM inspector; unknown selector; complex timing
**Effort:** Large (Phase 0 + implementation + testing)
**Risk:** Medium (DOM automation of financial inputs)

### Option C: Log and proceed (status quo)
Keep the TODO comment and accept wrong bet sizes.
**Pros:** None
**Cons:** Real money lost on every RAISE/BET at wrong size
**Effort:** None
**Risk:** High (financial)

## Recommended Action

Option A immediately. Option B as follow-up once DOM structure is known from monitor-mode sessions.

## Technical Details

- **File:** `extension/src/poker-content.ts`
- **Line:** 664-668
- **FALLBACK_MAP at line 539:** RAISE → ["BET", "ALL_IN", "CALL", "CHECK", "FOLD"]

## Acceptance Criteria

- [ ] RAISE/BET actions without a confirmed bet-input path fall back to CALL or CHECK
- [ ] No silent default-size bet is ever executed
- [ ] Log line emitted when fallback fires ("RAISE requested but bet input not implemented")
- [ ] When Phase 0 DOM discovery is complete, bet-input implementation unlocks this path

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by architecture-strategist (critical C1), pattern-recognition-specialist. Blocks real-money use.
