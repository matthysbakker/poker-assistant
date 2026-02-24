---
status: pending
priority: p1
issue_id: "100"
tags: [code-review, correctness, preflop, raise-sizing, play-mode]
dependencies: []
---

# Preflop Raise Sizing Wrong on Limped Pots (pot / 1.5 formula breaks)

## Problem Statement

The fast-path raise amount uses `bb = pot / 1.5` assuming the pot at hero's turn equals exactly SB + BB = 1.5 BB. With one limper, the pot is 2.5 BB, so `pot / 1.5 = 1.67 BB`. Applying the 3× multiplier produces a 5.0 BB open instead of the correct 3–4 BB. In play mode, hero systematically over-raises on every limped pot, burning chips.

The `facingRaise` guard does NOT protect against this — limpers do not produce a CALL action for the opener.

## Findings

- `extension/src/poker-content.ts:1392` — `const bb = pot / 1.5;`
- Breaks with: limpers (pot = 2.5+ BB), antes (pot > 1.5 BB), SB completing HU (pot = 2 BB)
- Example: €0.05/€0.10 table, one limper → pot = €0.25 → `bb = €0.167` → raise = `€0.167 × 3 = €0.50` instead of €0.30
- Flagged independently by pattern-recognition-specialist and security-sentinel

## Proposed Solutions

### Option A: Read BB from state.players (Recommended)
Find the player occupying the BB seat (2 positions clockwise from dealer) and use their `bet` field:
```typescript
const bbPlayer = state.players.find((p) => {
  const pos = getPosition(p.seat, state.dealerSeat, activePlayers.length);
  return pos === "BB";
});
const bb = bbPlayer ? parseCurrency(bbPlayer.bet) : pot / 1.5; // fall back with warning
if (!bbPlayer) console.warn("[Poker] [Preflop] Could not find BB player — using pot/1.5 fallback");
```
**Pros:** Exact, works with limpers/antes/straddles
**Cons:** Requires `p.seat` and `p.bet` to be populated on the BB player

### Option B: Guard on pot <= 1.5 * (last known BB)
Store the BB amount from the first hand and validate subsequent pot readings against it.
**Pros:** Cheap
**Cons:** Requires persisting BB value across ticks

### Option C: Fall back to Claude when pot > expected
If `pot / 1.5` seems implausible (e.g. > 2 × BB derived from table stakes), skip the fast-path.
**Pros:** Safe fallback
**Cons:** Loses the speed advantage of the fast-path on limped pots

## Recommended Action

Option A. The BB player's `bet` field should be populated in the player array from the game state scraper.

## Technical Details

- File: `extension/src/poker-content.ts`
- Line: ~1392
- Related: `parseCurrency()`, `getPosition()`, `state.players`

## Acceptance Criteria

- [ ] Raise amount is correct (within 1 cent) on an unraised pot (SB + BB only)
- [ ] Raise amount is correct on a pot with 1 limper
- [ ] Raise amount is correct when antes are present
- [ ] Fallback path logs a warning when BB cannot be determined

## Work Log

- 2026-02-24: Found during code review of commits b24f0a9..b81eda6. Flagged by security-sentinel and pattern-recognition-specialist.
