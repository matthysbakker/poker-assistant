---
status: pending
priority: p2
issue_id: "044"
tags: [code-review, correctness, autopilot, poker-logic, ai-context]
dependencies: []
---

# Opponent Bet Information Lost When Pot Consolidates Between Hero Turns

## Problem Statement

`buildTurnMessage()` diffs `state.players[i].bet` against `lastState.players[i].bet` to detect opponent actions. On Playtech, bet chip displays are cleared from the DOM after the pot is consolidated at street end. If the 200ms debounce coalesces a bet→cleared→new-street sequence into a single scrape, `lastState` already shows zeroed bets and the diff sees nothing. The opponent's raise on the previous street is never recorded in Claude's conversation context.

## Findings

- `extension/src/poker-content.ts:491-499` — `if (p.bet !== prev.bet && p.bet)` — condition fails when current `p.bet === ""` (cleared) and `prev.bet === ""` (was already cleared by consolidation)
- `extension/src/poker-content.ts:200` — 200ms debounce can coalesce multiple mutations
- Architecture review (2026-02-23, H2): "A bet→cleared→new-street sequence can collapse into a single scrape that sees neither the bet nor the prior state"
- This means Claude's context may omit "Villain raises to €0.08" when the bet was consolidated before the next debounce fired

## Proposed Solutions

### Option A: Accumulate action log across states (Recommended)
Maintain a separate `streetActions: string[]` array that records actions as they are detected. Append to this on every `processGameState` call. Build the turn message from the accumulated log rather than a snapshot diff:
```typescript
let streetActions: string[] = [];

// In processGameState, after scrape:
for (const p of state.players) {
  const prev = lastState?.players.find(lp => lp.seat === p.seat);
  if (prev && p.bet !== prev.bet && p.bet) {
    streetActions.push(`${p.name} bets/raises to ${p.bet}.`);
  }
  if (prev && p.folded && !prev.folded) {
    streetActions.push(`${p.name} folds.`);
  }
}

// Reset on new street:
if (newStreet) streetActions = [];
```
**Pros:** Actions are recorded when they happen, not when hero's turn arrives
**Cons:** Requires street-change detection logic
**Effort:** Medium
**Risk:** Low

### Option B: Increase context window by passing full player history
Include all player states in every hero-turn message (not just diffs), so Claude always sees current stacks and status:
```typescript
// Always include full player table in turn message
lines.push(state.players.filter(p => p.name).map(p =>
  `${p.name}: ${p.stack}${p.folded ? " [folded]" : ""}`
).join(", "));
```
**Pros:** Never loses information; simple to implement
**Cons:** Larger context; doesn't explicitly state "Villain raised to X"
**Effort:** Small
**Risk:** None

### Option C: Status quo (diff-based)
**Pros:** Simple code
**Cons:** Opponent actions lost during pot consolidation windows
**Risk:** Medium (Claude lacks context about prior aggression)

## Recommended Action

Option A. Building an action log that accumulates within a street is the correct pattern for tracking poker actions between scrapes.

## Technical Details

- **File:** `extension/src/poker-content.ts:467-515`
- New hand resets: `extension/src/poker-content.ts:793-804` — also reset `streetActions` there
- Street transitions already detected at `extension/src/poker-content.ts:476-488`

## Acceptance Criteria

- [ ] Opponent folds and bets recorded even if pot consolidates before hero's turn
- [ ] Street action log resets on new street (FLOP, TURN, RIVER, new hand)
- [ ] `buildTurnMessage` includes all actions since last hero turn, not just current diff

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by architecture-strategist (H2). Affects Claude's decision quality on every multi-way pot.
