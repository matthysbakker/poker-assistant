---
title: "Pre-fetch API response overwrites fast-path persona advice"
date: 2026-02-24
module: poker-assistant
problem_type: race_condition
component: browser_extension
symptoms:
  - "Overlay briefly shows Claude's reasoning instead of persona-chart action"
  - "Correct RAISE fast-path result replaced by stale pre-fetch response"
  - "monitorAdvice flickers to wrong advice after preflop fast-path has already fired"
root_cause: "requestDecision() called at hand start to pre-warm Claude; async response unconditionally overwrites monitorAdvice even after preflopFastPathFired has already set correct persona-chart action"
severity: high
tags: [preflop, fast-path, async, race-condition, pre-fetch, persona-chart, overlay, monitor-mode]
---

# Pre-fetch API response overwrites fast-path persona advice

## Problem Statement

In monitor mode, when a new hand starts, `requestDecision()` is fired immediately to
pre-warm the Claude API call so advice is ready by the time hero acts. This is the
"pre-fetch" pattern.

However, the preflop fast-path also fires the persona chart decision the instant
hero's turn indicator rises. If the pre-fetch response arrives *after* the fast-path
has already set `monitorAdvice`, `onDecisionReceived` blindly overwrites the correct
persona-chart advice with Claude's (potentially wrong) reasoning.

**Observable symptom:** "4-7 offsuit is a weak hand" shows up in the overlay even
though the cards are 4d 7d (both diamonds). The pre-fetch used an incomplete hand
context and arrived late.

## Root Cause

```
timeline:
  T+0ms   hand starts → requestDecision(handMessages) fired (pre-fetch)
  T+50ms  hero turn indicator appears → preflop fast-path fires
            → executing = true, monitorAdvice = { action: "RAISE", ... }
  T+900ms Claude pre-fetch response arrives
            → onDecisionReceived() runs
            → monitorAdvice OVERWRITTEN with stale Claude result  ← bug
```

`onDecisionReceived` had no awareness that the fast-path had already produced the
authoritative advice for this turn.

## Solution

Add a boolean flag `preflopFastPathFired` that:
1. Is declared as a module-level let (resets with page)
2. Is reset to `false` on every new hand
3. Is set to `true` when the preflop fast-path executes
4. Is checked in `onDecisionReceived` — if `true`, discard the stale result

```typescript
// ── Global declaration ─────────────────────────────────────────────────────
// true once persona chart fires preflop — prevents stale Claude pre-fetch overwriting it
let preflopFastPathFired = false;

// ── Reset on new hand ──────────────────────────────────────────────────────
// (inside new-hand detection block, alongside handMessages = [])
preflopFastPathFired = false;

// ── Set when preflop fast-path executes ───────────────────────────────────
executing = true;
preflopFastPathFired = true; // prevent stale pre-fetch from overwriting this advice

// ── Discard in onDecisionReceived ─────────────────────────────────────────
if (autopilotMode === "monitor" && preflopFastPathFired) {
  console.log("[Poker] [MONITOR] Discarding stale pre-fetch — preflop fast-path already acted");
  executing = false;
  return;
}
```

## Related Issues

- Also fixed: pre-fetch guard now requires `state.heroCards.length === 2` before firing,
  preventing a race where the pre-fetch runs with only 1 visible card and produces an
  "offsuit" description for a suited hand.
- See: `docs/solutions/logic-errors/continuous-capture-race-conditions.md` for other
  timing issues in the capture pipeline.

## Prevention

- Any flag-guarded fast-path that produces authoritative advice must block all later
  async responses for that same turn.
- When pre-fetching Claude at hand start, always guard with "both cards visible" and
  always drop the result if a faster path has already acted.
- Pattern: "fast-path sets a flag; all async responders check the flag first."
