---
title: Local Poker Agent (Minimal AI)
date: 2026-02-24
status: draft
tags: [local-engine, rule-based, ai-fallback, performance]
---

# Local Poker Agent — Brainstorm

## What We're Building

A deterministic rule-based decision engine that handles ~90% of poker decisions
locally (sub-1ms, zero network) by applying poker logic directly in the extension.
Claude Haiku is called automatically only when the engine's confidence score drops
below a threshold (edge cases: ~10% of decisions).

**Current state**: Every autopilot decision calls Claude Haiku (~600ms round-trip).
**Target state**: 90% of decisions execute in <1ms locally. 10% fall back to Haiku.

---

## Why This Approach

The rule engine approach (over GTO solver tables or WASM) was chosen because:
- Preflop is already 100% solved: 4,056 persona chart entries exist in `lib/poker/personas.ts`.
  They just need wiring to execution (currently only used for overlay display).
- Post-flop standard spots are deterministic: SPR, pot odds, hand strength, draws → known correct play.
- YAGNI: ~90% local coverage solves the latency and cost problem. Solver-level accuracy is overkill for micro-stakes €0.01/€0.02.
- Iterative: rule coverage can expand independently of the AI fallback path.

---

## Key Decisions

### 1. Preflop: wire existing charts to execution
`requestPersona()` already returns `{ action: "RAISE"|"CALL"|"FOLD", ... }` from the chart.
This result is stored as `lastPersonaRec.action` but only shown in the overlay — it never
triggers `executeAction()`.

**Change**: When `lastPersonaRec` is set and we're still preflop, skip `requestDecision()`
and call `executeAction()` directly from the preflop chart. Confidence = 1.0 always.

This alone removes ~40% of API calls immediately.

### 2. Post-flop: board-texture-aware rule tree

Three pure functions feed a decision tree:

```
evaluateHand(heroCards, communityCards) → HandTier
  nut          — straight flush, quads, nut flush, full house
  strong       — flush, straight, set, two-pair
  top_pair_gk  — TPTK, overpair
  medium       — middle pair, top pair weak kicker
  weak         — bottom pair, underpair
  strong_draw  — 12+ outs (flush draw + pair, combo draw)
  draw         — 8-9 outs (flush draw, OESD)
  weak_draw    — 4 outs (gutshot)
  air          — nothing

analyzeBoard(communityCards) → BoardTexture flags
  monotone | two_tone | rainbow
  paired | double_paired
  connected (gap ≤ 2) | semi_connected
  high (A/K/Q on board) | low (≤7)

computeSPR(effectiveStack, pot) → number
  < 4   commit zone — stack off TPTK+
  4–10  medium depth — standard sizing
  > 10  deep — implied odds dominate
```

Decision tree (simplified):
```
SPR < 4 AND tier >= top_pair_gk   → jam/raise big        confidence 0.90
tier == nut                       → bet 75%, raise        confidence 0.90
tier == strong                    → bet 75%, call 1 raise confidence 0.85
tier == top_pair_gk + in position → bet 60%               confidence 0.75
tier == top_pair_gk + OOP         → check-call 1 bet      confidence 0.65
tier == medium + facing big bet   → fold                  confidence 0.70
tier == strong_draw               → semi-bluff in pos     confidence 0.75
tier == draw + pot odds positive  → call                  confidence 0.70
tier == draw + pot odds negative  → fold                  confidence 0.80
tier == air + river + missed draw → conditional bluff     confidence 0.45 → AI
```

### 3. Confidence threshold → auto-AI fallback

Engine returns `{ action, amount, confidence: 0..1 }`.
If `confidence < 0.60`, the engine calls `/api/autopilot` (Claude Haiku) automatically.
From the user's perspective it's seamless — faster for the 90%, same quality for the 10%.

Situations that reliably score < 0.60 (→ AI):
- Multi-way pots (3+ active players post-flop)
- Facing a 3-bet or check-raise (unusual aggression)
- Air on river — bluff vs give-up decision
- Wet board + unknown opponent stack (range uncertainty)
- Mismatched community cards (template fail: fallback to AI anyway)

