# Review: preflop fast-path diff — poker-content.ts
**Date:** 2026-02-24
**Reviewed by:** Code Pattern Analysis Agent

## Summary

This review covers four concerns raised against the preflop fast-path diff
added to `extension/src/poker-content.ts`.  Issues are classified by severity
and numbered for easy tracking.

---

## Critical Issues

- [ ] **100-p1: `pot / 1.5` BB derivation breaks on limped pots and antes**
  `extension/src/poker-content.ts` line 1392

  The comment on line 1387 states the assumption explicitly:
  `// In an unraised pot: pot = SB + BB = 1.5 × BB`.
  This assumption fails in at least three real situations:

  1. **Limpers.** Each limper adds 1 BB to the pot before the fast-path runs.
     A single limper makes the pot 2.5 BB, so `pot / 1.5 = 1.67 BB` instead of
     the correct 1 BB. Open-raise multipliers are then applied to this inflated
     base, producing a systematically undersized raise (e.g. `1.67 × 2.5 =
     4.17 BB` instead of the correct `2.5 BB` over the limp, or worse: the
     raise should be sized against the limp, not the blind level at all).
  2. **Antes.** Some formats post antes on top of the two blinds, making the
     pot `> 1.5 BB` even in an unraised pot and inflating `bb` further.
  3. **Partial blind posts.** When a new player posts a dead blind or a
     short-stacked player posts less than a full BB, the `/ 1.5` assumption no
     longer holds.

  The `facingRaise` guard (line 1371–1373) already correctly blocks the
  fast-path when there is a call amount, but it does NOT block it when there
  are limpers — limpers do not produce a CALL action for the raiser; the raiser
  sees CHECK or RAISE options, so `facingRaise` is false and the fast-path
  proceeds.

  The safe recovery is to read the BB directly from the DOM (the big blind
  amount is usually visible in the pot/blind display or can be parsed from
  `state.players[BB_seat].bet`), or to fall back to the DOM slider amount
  when the computed value differs significantly from `state.availableActions`
  RAISE/BET `amount` fields.

- [ ] **101-p1: stale pre-fetch guard is missing for `autopilotMode === "play"`**
  `extension/src/poker-content.ts` line 1070

  The guard reads:
  ```typescript
  if (autopilotMode === "monitor" && preflopFastPathFired) {
  ```
  In "play" mode the fast-path fires (line 1374 only requires `autopilotMode !== "off"`),
  `preflopFastPathFired` is set, and `safeExecuteAction` actually clicks a
  button on the real-money DOM. If a pre-fetch was in flight when the fast-path
  ran, the delayed AUTOPILOT_ACTION will arrive at `onDecisionReceived` shortly
  after. Because the guard is `monitor`-only, the code falls through to
  `safeExecuteAction(action, "claude")` on line 1076, and in "play" mode that
  calls `executeAction()` and clicks a second action button on the same
  hand — a double-action against real money.

  The condition should be:
  ```typescript
  if (preflopFastPathFired) {
  ```
  covering both "monitor" and "play" modes. The monitor-specific log message
  can be kept inside a nested `if (autopilotMode === "monitor")` block.

---

## High Priority

- [ ] **102-p2: race condition — `preflopFastPathFired` set while pre-fetch is in flight**
  `extension/src/poker-content.ts` lines 1325–1327, 1383–1384

  Timeline:
  1. New hand detected → `preflopFastPathFired = false`.
  2. `requestDecision([...handMessages])` fires, which sets `executing = true`
     and sends AUTOPILOT_DECIDE to background. The network call is in flight.
  3. Meanwhile, hero's turn arrives on the next DOM tick (~200 ms later, per
     the debounce at line 1241).
  4. `executing` is `true`, so the hero-turn block guard `!executing` (line
     1333) prevents the fast-path from running. `preflopFastPathFired` is never
     set to `true`.
  5. The pre-fetch AUTOPILOT_ACTION arrives. `preflopFastPathFired` is false.
     The guard in `onDecisionReceived` does not discard it. In "play" mode
     Claude's action is executed.

  This is the expected happy path when the pre-fetch completes after hero's turn
  and the fast-path is blocked by `executing`. The concern is a narrower race:

  - If the pre-fetch response arrives **after** `executing` is cleared by
    `requestDecision`'s synchronous return but **before** the hero-turn
    rising edge is processed, the ordering inverts: `onDecisionReceived` runs,
    clears `executing`, then the hero-turn block fires, persona IS available,
    fast-path runs, sets `preflopFastPathFired = true` — but AUTOPILOT_ACTION
    already executed. In this case the flag is set too late to protect anything.

  The real fix is for `onDecisionReceived` to check whether it is still
  hero's turn before executing, or to store a `preflopPreFetchRequestId` and
  discard responses that belong to a pre-fetch generation. The current flag
  approach is correct for the common case but has a narrow window of
  vulnerability.

---

## Low Priority / Nice-to-Have

- [ ] **103-p3: `SUIT_NAMES` defined inside `buildHandStartMessage` on every call**
  `extension/src/poker-content.ts` line 618

  ```typescript
  const SUIT_NAMES: Record<string, string> = { d: "diamonds", h: "hearts", s: "spades", c: "clubs" };
  ```

  This is declared inside `buildHandStartMessage()`. In normal usage this
  function is called once per hand start, so the allocation cost is negligible.
  The function is not on the hot `processGameState` path (which runs on every
  DOM mutation). This is a style issue, not a performance issue. Moving
  `SUIT_NAMES` to module scope alongside `SUIT_MAP` would be cleaner for
  consistency but carries no practical impact.

---

## Passed / No Action Needed

- **`facingRaise` guard (line 1371–1373):** Correctly blocks the fast-path
  when hero is facing a raise. Uses `parseFloat` with regex strip rather than
  `parseCurrency()`, but produces the same result for the `> 0` comparison.

- **`executing` mutex:** Correctly set to `true` before `preflopFastPathFired`
  is set (line 1383), so re-entrant calls cannot race on the flag itself.

- **`preflopFastPathFired = false` on hand reset (line 1305):** Correctly
  cleared before any new-hand code runs.

- **Raise multiplier table (lines 1397):** `2.5x` for BTN/CO, `3.0x` for
  all other positions is a standard GTO open-raise sizing convention. No issue
  with the multipliers themselves; the issue is with the BB base they are
  applied to (see issue 100 above).

- **`Math.round(... * 100) / 100` rounding (line 1398):** Correct two-decimal
  rounding for a euro amount.

- **`const pos = rawPos === "BTN/SB" ? "BTN" : rawPos` (line 1395):** Correctly
  normalises the 2-player edge case.

- **`bbTag` debug log (lines 1401–1403):** Recomputes `parseCurrency(state.pot)
  / 1.5` a second time rather than reusing `bb`. This is a very minor
  redundancy (one extra division in a non-hot path) but not worth a dedicated
  todo given the larger issue 100 which would change this computation anyway.

---

## INCOMPLETE

Issues 100 and 101 need fixes before this diff ships to a real-money session.
Issue 102 is a narrower race that is acceptable for monitored use but should
be tracked.
