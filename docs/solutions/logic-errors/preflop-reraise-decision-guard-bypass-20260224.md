---
id: "preflop-reraise-decision-guard-bypass"
type: "logic-error"
category: "hand-tracking"
module: "autopilot-preflop-fast-path"
severity: "high"
date: "2026-02-24"

tags:
  - "preflop"
  - "reraise"
  - "decision-guard"
  - "fast-path"
  - "preflopFastPathFired"
  - "hero-turn-detection"
  - "autopilot"
  - "onDecisionReceived"

affected-files:
  - "extension/src/poker-content.ts"

symptoms:
  - "No advice shown when opponent re-raises preflop and action returns to hero"
  - "Overlay displays no recommendation after hero opens, opponent 3-bets, action back to hero"
  - "Console: Claude decision computed and returned but silently discarded"
  - "Works on initial preflop action, fails on any subsequent facing-raise spot in same hand"

related:
  - "docs/solutions/logic-errors/preflop-race-conditions-fast-path-20260224.md"
  - "docs/solutions/logic-errors/preflop-prefetch-overwrites-fast-path-20260224.md"
  - "docs/solutions/logic-errors/preflop-fast-path-silent-record-omission-20260224.md"
---

# Preflop Re-raise Decision Guard Bypass

## Problem

After the preflop persona chart ("fast-path") fires for hero's opening action, no advice is shown when an opponent re-raises and action comes back to hero. The system correctly detects the hero-turn rising edge and calls `requestDecision()`, but the Claude response is silently discarded in `onDecisionReceived()`.

## Root Cause

`onDecisionReceived()` contains guards to discard stale pre-fetch responses — Claude decisions that were speculatively requested at hand-start before hero's first turn. The guards used `preflopFastPathFired` to detect this:

```typescript
// BEFORE — unconditional discard
if (preflopFastPathFired) {
  console.log(`Discarding stale pre-fetch — preflop fast-path already acted`);
  executing = false;
  return;
}
```

`preflopFastPathFired` is set to `true` when the persona chart fires (e.g. hero opens with a raise). The guard was correct for its original purpose: blocking the stale pre-fetch response.

**The gap**: the guard is unconditional. When an opponent re-raises and `processGameState()` detects the rising edge, `requestDecision()` is explicitly called again — a legitimate new request. But `onDecisionReceived()` still sees `preflopFastPathFired === true` and discards the response, regardless of whether it's from the old pre-fetch or the new explicit request.

The second guard had the same blind spot:

```typescript
// BEFORE — also discards during facing-raise
if (lastPersonaRec && lastState && lastState.communityCards.length === 0) {
  // ...falls into discard path even when hero is facing a raise
}
```

## Fix

Compute `heroFacingRaiseNow` once at the top of `onDecisionReceived()` — a check against the live `lastState` — and use it to exempt facing-raise scenarios from both guards.

```typescript
// extension/src/poker-content.ts — onDecisionReceived()

// Check if hero is currently facing a raise — the fast-path only handles RFI spots,
// so any decision arriving while facing a raise is a legitimate explicit request.
const heroFacingRaiseNow = lastState?.availableActions.some(
  (a) => a.type === "CALL" && parseFloat((a.amount ?? "0").replace(/[€$£,]/g, "")) > 0,
) ?? false;

// Guard 1: stale pre-fetch after fast-path
// Exception: hero is facing a raise → fast-path was bypassed, this is a real decision.
if (preflopFastPathFired && !heroFacingRaiseNow) {
  console.log(`Discarding stale pre-fetch — preflop fast-path already acted`);
  executing = false;
  return;
}

// Guard 2: pre-fetch arrived before fast-path
// Exception: hero is facing a raise → fast-path is bypassed, keep this decision.
if (lastPersonaRec && lastState && lastState.communityCards.length === 0 && !heroFacingRaiseNow) {
  console.log(`Discarding pre-fetch — persona chart will handle preflop`);
  executing = false;
  return;
}

// Guard 3: pre-fetch arrived while facing a raise but fast-path hasn't fired yet.
// Pre-fetch is stale (pre-raise state) — discard it and request a fresh decision.
if (lastPersonaRec && lastState && lastState.communityCards.length === 0 && heroFacingRaiseNow && !preflopFastPathFired) {
  executing = false;
  if (lastState.isHeroTurn && handMessages.length > 0) {
    const turnMsg = buildTurnMessage(lastState);
    if (turnMsg.trim()) handMessages.push({ role: "user", content: turnMsg });
    requestDecision([...handMessages]);
  }
  return;
}

safeExecuteAction(action, "claude");
```

## Why It Works

`heroFacingRaiseNow` checks live game state at decision-acceptance time, not at decision-request time. When a CALL action with amount > 0 is present, hero is facing a bet/raise — the fast-path was bypassed for this action round, so any incoming Claude decision is the one explicitly requested, not a stale pre-fetch.

The three scenarios are now cleanly separated:

| Scenario | `preflopFastPathFired` | `heroFacingRaiseNow` | Result |
|----------|------------------------|----------------------|--------|
| Stale pre-fetch arrives after fast-path | `true` | `false` | Discard ✓ |
| Re-raise after fast-path, explicit request | `true` | `true` | Execute ✓ |
| Pre-fetch arrives before fast-path, RFI spot | `false` | `false` | Discard (persona chart handles it) ✓ |
| Pre-fetch arrives before fast-path, facing raise | `false` | `true` | Discard stale + request fresh ✓ |

## Prevention

**Check state at decision-acceptance time, not at request time.** The `preflopFastPathFired` flag represents conditions at request time. Game state can change between request and response (opponent raises). Evaluating `heroFacingRaiseNow` from `lastState` at the moment the response arrives gives ground truth about the current situation.

**Make guards explicit about their intent.** `if (preflopFastPathFired)` is ambiguous — it could mean "stale pre-fetch" or "any Claude response after fast-path". The fix uses `preflopFastPathFired && !heroFacingRaiseNow`, which precisely states: "stale pre-fetch in an unchanged RFI scenario".

**Each async guard needs a distinct exemption path.** When stacking guards for different race conditions, consider what legitimate cases each guard might also catch and add exemptions for them.

## Related Context

This is a natural progression of the pre-fetch guard pattern:
1. **`preflop-prefetch-overwrites-fast-path`** → Original race: stale pre-fetch overwrites fast-path action
2. **`preflop-race-conditions-fast-path`** → Broader guard added, covering multiple race windows
3. **This fix** → Guard refined to be context-aware (allows legitimate re-raise decisions through)
