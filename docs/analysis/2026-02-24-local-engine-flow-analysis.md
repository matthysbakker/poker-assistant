---
title: "Flow Analysis: Local Rule-Based Poker Decision Engine"
date: 2026-02-24
type: analysis
status: draft
---

# Flow Analysis: Local Rule-Based Poker Decision Engine

**Date:** 2026-02-24
**Scope:** Feature spec from brainstorm `docs/brainstorms/2026-02-24-local-poker-agent-brainstorm.md`
**Key files examined:**
- `extension/src/poker-content.ts` — full DOM scraping + decision loop
- `lib/poker/personas.ts` — 4,056 chart entries
- `lib/poker/persona-lookup.ts` + `persona-selector.ts` — chart lookup
- `lib/poker/hand-notation.ts` — card-to-notation conversion
- `lib/hand-tracking/state-machine.ts` — street state machine
- `lib/ai/autopilot-schema.ts` + `autopilot-prompt.ts` — existing Claude path

---

## User Flow Overview

### Flow 1 — Preflop (Happy Path)

```
New hand detected (handId changes)
  → lastPersonaRec = null, executing = false
  → requestPersona() fired (async, ~100-400ms HTTP to localhost:3006)
  → [MEANWHILE] hero turn fires (rising edge on isHeroTurn)
     → [NEW] check: communityCards.length === 0 && lastPersonaRec !== null
        → YES: executeAction(lastPersonaRec.action) directly [confidence 1.0]
        → NO (persona not yet back): ??? [GAP — see Q1]
```

### Flow 2 — Preflop (Persona Async Race)

```
New hand detected
  → requestPersona() fired (network call in flight)
  → [200ms later] hero turn fires
  → lastPersonaRec is STILL null (HTTP hasn't returned)
  → [NEW] preflop path requires lastPersonaRec — not available
  → ??? fallback path undefined in spec
```

### Flow 3 — Post-Flop (High-Confidence Local)

```
Street transition detected (community cards 0→3, 3→4, 4→5)
  → hero turn detected (isHeroTurn rising edge)
  → localDecide(state) called
     → evaluateHand(heroCards, communityCards) → HandTier
     → analyzeBoard(communityCards) → BoardTexture
     → computeSPR(effectiveStack, pot) → number
     → computePotOdds() → number
     → applyRuleTree() → { action, amount, confidence }
     → confidence >= 0.60
        → executeAction() directly
```

### Flow 4 — Post-Flop (AI Fallback)

```
  → applyRuleTree() → confidence < 0.60
  → requestDecision(handMessages) → Claude Haiku via /api/autopilot
  → onDecisionReceived() → executeAction()
  [Same path as today]
```

### Flow 5 — Multi-Way Pot

```
  → applyRuleTree() runs
  → activePlayers > 2 detected
  → confidence -= 0.20 per extra player
  → [2 extras = -0.40] most hands now < 0.60 → falls through to Claude
```

### Flow 6 — RAISE/BET Action Selected (Local or AI)

```
  → executeAction({ action: "RAISE", amount: X })
  → current code in poker-content.ts lines 783-787:
     falls back to CALL/CHECK regardless of confidence or source
  → [ISSUE] bet-input slider not implemented (todo 030)
  → hero calls/checks instead of raising
```

---

## Flow Permutations Matrix

