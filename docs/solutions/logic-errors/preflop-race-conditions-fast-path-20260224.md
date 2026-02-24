---
module: poker-content
date: 2026-02-24
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Second DOM click on same hand in play mode — pre-fetch response fires after fast-path already acted"
  - "Hero folds strong preflop hands intermittently when the raise is a RAISE action"
  - "Console shows 'Bet input absent' abort but no action taken — watchdog FOLD fires instead"
  - "Pre-fetch guard bypassed in play mode (monitor-only condition was never satisfied)"
root_cause: async_timing
resolution_type: code_fix
severity: high
tags: [preflop, fast-path, race-condition, pre-fetch, bet-input, animation-delay, watchdog, play-mode, poker-content]
---

# Three Preflop Fast-Path Race Conditions (Issues 101–103)

## Problem

Three separate timing races in the preflop fast-path execution path in
`extension/src/poker-content.ts`, all introduced or left open when the fast-path
was added. Together they could produce a double action (two DOM clicks per hand) or
a silent abort that triggers a watchdog FOLD on a strong hand.

---

## Race 101 — Stale Pre-fetch Guard Was Monitor-Only

### Symptom

In play mode, when the Claude pre-fetch response arrives after the fast-path already
acted, `onDecisionReceived` does **not** discard the stale result and executes a
second DOM action on the same hand.

### Root Cause

```typescript
// BEFORE (broken) — guard only applies to monitor mode:
if (autopilotMode === "monitor" && preflopFastPathFired) {
  console.log("Discarding stale pre-fetch — preflop fast-path already acted");
  executing = false;
  return;
}
```

The `&& autopilotMode === "monitor"` condition was intended as a conservative first
pass, but it leaves play mode completely unprotected from the identical race. The
pre-fetch arrives, `preflopFastPathFired` is true, but the guard does not fire
because the mode is `"play"`.

### Fix

Remove the mode check — the guard must protect both modes symmetrically:

```typescript
// AFTER (fixed):
if (preflopFastPathFired) {
  console.log(`[Poker] [${autopilotMode.toUpperCase()}] Discarding stale pre-fetch — preflop fast-path already acted`);
  executing = false;
  return;
}
```

---

## Race 102 — preflopFastPathFired Set Too Late (Pre-tick Race Window)

### Symptom

Pre-fetch response arrives between the time `requestDecision()` fires (at hand start)
and the hero-turn tick that executes the fast-path. `preflopFastPathFired` is still
`false`, so the Race 101 guard passes and Claude acts. On the next tick the fast-path
also fires → two actions on one hand.

### Root Cause

```
T+0ms   hand starts → requestDecision() fired (pre-fetch)
T+??ms  Claude pre-fetch response arrives
          → onDecisionReceived runs
          → preflopFastPathFired == false  ← guard does NOT fire
          → safeExecuteAction called  ← FIRST action
T+??ms  MutationObserver debounce fires hero-turn tick
          → preflop fast-path executes
          → safeExecuteAction called again  ← SECOND action (double-click)
```

The Race 101 fix (`preflopFastPathFired` guard) cannot help here because the flag is
set in the fast-path execution block, which runs **after** `onDecisionReceived`.

### Fix

Add a second guard in `onDecisionReceived`: if `lastPersonaRec` is loaded and the
hand is still preflop (`communityCards.length === 0`), discard the pre-fetch
proactively — the fast-path will handle the action on the next tick:

```typescript
// Also discard if still preflop and persona is loaded but fast-path hasn't fired yet.
// The fast-path will act on the next tick; letting the pre-fetch through produces two actions.
if (lastPersonaRec && lastState && lastState.communityCards.length === 0) {
  console.log(`[Poker] [${autopilotMode.toUpperCase()}] Discarding pre-fetch — persona chart will handle preflop`);
  executing = false;
  return;
}
```

This guard fires before the fast-path has run, so it covers the window that Race 101
cannot.

---

## Race 103 — Bet Input Absent → Silent Abort → Watchdog FOLD

### Symptom

Hero folds a strong preflop hand. The console shows:
```
[Poker] Bet input absent after retries — aborting raise
```
The watchdog fires a FOLD approximately 8–15 seconds later because `executing` is
still `true` but no action was submitted.

### Root Cause

Playtech animates its action buttons: the RAISE button appears in the DOM ~150–300ms
after the MutationObserver fires the hero-turn detection. The fast-path fires ~200ms
after hero-turn is detected (debounce). If `safeExecuteAction` is called in this
narrow window, `.betInput` is not yet in the DOM:

```typescript
// BEFORE (broken) — single query, no retry:
const betInput = document.querySelector<HTMLInputElement>(".betInput, [data-bet-input]");
if (!betInput) {
  console.warn("[Poker] Bet input absent — aborting raise");
  return; // executing stays true → watchdog fires FOLD
}
```

The `return` leaves `executing = true`, which is correct behaviour to prevent
re-entry, but the watchdog interprets the absent response as a hung action and FOLDs.

### Fix

Retry the querySelector up to 3 times with 100ms sleeps before aborting:

```typescript
// AFTER (fixed) — retry loop with 3×100ms:
let betInput = document.querySelector<HTMLInputElement>(".betInput, [data-bet-input]");
if (!betInput) {
  for (let i = 0; i < 3 && !betInput; i++) {
    await new Promise((r) => setTimeout(r, 100));
    betInput = document.querySelector<HTMLInputElement>(".betInput, [data-bet-input]");
  }
}
if (!betInput) {
  console.warn("[Poker] Bet input absent after retries — aborting raise");
  return;
}
```

Three retries × 100ms = 300ms extra tolerance, which covers Playtech's 150–300ms
animation window with a safety margin.

---

## Why These Races Exist Together

All three races share the same structural cause: the preflop fast-path fires on a
`MutationObserver` debounce tick, but two other async events can interleave with it:

1. **The Claude pre-fetch** — fired at hand start, resolves asynchronously.
2. **DOM animation** — Playtech renders action buttons 150–300ms after the tick that
   detects hero's turn.

The fast-path flag (`preflopFastPathFired`) was designed to solve the pre-fetch race,
but its placement (set after decision, not before) and its original mode guard left
two additional windows open. The bet-input retry is independent — it addresses the
animation lag window.

---

## Prevention

- When introducing a "fast-path fires before async responder" pattern, place the
  guard flag **before** the fast-path body, not inside it.
- Never restrict a "discard stale result" guard to a single mode — if the race exists
  in one mode it exists in all modes that share the same code path.
- Add a second pre-emptive guard for the "response arrives before fast-path fires"
  window: if persona chart is loaded and we're still on street zero, no async response
  should proceed.
- For any DOM query that depends on CSS-animated UI elements (Playtech or otherwise),
  always add a retry loop with a sleep — single querySelector is fragile.
- Pattern: "query with retry" — up to N attempts, M ms apart, before hard abort.

## Related Issues

- See: `docs/solutions/logic-errors/preflop-prefetch-overwrites-fast-path-20260224.md`
  for the original pre-fetch overwrite race (monitor-mode only, fixed in prior session).
- See: `docs/solutions/logic-errors/continuous-capture-race-conditions.md` for
  async timing races in the React capture pipeline (different layer, same class of bug).
- See: `docs/solutions/logic-errors/preflop-bb-derivation-limped-pots-20260224.md`
  for the BB calculation bug fixed in the same session as Race 101–103.
