---
title: "feat: Local engine exact euro advice (no AI)"
type: feat
date: 2026-02-24
tags: [local-engine, overlay, monitor-mode, raise-sizing, no-ai]
brainstorm: docs/brainstorms/2026-02-24-local-poker-agent-brainstorm.md
---

# feat: Local Engine Exact Euro Advice (No AI)

## Overview

The local rule engine (`lib/poker/rule-tree.ts`) already computes concrete euro amounts
via `betSize(pot, fraction)` — e.g. "RAISE €0.14" on a wet flop. However two gaps prevent
these amounts from reaching the overlay:

1. **Preflop RAISE always shows `amount: null`** — the persona chart says "RAISE" but never
   attaches a euro amount, so the overlay shows "RAISE" instead of "RAISE €0.06".
2. **Low-confidence spots fall back to Claude** — when the rule engine scores < 0.60,
   `requestDecision()` calls `/api/autopilot`. In monitor mode this delays advice by ~2.5s
   and can fail (503). The user wants immediate local advice instead.

**Goal:** Monitor mode always shows instant, concrete advice (e.g. "RAISE €0.06",
"BET €0.14", "CALL €1.50") from the local engine alone, with no AI involvement.
Play mode is unchanged (still falls back to Claude for safety on low-confidence spots).

---

## Current State

| Path | What it does |
|------|-------------|
| `lib/poker/rule-tree.ts:55-57` | `betSize(pot, fraction)` — computes euro amount from pot fraction |
| `extension/src/poker-content.ts:717-779` | `localDecide()` — returns `LocalDecision { action, amount, confidence, reasoning }` |
| `extension/src/poker-content.ts:1241-1301` | Hero turn detection — preflop fast-path + post-flop local engine gate |
| `extension/src/poker-content.ts:900-982` | `executeAction()` — RAISE/BET diverts to CALL/CHECK (todo 030) |
| `extension/src/poker-content.ts:989-1018` | `safeExecuteAction()` — stores `monitorAdvice` in monitor mode |
| `extension/src/poker-content.ts:1113-1143` | Overlay: shows `monitorAdvice.amount` in euros already |

**What already works:** Post-flop local engine advice at confidence ≥ 0.60 appears in the
overlay as "RAISE €0.14" — the amount is already formatted. The gaps are preflop and
low-confidence spots.

---

## Proposed Solution

### Phase 1 — Preflop: attach euro amount to RAISE (30 min)

When the preflop persona says RAISE, compute the standard open-raise size:
- **Source of truth**: the "Raise To €X.XX" button already on-screen (`state.availableActions`)
- **Fallback**: 3x BB = €0.06 (hardcoded for Holland Casino €0.01/€0.02)

**Change in `poker-content.ts:processGameState()` preflop fast-path (line ~1288):**

```typescript
// Before — amount: null
safeExecuteAction(
  { action: personaAction, amount: null, reasoning: `Preflop chart: ${lastPersonaRec.name}` },
  "local",
);

// After — amount from DOM or default
const raiseBtn = state.availableActions.find(a => a.type === "RAISE" || a.type === "BET");
const preflopRaiseEur = raiseBtn?.amount
  ? parseFloat(raiseBtn.amount.replace(/[€$£,]/g, ""))
  : 0.06;
safeExecuteAction(
  { action: personaAction, amount: personaAction === "RAISE" ? preflopRaiseEur : null, reasoning: `Preflop chart: ${lastPersonaRec.name}` },
  "local",
);
```

### Phase 2 — Monitor mode: skip Claude, always show local advice (1h)

Separate the "confidence gate" by mode:
- **Play mode**: keep the 0.60 threshold — fall back to Claude for safety on hard spots.
- **Monitor mode**: always show local advice regardless of confidence.

**Change in `poker-content.ts:processGameState()` hero turn block (line ~1303):**

```typescript
// Before
if (autopilotMode !== "off" && state.communityCards.length >= 3) {
  const local = localDecide(state);
  if (local && local.confidence >= CONFIDENCE_THRESHOLD) {
    // ... execute/display
    return;
  }
  // fall through → requestDecision() → Claude
}

// After
if (autopilotMode !== "off" && state.communityCards.length >= 3) {
  const local = localDecide(state);
  if (local) {
    const meetsThreshold = local.confidence >= CONFIDENCE_THRESHOLD;
    // Monitor: always show. Play: only if confident.
    if (autopilotMode === "monitor" || meetsThreshold) {
      executing = true;
      const confidenceTag = meetsThreshold ? "" : ` (~${(local.confidence * 100).toFixed(0)}% conf)`;
      safeExecuteAction(
        { action: local.action, amount: local.amount, reasoning: local.reasoning + confidenceTag },
        "local",
      );
      lastHeroTurn = state.isHeroTurn;
      lastState = state;
      return;
    }
  }
  // Play mode + low confidence → Claude
}
```