| Scenario | Community Cards | lastPersonaRec | confidence | Correct Path | Spec Covers? |
|---|---|---|---|---|---|
| Preflop, persona ready | 0 | set | 1.0 | Chart → executeAction | YES |
| Preflop, persona pending | 0 | null | — | ??? | NO — GAP |
| Preflop, BB facing raise | 0 | set (CALL/FOLD/RAISE) | 1.0 | Chart → executeAction | Partially — BB charts exist |
| Preflop, facing 3-bet | 0 | set (chart says RAISE) | 1.0 | Chart → executeAction | NO — chart is RFI-only |
| Preflop, all-in shove vs hero | 0 | set (chart says FOLD) | 1.0 | Chart action but amount context missing | NO — GAP |
| Flop, heads-up, high conf | 3 | irrelevant | ≥ 0.60 | Local execute | YES |
| Flop, 3-way, high base conf | 3 | irrelevant | ≥ 0.60 then -0.20 | Falls to AI | YES |
| Flop, facing check-raise | 3 | irrelevant | < 0.60 | Falls to AI | Noted but not defined |
| Turn, stack-to-pot mismatch | 4 | irrelevant | varies | Rule tree | YES |
| River, bluff spot | 5 | irrelevant | 0.45 | AI | YES |
| Position = "??" | any | irrelevant | OOP default | Conservative | YES |
| Pot parse fails | any | irrelevant | — | ??? | NO — GAP |
| Stack parse fails | any | irrelevant | — | computeSPR = ??? | NO — GAP |
| Hero cards missing | any | irrelevant | — | ??? | NO — GAP |
| Community cards partially detected | 3 (but 2 read) | irrelevant | — | Wrong tier, wrong SPR | NO — GAP |
| BTN/SB 2-player (heads-up) | 0 | set | 1.0 | Chart action, but position is "BTN/SB" | NO — GAP |
| RAISE action decided (any source) | any | irrelevant | any | Falls to CALL/CHECK | Acknowledged (todo 030) |
| localServer down at hand start | 0 | null | — | ??? | NO — GAP |
| watchdog fires during local execution | any | irrelevant | any | FOLD emitted | NO — DANGER |

---

## Missing Elements and Gaps

### Category: Preflop — Persona Async Race

**Gap:** The brainstorm says "wait for requestPersona() to resolve" but the current `processGameState()` fires hero turn detection independently. There is no await, no blocking, and no callback from requestPersona into the hero-turn handler. If hero turn fires before the HTTP response returns, `lastPersonaRec` is null and no preflop path is defined.

**Current code (poker-content.ts lines 1108-1118):** A second call to `requestPersona()` is made at hero-turn time as a guard, but it is still async. The spec does not define what the engine does if the response arrives AFTER the action timer has started.

**Impact:** On fast blinds (e.g., BB, SB first hand), the action timer can be 10-15s and requestPersona takes 100-400ms — usually fine. But on a slow network or if the local server is cold-starting, the timer can expire while the fetch is in flight. The watchdog then fires a FOLD at confidence 0.0, which is far worse than what the chart would recommend.

**Impact level:** Critical. Wrong action on real money.

---

### Category: Preflop — Chart Position Coverage

**Gap:** The charts in `lib/poker/personas.ts` are RFI (raise-first-in) charts. They encode the action for when no one has entered the pot before hero. The spec treats `lastPersonaRec.action` as the definitive preflop action, but that action is only correct for the RFI scenario.