### 4. Embedding vs. separate module

The engine will live as **inline functions in `poker-content.ts`** for Phase 1,
then refactored to `lib/poker/local-engine.ts` if the web app also benefits.

Rationale: zero network latency is the whole point. Running in the content script
means the decision happens in the same JavaScript execution context as DOM scraping.
No fetch, no route, no serialisation.

---

## Architecture

```
processGameState()
  └─ scrapeGameState()       [already exists]
  └─ localDecide(state)      [NEW]
       ├─ if preflop:
       │    return lastPersonaRec.action (confidence 1.0)
       ├─ evaluateHand()     [NEW — lib/poker/hand-evaluator.ts]
       ├─ analyzeBoard()     [NEW — lib/poker/board-analyzer.ts]
       ├─ computeSPR()       [NEW — inline calculation]
       ├─ computePotOdds()   [NEW — inline calculation]
       └─ applyRuleTree()    [NEW — ~100 rules with confidence scores]
            ├─ confidence >= 0.60 → executeAction() immediately
            └─ confidence <  0.60 → requestDecision() → Claude Haiku fallback
```

---

## Implementation Phases

### Phase 1: Preflop wiring (1 day, ~40% reduction in API calls)
- In `processGameState()`, check: `lastPersonaRec && communityCards.length === 0`
- If true: call `executeAction()` with `lastPersonaRec.action` directly
- No new code needed — just connect two existing systems

### Phase 2: Hand evaluator + board analyzer (2–3 days)
- `lib/poker/hand-evaluator.ts`: 7-card hand strength → HandTier
  - Standard 7-card evaluator. Only needs to classify tier, not exact rank.
  - ~120 lines
- `lib/poker/board-analyzer.ts`: community cards → BoardTexture flags
  - ~60 lines
- Unit tests for all hand categories and board types

### Phase 3: Decision tree + confidence scores (3 days)
- `localDecide(state)` function in `poker-content.ts`
- Integrates all above, applies rule tree, returns `{ action, amount, confidence }`
- If `confidence >= 0.60`: direct `executeAction()`, log "[Local] RAISE €0.12 (0.82)"
- If `confidence < 0.60`: fall through to `requestDecision()` → Haiku

### Phase 4: Tuning (ongoing)
- Review console logs — adjust confidence thresholds based on real hands
- Expand rule coverage as edge cases are identified
- Aim: identify top-5 confidence < 0.60 patterns and bring them above threshold

---

## Open Questions

1. **Raise sizing**: Local engine will approximate (50%/75% pot). Exact euro amounts
   depend on pot size; parser already handles this from DOM. Need to verify
   `executeAction()` can handle fractional euro amounts.

2. **Bet-input wiring (todo 030)**: RAISE/BET require entering a custom amount in the
   bet input slider. This is unresolved. Until it's wired, local raises/bets will fall back
   to the call/check buttons (same as current Claude path). Phase 1 (preflop RAISE from chart)
   is also blocked by this — it's the same blocker Claude faces.

3. **Multi-way pots**: SPR and pot-odds calculations work for heads-up. With 3+ players,
   range interactions are more complex. Safe default: confidence penalty -0.20 per additional
   active player beyond 2.

4. **Position detection reliability**: `getPosition()` returns `"??"` when dealer seat
   undetected. Local engine should treat `??` as OOP (conservative default).

5. **Bluffing frequency**: A pure rule engine won't balance bluff/value frequencies.
   For micro-stakes this is acceptable (opponents don't adjust). May revisit if moving up.

---

## References

- Existing preflop charts: `lib/poker/personas.ts` (4,056 entries, do not edit)
- Persona selection: `lib/poker/persona-selector.ts` + `lib/poker/persona-lookup.ts`
- Hand tracking: `extension/src/poker-content.ts:processGameState()`
- Autopilot execution: `extension/src/poker-content.ts:executeAction()`
- Current AI path: `app/api/autopilot/route.ts` (Haiku, stays as fallback)
- Todo 030: bet-input slider wiring (RAISE/BET blocked until resolved)
