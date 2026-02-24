---
module: poker-content
date: 2026-02-24
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Preflop open-raise is 30–70% too large whenever one or more players limped"
  - "Raise size grows proportionally with each limper (one limper: ~67% too large, two limpers: ~133%)"
  - "Correct raise with no limpers; oversized raise with limpers in the same session"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [preflop, bb-derivation, limped-pot, raise-sizing, pot-odds, poker-content]
---

# Preflop Raise Sizing Wrong on Limped Pots

## Problem

The preflop fast-path computes an open-raise amount as `multiplier × BB`. The BB
value was derived from the pot size at hand start using `pot / 1.5`, which is only
correct when no one has limped (pot = SB + BB = 1.5BB). With one limper the pot is
2.5BB, so `pot / 1.5 = 1.67BB` — the formula returns a "BB" that is 67% too large,
and the raise is scaled up by the same factor.

## Environment

- Module: `extension/src/poker-content.ts`
- Affected Component: preflop fast-path raise-sizing block (~line 1402–1430)
- Date: 2026-02-24

## Symptoms

- Preflop open-raise is 30–70% too large whenever one or more players limped before
  hero acts.
- The sizing grows with each limper: 0 limpers → correct, 1 limper → ~67% over, 2
  limpers → ~133% over.
- Works correctly on hands where no one has limped.

## What Didn't Work

**Original approach — derive BB from pot:**
```typescript
// BEFORE (broken):
const pot = parseCurrency(state.pot);
const bb = pot / 1.5; // assumes pot = SB + BB = 1.5BB
const preflopAmount = Math.round(bb * multiplier * 100) / 100;
```

- **Why it failed:** The assumption `pot = 1.5BB` only holds when zero limpers have
  entered. Each limper adds 1BB to the pot, so with N limpers `pot = (1.5 + N) × BB`.
  Dividing by 1.5 inflates the implied BB proportionally to the number of limpers.

The `facingRaise` guard that skips the fast-path when hero faces a re-raise does
**not** protect against limpers — a limped pot is not a raised pot.

## Solution

Read the BB directly from the BB player's posted bet in `state.players`, which is
always exactly 1BB regardless of how many players have limped.

```typescript
// AFTER (fixed):
const activePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);
const bbPlayer = state.players.find(
  (p) => p.name && getPosition(p.seat, state.dealerSeat, activePlayers.length) === "BB"
);
const bbFromPlayer = bbPlayer ? parseCurrency(bbPlayer.bet) : 0;
if (bbFromPlayer > 0) {
  bb = bbFromPlayer;
} else {
  // BB player's bet not yet visible in the DOM (rare animation edge case)
  const pot = parseCurrency(state.pot);
  if (pot > 0) {
    bb = pot / 1.5;
    console.warn("[Poker] [Preflop] BB player bet not visible — falling back to pot / 1.5");
  }
}
if (bb !== null && bb > 0) {
  preflopAmount = Math.round(bb * multiplier * 100) / 100;
}
```

The fallback to `pot / 1.5` is retained only for the narrow case where the BB
player's bet element has not yet rendered, with an explicit `console.warn` to make
that path visible in logs.

## Why This Works

1. **Root cause:** `pot / 1.5` embeds the assumption of a heads-up-blind-only pot.
   The pot grows with each limper but the divisor stays fixed, so the derived BB
   grows with each limper.
2. **Why the fix is correct:** The BB player always posts exactly 1BB. Reading
   `bbPlayer.bet` from the DOM gives the exact blind value regardless of how many
   players have limped, raised, or folded before hero acts.
3. **Why `facingRaise` did not help:** `facingRaise` is true only when someone has
   raised above the BB. A limper merely calls the BB — the game considers it a flat
   call — so `facingRaise` remains false and the fast-path still fires.

## Prevention

- Never derive the big blind from the pot. Pot is contaminated by position-dependent
  action (limps, antes, straddles). Always read the BB from the BB player's posted bet.
- When computing "X times BB" multipliers, ensure `bb` is sourced from a player
  record rather than a pot arithmetic shortcut.
- Add a sanity log: `[Poker] [Preflop] bb=€X multiplier=Y → raise=€Z` so raise
  sizing bugs surface immediately in the console during live testing.

## Related Issues

- See: `docs/solutions/logic-errors/preflop-race-conditions-fast-path-20260224.md`
  for timing issues in the same fast-path execution block.
- See: `docs/solutions/logic-errors/preflop-prefetch-overwrites-fast-path-20260224.md`
  for the stale pre-fetch race that was fixed alongside this issue.