Concrete situations the chart does NOT cover:
- Hero is BB and faces a raise from BTN — the chart says "CALL" for 22, but that's the BB default-call action, not a response to a specific raise size.
- Hero faces a 3-bet (someone re-raised hero's open) — the chart says "RAISE" for AA, which means open-raise, not 4-bet.
- Hero is in the BB and someone already limped — chart says FOLD for weak hands, but BB may check for free.
- Short-stack shove scenario — the chart says RAISE for AKs from UTG, but if the effective stack is 5 BB, that "RAISE" should be an all-in call not a standard open.

**Impact:** Catastrophic in 3-bet pots. The engine would execute the RFI action (e.g., RAISE) when facing a 3-bet, which in practice means clicking the raise button (which currently falls back to CALL due to todo 030, masking the error — but once todo 030 is resolved, it would 4-bet to a small size that is not a real 4-bet).

**Impact level:** Critical. Wrong action in 3-bet scenarios, which occur on 15-20% of hands.

---

### Category: Preflop — BTN/SB Composite Position

**Gap:** In 2-player pots (heads-up), `getPosition()` returns `"BTN/SB"`. The `ChartPosition` type in `personas.ts` is `"UTG" | "MP" | "CO" | "BTN" | "SB" | "BB"`. There is no `"BTN/SB"` chart entry.

Looking at `persona-lookup.ts` line 25: `persona.charts[position]?.[handKey] ?? "FOLD"` — if position is `"BTN/SB"`, the chart lookup returns `undefined`, and the fallback is `"FOLD"`.

The existing code at `poker-content.ts` line 1068 already guards this: `const position = rawPosition === "??" ? "CO" : rawPosition`. But `"BTN/SB"` is not `"??"`, so it is passed through to `requestPersona()`, which then calls the API. The API presumably handles this, but the local engine calling `persona.charts["BTN/SB"]` would silently FOLD on every hand from that position.

**Impact:** If the local engine uses `lastPersonaRec.action` directly (which comes from the API, not from a raw chart lookup), this gap is hidden. But if it ever calls the chart lookup functions directly in the engine, heads-up play produces all-FOLD.

**Impact level:** Important. Heads-up tables are a valid use case.

---

### Category: Post-Flop — Pot and Stack Parsing

**Gap:** The spec acknowledges "pot string is '€1.50' format, needs parse to float" and "stack string is '€38.50' format". No parsing function exists yet in the codebase. The spec does not define:
- What happens if pot is empty string (hand just started, no bets in)
- What happens if pot is "€0.00" (all-in pre)
- What happens if stack string is missing (player is all-in, stack shows 0 or blank)
- What currency format variants exist: does the Playtech UI ever show "1,50" (comma decimal) for Dutch locale?

`scrapePot()` in `poker-content.ts` line 302 returns the raw string `""` if the element is missing.

**Impact:** If `computeSPR()` receives NaN for pot or stack, the comparison `SPR < 4` evaluates to `false` (NaN comparisons always fail), and the engine silently falls through to a wrong rule branch. With SPR = NaN and tier = top_pair_gk, the engine may check instead of jamming a committed stack.

**Impact level:** Critical. Wrong action in committed-stack situations.

---

### Category: Post-Flop — Hero Cards Missing at Street Transition

**Gap:** The spec uses `evaluateHand(heroCards, communityCards)`. The `scrapeHeroCards()` function returns `[]` when the `.cards-holder-hero` element is not found or when both SVG and text fallbacks fail. This can happen during DOM transitions (dealing animation), or if the user minimizes/restores the poker window.

If `heroCards.length === 0` at the moment the engine runs, `evaluateHand([], communityCards)` will produce an incorrect tier (air at minimum, or an exception if the evaluator assumes exactly 2 hero cards).

The spec defines community card count as the street discriminator, but does not define a guard for when hero cards are missing post-flop.

**Impact:** Engine evaluates the wrong hand tier and may commit chips or fold a strong hand.

**Impact level:** Critical.

---

### Category: Post-Flop — Partial Community Card Detection

**Gap:** The card detection pipeline (screenshot-based, separate from DOM scraping) can return 2 cards for what is actually a 3-card flop due to animation frames or occlusion. However, the local engine in `poker-content.ts` uses DOM scraping (`scrapeCommunityCards()`), not screenshot detection. The DOM scraper filters `.pt-visibility-hidden` elements, so partially-animated cards may not yet be visible.

Result: engine could run at the moment of the DOM mutation with only 2 community cards visible, compute the wrong tier, and execute before the 3rd card appears.

**Impact:** Incorrect hand evaluation on the flop, particularly for flush-draw and straight-draw detection which require all 3 cards.

**Impact level:** Important.

---

### Category: Post-Flop — effectiveStack Definition

**Gap:** `computeSPR(effectiveStack, pot)` is mentioned in the spec but "effectiveStack" is not defined. In poker, effective stack is `min(hero_stack, opponent_stack)`. The spec does not specify:
- Which opponent's stack to use in multi-way pots (minimum? maximum? main villain?)
- What to do when hero stack is 0 (all-in)
- Whether to use the stack before or after the current round's bets (some platforms show stack net of current bet)

The Playtech DOM exposes `stack` per player from `scrapePlayer()`, which reads `.text-block.amount`. It is unclear whether this value is the net stack (excluding current round's bet) or the total.

**Impact:** SPR calculation could be off by the size of the current bet, which changes the commit-zone decision (SPR 4 threshold) especially in 3-bet pots where the effective stack may already include the 3-bet amount.

**Impact level:** Important.

---

### Category: Decision Tree — What Does "Facing" Mean

**Gap:** Several rule-tree nodes depend on what hero is "facing" (e.g., `tier == top_pair_gk + facing big bet`). The available actions scraped from the DOM are `["FOLD €X", "CALL €Y", "RAISE €Z"]` — the presence of a non-zero call amount implies hero is facing a bet. But the engine spec does not define:
- How to determine if the current bet is "big" vs "small" relative to pot (needs pot odds calculation from call amount / pot size)
- The difference between facing a c-bet vs facing a donk-bet vs facing a check-raise (requires knowing who acted last, which is not scraped)
- Whether "facing a check" counts as a bet scenario (it does not, but the DOM would show only CHECK/BET/FOLD)

Without this context, the rule node `tier == medium + facing big bet → fold (conf 0.70)` cannot be evaluated correctly.

**Impact:** Engine may fold medium-strength hands facing a tiny 10% pot bet (confident fold of a playable hand) or call/raise when facing a pot-sized donk-bet.

**Impact level:** Critical.

---

### Category: Watchdog and Local Engine Interaction

**Gap:** The existing watchdog (`decisionWatchdog`, poker-content.ts lines 687-694) fires `FOLD` if `AUTOPILOT_ACTION` never arrives within the timer window. This watchdog is set inside `requestDecision()`, which is the Claude path.

If the local engine executes synchronously (sub-1ms), the watchdog is never set at all, so there is no safety net if `executeAction()` throws or hangs during local execution. Conversely, if the local engine decides to fall through to Claude, the watchdog IS set inside `requestDecision()` — but it is set with `executing = true` already locked. The watchdog clears `executing = false` on timeout, which is correct. However, if the local engine itself sets `executing = true` at the start and then calls `requestDecision()`, the guard check at line 669 (`if (executing) return`) would block the second call.

The spec does not define the interaction between the local engine's execution guard and the existing Claude path's guard.

**Impact:** Could result in a permanent `executing = true` lock (todo 031 was the original version of this problem) where the engine fires once, falls through to Claude, Claude's callback arrives, but the flow is blocked.

**Impact level:** Critical. Replicates the P1 bug from todo 031 in a new code path.

---

### Category: Monitor Mode vs. Play Mode

**Gap:** The current architecture has two modes: monitor (show recommendation, don't execute) and play (execute). The spec makes no mention of how monitor mode interacts with the local engine. Specifically:
- In monitor mode, should local decisions be displayed in the overlay the same way Claude decisions are displayed?
- Should the overlay show "Local: CALL (conf 0.82)" vs "AI: CALL" so the user can distinguish source?
- In monitor mode, if the local engine would have acted but Claude is not called, is there any overlay update?

Currently the overlay shows `lastClaudeAdvice` or `monitorAdvice`. A local decision stored in neither variable would be invisible in the overlay.

**Impact:** Monitor mode becomes useless for validating the local engine's decisions before enabling play mode.

**Impact level:** Important.

---

### Category: Preflop Raise Amount

**Gap:** When `lastPersonaRec.action === "RAISE"` and the engine calls `executeAction()` directly, it calls it with what `AutopilotAction`? The interface requires `{ action, amount, reasoning }`. The persona chart only returns `"RAISE"` — it has no amount. The spec says "for preflop RAISE from chart — Phase 1 is also blocked by this [todo 030]."

But the actual execution path calls `executeAction()` with `amount: null` (or undefined) for a RAISE. When todo 030 IS resolved and bet-input is wired, `amount: null` for a RAISE would enter an unspecified amount in the bet input. The spec needs to define the preflop raise sizing formula (e.g., 2.5x BB = €0.05 at €0.01/€0.02).

**Impact:** Once bet-input is wired, RAISE with null amount would either error, use a default size (possibly wrong), or do nothing.

**Impact level:** Important (currently masked by todo 030, will become critical when todo 030 is resolved).

---

### Category: State Reset Between Hands

**Gap:** `lastPersonaRec` is reset to null on new hand detection (line 1054 in poker-content.ts). The spec says "if `lastPersonaRec` is set and we're still preflop, skip requestDecision()". But there is a window between the new hand detection and the `requestPersona()` fetch completing where `lastPersonaRec` is null AND community cards are 0. If the engine checks `lastPersonaRec !== null` as the guard for the preflop local path, it will fall through to Claude for every hand until the fetch completes.

This is the same race described in Gap 1 but from a different angle: the preflop local path needs a concrete definition of the fallback behavior during the fetch window.

**Impact:** The "40% reduction in API calls" claim from the brainstorm overstates the benefit if the local path is gated on the persona fetch (which itself is a network call). A hand where hero is in the BB and gets action immediately will always fall through to Claude.

**Impact level:** Important.

---

### Category: Hand Notation — 10 vs T Consistency

**Gap:** `hand-notation.ts` normalizes "10" → "T" for chart lookups. The chart keys use `"T"` (e.g., `"TT"`, `"T9s"`). The DOM scraper (`parseCardFromText()`) returns the rank as-is from `textContent`, which could be "10" or "T" depending on the Playtech UI version.

`parseCardFromSvg()` at line 183 in `poker-content.ts` matches `/([cdhs])([a2-9]|10|[jqka])\.svg$/i` and returns `rankStr.toUpperCase() + suitChar`, so "10" becomes "10h" not "Th".

`toHandNotation()` in `hand-notation.ts` handles this via `normalizeRank()` — it correctly converts "10" → "T" before chart lookup. So the existing flow is correct.

However, the new `evaluateHand(heroCards, communityCards)` function will receive cards like `"10h"`. The evaluator needs to handle this format, as rank comparisons using `RANK_ORDER = "AKQJT98765432"` would fail to find "10" (it finds "T"). This is not a gap in the existing code but is a gap in the spec for the new evaluator.

**Impact:** Hand evaluator silently fails on tens, misclassifying all hands containing tens (e.g., TT is pair but evaluator might call it air).

**Impact level:** Critical for the new evaluator.

---

### Category: SPR When Hero is All-In

**Gap:** If hero is all-in (stack = 0 or blank), `computeSPR()` returns 0. SPR = 0 triggers "SPR < 4 → jam/raise big" which is a paradox (already all-in, cannot bet more). The rule tree has no explicit guard for this state.

**Impact:** Engine attempts to execute a RAISE action when hero has no chips left, button click fails, `executing` remains false, and the hand proceeds with no action (depends on whether the platform auto-checks all-in players or times them out).

**Impact level:** Important.

---

### Category: Confidence Threshold Calibration

**Gap:** The confidence values in the spec (0.90, 0.85, 0.75, etc.) are asserted but not derived from any historical data. The brainstorm acknowledges "Phase 4: tuning — adjust confidence thresholds based on real hands." However, the spec makes no mention of:
- What happens if all post-flop rules score below 0.60 (all fall through to Claude — defeating the point)
- Whether the 0.60 threshold itself is configurable without a code deploy
- Whether confidence scores from multiple matching rules are combined or if the first match wins

If the rule tree is evaluated top-to-bottom with first-match semantics, rule ordering is critical. The brainstorm shows 9 rule nodes but does not specify ordering.

**Impact:** Ambiguous ordering could produce wildly different results for the same hand. Example: a nut flush on a paired board matches both "tier == nut → bet 75%" and "paired board" — which takes precedence?

**Impact level:** Important.

---

### Category: Security — Local Engine as Source of FOLD

**Gap:** The existing `onDecisionReceived()` has a safety override (line 849-852): it prevents FOLD when CHECK is available. This safety is applied to Claude responses. The spec does not specify whether this safety also applies to local engine decisions.

If the local engine decides FOLD and calls `executeAction()` directly (bypassing `onDecisionReceived()`), the safety is skipped. A bug in the rule tree (e.g., incorrect tier evaluation returning `air` for a top pair due to a card parsing issue) would directly fold the hand without the safety net.

**Impact:** Loss of real money. The CHECK-override safety must also apply to local decisions.

**Impact level:** Critical.

---

## Critical Questions Requiring Clarification

### Critical (blocks implementation or creates real-money risk)

**Q1. What is the fallback when hero turn fires before requestPersona() responds?**

The persona fetch is async (HTTP to localhost:3006, typically 100-400ms). The hero turn can fire within that window, especially on the first hand or after a cold server start. Three options exist:
- Option A: Block execution entirely until the fetch completes (requires converting the hero-turn handler to await the persona promise).
- Option B: Fall through to Claude immediately if persona is null.
- Option C: Use a default persona (e.g., GTO Grinder) if null, then correct on next hand.

If Option A, define the maximum wait time before timeout and what happens if the fetch never resolves.

Why this matters: choosing Option C means the engine could RAISE with a hand the active persona would FOLD, or FOLD a hand the active persona would CALL, on the first hand.

Assumed default if unanswered: Option B (fall through to Claude when lastPersonaRec is null).

---

**Q2. What preflop actions count as "chart-executable" vs. must fall through to AI?**

The charts are RFI (raise-first-in) tables. They are definitionally correct only when no one has entered the pot before hero. The spec says "execute chart action directly (RAISE/CALL/FOLD)" but does not define what happens when:
- Someone has already opened (hero is facing a raise) — the chart RAISE now means 3-bet, not open
- Someone has 3-bet hero's open — the chart action is meaningless for this decision
- Hero is in the BB facing a limp — the chart FOLD may mean "raise the limper" not actually fold

Proposed definition needed: The spec must define a set of "pot conditions" where the chart is authoritative, and all other preflop conditions fall through to Claude.

Assumption if unanswered: Chart is authoritative only when `availableActions` contains no CALL with a non-zero amount AND it is the first facing action of the hand for hero. In all other preflop situations, fall through to Claude.

---

**Q3. Does the FOLD-safety override apply to local engine decisions?**

Currently `onDecisionReceived()` overrides FOLD → CHECK when CHECK is available. If the local engine calls `executeAction()` directly (bypassing `onDecisionReceived()`), this safety does not apply. The spec does not address this.

Proposed: all locally-decided actions must pass through the same safety check before execution. This means routing through a shared `safeExecuteAction()` wrapper that applies: (a) FOLD→CHECK override, (b) monitor-mode intercept, (c) pre-action checkbox clearing.

---

**Q4. How does "facing a bet" get determined from available DOM state?**

The rule tree depends on knowing whether hero is facing a bet, and whether it is large relative to pot. The available DOM data is:
- `availableActions: ActionOption[]` — each has `type` and `amount`
- `pot: string` — current pot

The presence of `CALL` with a non-zero amount means hero faces a bet. The size relative to pot determines if it is "big". But the spec does not define: what is the threshold for a "big bet"? Is it > 50% pot? > 75% pot?

Without this definition, the rule `tier == medium + facing big bet → fold (conf 0.70)` cannot be implemented.

---

**Q5. What is the exact input/output contract of evaluateHand()?**

The spec lists HandTiers but does not define:
- Card format: does the evaluator receive `["Ah", "Kd"]` or `["AH", "KD"]` or `["10h", "Ts"]`? (The DOM scraper produces "10h" for tens, not "Th".)
- What happens with fewer than 2 hero cards (parsing failure)?
- What happens with fewer than 3 community cards (should not occur post-flop, but DOM animations)?
- How are "nut" hands defined — is the nut flush only the A-high flush, or any flush?
- Is "overpair" in `top_pair_gk` tier, or does it have its own tier?

---

**Q6. What is effectiveStack for SPR calculation?**

Define:
- In heads-up: `min(hero.stack, opponent.stack)`
- In 3-way pots: `min(hero.stack, max(opponent1.stack, opponent2.stack))` or just `min(all stacks)`?
- Does the stack value from the DOM include or exclude the current street's bets?
- What is SPR when hero or opponent is all-in (stack = 0)?

---

### Important (significantly affects UX or correctness)

**Q7. What does the overlay show for local decisions in monitor mode?**

Currently the overlay shows `lastClaudeAdvice` or `monitorAdvice`. A local decision populates neither. In monitor mode, users cannot validate local decisions before enabling play mode. Should local decisions show as "Local: RAISE €0.05 (conf 1.0)" vs "AI: RAISE"?

---

**Q8. What is the preflop raise amount for chart-executed RAISEs?**

When `lastPersonaRec.action === "RAISE"` and the engine executes directly, what amount is passed? The chart has no amount field. The autopilot prompt uses 2.5-3x BB (€0.05-€0.06 at €0.01/€0.02). Once todo 030 is resolved, amount cannot be null for a RAISE.

---

**Q9. Is the confidence threshold (0.60) a constant or configurable?**

If it is a hardcoded constant, tuning Phase 4 requires a code deploy + extension reinstall. If it is a popup-adjustable value stored in extension storage, tuning can be done at runtime. Given the "Phase 4: tuning" intent in the brainstorm, a configurable threshold is likely more practical.

---

**Q10. What is the rule evaluation order, and is it first-match or best-confidence?**

The brainstorm lists 9 rule nodes. If a hand matches multiple nodes (e.g., nut hand on a paired board facing a check-raise), which node fires? If first-match, the order matters enormously and must be specified. If best-confidence, multiple rules must all be evaluated and the highest-confidence result is used.

---

**Q11. What is the engine's behavior when the local Next.js server (localhost:3006) is not running?**

`requestPersona()` already handles this with a silent catch. But the local engine spec does not address whether it has any dependency on the Next.js server at all (it should not, if it is entirely inline in the content script). This needs clarification to confirm the engine has no localhost dependency.

---

**Q12. How does the local engine coexist with the `executing` flag?**

The `executing` flag in `poker-content.ts` is set true at the start of `requestDecision()` and cleared in `executeAction()` and in the watchdog. If the local engine sets `executing = true` at the start of `localDecide()` and the rule tree takes longer than expected (e.g., hand evaluator is slow), will the watchdog still fire? The watchdog is only set inside `requestDecision()`, not in the local path. Define: does the local path need its own watchdog?

---

### Nice-to-Have (reasonable defaults exist)

**Q13. Should the local engine log decisions at a different verbosity level than Claude decisions?**

The spec mentions "log '[Local] RAISE €0.12 (0.82)'". Should local decisions use a distinct console prefix, color, or log level that makes them filterable in the browser console separately from Claude decisions and DOM debug logs?

---

**Q14. Should failed local decisions (where the engine falls through to Claude) be tracked separately?**

For Phase 4 tuning, knowing which hands caused fallthrough and why (which rule branch was closest to threshold) would be valuable. Should the engine emit a structured debug log like `{ action: "AI_FALLBACK", reason: "air_on_river", confidence: 0.45, hand: "...", board: "..." }` to a dedicated console group or extension storage?

---

**Q15. When the engine falls through to Claude, is the Claude prompt enriched with the local engine's analysis?**

The local engine computes `HandTier`, `BoardTexture`, and `SPR` before deciding to fall through. Could those computed values be prepended to the Claude prompt to improve Haiku's response quality? The existing `AUTOPILOT_SYSTEM_PROMPT` asks Claude to compute these itself from the screenshot. If the local engine already has them, passing them as context would reduce Claude's work and improve accuracy.

---

## Recommended Next Steps

1. **Answer Q1 and Q2 before writing any code.** These define the fundamental contract of the preflop path. An incorrect assumption here results in wrong actions on a real-money table.

2. **Define a `safeExecuteAction()` wrapper (addresses Q3).** All local and Claude decisions must pass through the same FOLD-safety and monitor-mode intercept before reaching the DOM click. This is a one-line refactor of the existing execution path.

3. **Specify the card format contract for evaluateHand() (Q5).** Given the DOM scraper produces "10h" for tens and the chart lookup uses "T", the evaluator must explicitly handle "10" rank codes or a normalizer must be applied at the boundary.

4. **Define effectiveStack (Q6) before implementing computeSPR().** An incorrect SPR produces wrong commit-zone decisions in every post-flop hand.

5. **Add parsing guards for pot/stack before computeSPR() runs.** If either parses to NaN or 0, the engine must route to Claude, not silently evaluate the wrong rule branch.

6. **Define "facing a bet" threshold (Q4) before implementing the rule tree.** This definition affects approximately 40% of all post-flop rule branches.

7. **Preflop RAISE amount formula (Q8).** Even if masked by todo 030 today, this must be specified before todo 030 is resolved to avoid shipping a RAISE with amount null.