Low-confidence monitor advice gets a `(~55% conf)` tag in the reasoning so the user knows
the engine is less certain.

### Phase 3 — Bet slider discovery and wiring (separate session)

Resolves **todo 030** — the one remaining blocker for play-mode RAISE/BET execution.

The Playtech bet slider DOM structure is unknown. Required steps:

1. **Discovery session**: With the live poker page open, use DevTools console to find the
   bet-sizing input:
   ```javascript
   // Run in poker tab console to find bet input candidates
   document.querySelectorAll('input[type="range"], input[type="number"], .bet-input, .betInput, [data-bet], .slider')
   document.querySelectorAll('.actions-area *').forEach(el => console.log(el.tagName, el.className, el.type))
   ```
2. **Once selector known**: implement `setBetAmount(amount: number)` in `poker-content.ts`:
   ```typescript
   function setBetAmount(amount: number): boolean {
     const input = document.querySelector<HTMLInputElement>('DISCOVERED_SELECTOR');
     if (!input) return false;
     // Simulate native input change (React/Vue DOM needs nativeInputValueSetter)
     const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
     nativeInputValueSetter?.call(input, String(amount));
     input.dispatchEvent(new Event('input', { bubbles: true }));
     input.dispatchEvent(new Event('change', { bubbles: true }));
     return true;
   }
   ```
3. **Wire into `executeAction()`**: Replace the current CALL/CHECK divert with:
   ```typescript
   if (decision.action === "RAISE" || decision.action === "BET") {
     if (decision.amount !== null && setBetAmount(decision.amount)) {
       // amount entered — find and click the raise/bet button
       button = findActionButton(decision.action);
     } else {
       // slider not found or amount null — safe fallback
       button = findActionButton("CALL") ?? findActionButton("CHECK") ?? findActionButton("FOLD");
     }
   }
   ```

Phase 3 is a prerequisite for play-mode RAISE/BET execution only. Monitor mode display
is unaffected (Phase 1 + 2 are sufficient).

---

## Acceptance Criteria

- [x] Preflop: overlay shows "RAISE €0.06" (or actual button amount) not just "RAISE"
- [x] Post-flop monitor mode: instant local advice appears without any `/api/autopilot` call
- [x] Low-confidence spots in monitor mode show advice tagged with `(~55% conf)` rather than waiting for Claude
- [x] Play mode behaviour unchanged — still falls back to Claude below confidence threshold
- [x] No regression in existing local-engine fast-path for confident post-flop spots

## Out of Scope

- Bet slider wiring (Phase 3) — requires live DOM discovery session
- Changing the confidence threshold value
- Preflop 3-bet sizing (facingRaise = true → Claude handles it, unchanged)

---

## Technical Considerations

- **`parseCurrency(raiseBtn.amount)`**: The raise button's `amount` field is already a string
  like `"€0.08"` from `scrapeAvailableActions()`. Use `parseCurrency()` from
  `lib/poker/equity/pot-odds.ts` to convert to number.
- **`amount: null` for FOLD/CHECK/CALL**: Keep null for non-bet actions — only attach
  amounts to RAISE/BET.
- **Confidence display**: Keep the `(~55% conf)` tag short — it's appended to `reasoning`
  which is already truncated to 80 chars in the overlay.
- **No new files needed**: Both phases touch only `poker-content.ts` and require a rebuild
  (`bun run build:extension`).

---

## Files Changed

| File | Change |
|------|--------|
| `extension/src/poker-content.ts` | Phase 1: preflop amount; Phase 2: monitor mode no-AI gate |
| `extension/dist/poker-content.js` | Rebuilt output (gitignored) |

---

## References

- Brainstorm: `docs/brainstorms/2026-02-24-local-poker-agent-brainstorm.md`
- Rule tree: `lib/poker/rule-tree.ts` — `betSize()` at line 55
- Local decide: `extension/src/poker-content.ts:717` — `localDecide()`
- Hero turn block: `extension/src/poker-content.ts:1241`
- Preflop fast-path: `extension/src/poker-content.ts:1278`
- Todo 030: `todos/030-resolved-p1-raise-bet-amount-not-entered.md`
