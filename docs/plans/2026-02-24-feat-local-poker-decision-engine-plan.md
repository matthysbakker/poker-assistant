---
title: "feat: Local rule-based poker decision engine with AI fallback"
type: feat
date: 2026-02-24
deepened: 2026-02-24
---

# feat: Local Poker Decision Engine with AI Fallback

## Enhancement Summary

**Deepened on:** 2026-02-24
**Research agents:** codebase-exploration, performance-oracle, architecture-strategist, hand-evaluator-research, draw-equity-research, gto-theory-research, opponent-modelling-research

### Key Improvements Added

1. **Equity module** (`lib/poker/equity/`) — exact out-counting, pot-odds, implied odds, dirty-outs, hand-strength mismatch detection; replaces approximate "facing bet fraction" logic
2. **GTO-informed bet sizing** — "Wetness Parabola" from GTO Wizard solver studies: dry=33%, semi-wet=50%, wet=66%, monotone=33%; c-bet frequencies by position (IP 45–82%, OOP 22–42%)
3. **Accurate SPR thresholds** — solver-derived commitment zones: <3 = any TPTK, 3–6 = two-pair+, 6–10 = set+, >10 = straight/flush only
4. **Hand evaluator reference implementation** — rank-counting tier classifier (~130 lines, <0.005ms); native set/trips distinction, nut-flush detection, draw detection; no lookup tables needed
5. **Rule tree as testable module** (`lib/poker/rule-tree.ts`) — extracted from `poker-content.ts` so it can be unit-tested independently
6. **Performance optimizations** — pre-allocated `Uint8Array` counters, result caching per board, bitmask `hasStraight()`, parse-once currency pattern
7. **Opponent-type adjustments** — per-opponent exploit deltas applied after rule tree, drawn from existing `session.opponents[seat].inferredType`
8. **7 architecture fixes** — try/catch safety net, BTN/SB normalisation, `communityCards.length >= 3` guard, confidence in `chrome.storage.local`, TPTK kicker boundary, full-house detection edge case, Phase 0 sequencing enforcement

### New Considerations Discovered

- `heroStack` is in `state.players.find(p => p.seat === heroSeat)?.stack` — NOT a top-level GameState field (codebase exploration)
- Monotone boards want *smaller* sizing (33%), not larger — counter-intuitive but solver-confirmed
- OESD on paired board = dirty outs (straight could lose to full house, -2 outs discount)
- Combo draws (13+ outs) are often >50% equity vs top pair — should BET/RAISE, not call
- `BTN/SB` position string in 2-player mode must be normalised to `BTN` before chart lookup

## Overview

Replace the current "call Claude Haiku for every decision" autopilot path with a deterministic rule-based engine that runs entirely in the extension content script (<1ms). Claude Haiku is kept as an automatic fallback for situations where the engine's confidence score falls below 0.60 (~10% of decisions).

**Current**: Every autopilot decision → Claude Haiku API (~600ms round-trip, network required)
**Target**: 90% of decisions → local rule engine (<1ms, no network), 10% → Claude Haiku fallback

## Problem Statement

The autopilot path currently calls Claude Haiku for every single decision — preflop opens, c-bets, calls, folds. This introduces 400–800ms latency on every action and requires the Next.js dev server to be running. Most poker decisions, especially preflop, are fully deterministic given hand + position + persona. The preflop chart system (`lib/poker/personas.ts`) already encodes 4,056 correct decisions but is only used for the overlay display, not for execution.

## Proposed Solution

Four components built incrementally:

1. **Phase 1**: Wire existing preflop persona charts directly to `executeAction()`. Eliminates ~40% of API calls with zero new logic.
2. **Phase 2**: `lib/poker/hand-evaluator.ts` — 7-card hand → `HandTier` (9 tiers from `nut` to `air`).
3. **Phase 3**: `lib/poker/board-analyzer.ts` — community cards → `BoardTexture` flags (monotone, paired, connected, etc.).
4. **Phase 4**: `localDecide()` in `poker-content.ts` — rule tree using HandTier + BoardTexture + SPR + pot odds → `{ action, amount, confidence }`. If confidence ≥ 0.60 execute locally; else fall through to existing `requestDecision()` → Claude Haiku.

## Technical Approach

### Architecture

```
processGameState() [existing]
  └─ isHeroTurn rising edge detected
       └─ localDecide(state)              [NEW — poker-content.ts]
            │
            ├─ communityCards.length === 0 (PREFLOP)
            │    └─ lastPersonaRec.action + confidence 1.0
            │         ├─ RAISE/FOLD/CALL → executeAction() [directly]
            │         └─ persona not yet loaded → requestDecision() fallback
            │
            └─ communityCards.length > 0 (POST-FLOP)
                 ├─ evaluateHand(heroCards, communityCards) → HandTier
                 ├─ analyzeBoard(communityCards) → BoardTexture
                 ├─ computeSPR(stack, pot) → number
                 ├─ computePotOdds(callAmount, pot) → number | null
                 └─ applyRuleTree(tier, texture, spr, potOdds, position, street, activePlayers)
                      → { action, amount, confidence }
                           ├─ confidence ≥ 0.60 → executeAction()  [local path]
                           └─ confidence <  0.60 → requestDecision() [Claude Haiku]
```

### File Structure

| File | Status | Purpose |
|------|--------|---------|
| `lib/poker/hand-evaluator.ts` | **NEW** | `evaluateHand(heroCards, communityCards): HandTier` |
| `lib/poker/board-analyzer.ts` | **NEW** | `analyzeBoard(communityCards): BoardTexture` |
| `lib/poker/rule-tree.ts` | **NEW** | `applyRuleTree(tier, texture, spr, potOdds, ...): LocalDecision` — extracted for testability |
| `lib/poker/equity/card.ts` | **NEW** | Card parsing, rank/suit to integer |
| `lib/poker/equity/outs.ts` | **NEW** | `analyzeOuts()` — exact out counting with deduplication |
| `lib/poker/equity/odds.ts` | **NEW** | `exactOutEquity()` — exact formula (not Rule of 2/4) |
| `lib/poker/equity/pot-odds.ts` | **NEW** | `computePotOdds()`, `potOddsDecision()` |
| `lib/poker/equity/implied-odds.ts` | **NEW** | `impliedOddsBonus()` with SPR and opponent-type factors |
| `lib/poker/equity/dirty-outs.ts` | **NEW** | `applyDirtyOutsDiscount()` for non-nut flush, OESD on paired board |
| `lib/poker/equity/hand-strength.ts` | **NEW** | `detectStrengthEquityMismatch()` — flag misleading high-strength spots |
| `lib/poker/equity/index.ts` | **NEW** | Re-exports |
| `extension/src/poker-content.ts` | **MODIFY** | Add `localDecide()`, import from `lib/poker/rule-tree.ts` |
| `lib/poker/hand-evaluator.test.ts` | **NEW** | Unit tests — all HandTier categories |
| `lib/poker/board-analyzer.test.ts` | **NEW** | Unit tests — all BoardTexture combinations |
| `lib/poker/rule-tree.test.ts` | **NEW** | Unit tests — all rule branches and confidence values |
| `lib/poker/equity/*.test.ts` | **NEW** | Unit tests for each equity sub-module |

> All `lib/poker/` modules are pure TypeScript. Bun bundles them into `extension/dist/poker-content.js`. Zero network calls from the engine itself.

### HandTier Enum

```typescript
// lib/poker/hand-evaluator.ts
// Algorithm: rank-counting tier classifier (no lookup tables — 130 lines, <0.005ms)
// Recommended by research: TwoPlusTwo (128MB) and Cactus Kev (~100KB tables) both disqualified
// for browser extensions. Rank counting is ideal: zero bundle overhead, native set/trips
// distinction, native nut-flush detection.

export type HandTier =
  | "nut"          // straight flush, quads, nut flush, full house
  | "strong"       // flush (non-nut), straight, SET (pocket pair hit board), two-pair
  | "top_pair_gk"  // TPTK (J+ kicker), overpair (pocket pair > all board cards)
  | "medium"       // middle pair, top pair weak kicker, TRIPS (one hole card + paired board)
  | "weak"         // bottom pair, underpair below board max
  | "strong_draw"  // 12+ outs: flush draw + pair OR flush draw + OESD
  | "draw"         // 8–9 outs: flush draw OR OESD
  | "weak_draw"    // 4 outs: gutshot
  | "air";         // nothing

export function evaluateHand(heroCards: string[], communityCards: string[]): HandTier
```

**Key distinctions that lookup tables cannot make (require knowing which cards are hero's):**

- **Set vs Trips**: set = hero contributed 2 cards (pocket pair) → `strong`; trips = hero contributed 1 card (board paired) → `medium`
- **Nut flush vs non-nut flush**: check if any higher card of flush suit is unaccounted for
- **Overpair vs top pair**: pocket pair higher than all board cards → `top_pair_gk`
- **TPTK kicker boundary**: kicker rank ≥ J (rank 11) → `top_pair_gk`; below J → `medium` (architecture review recommendation)

**Performance**: Pre-allocate module-level `Uint8Array` counters to avoid heap allocation per call:

```typescript
// module level — allocated ONCE, reused every call
const _rankCounts = new Uint8Array(15); // index = rank value 2-14
const _suitCounts = new Uint8Array(4);  // c=0, d=1, h=2, s=3

// hasStraight: bitmask approach — no sort, no allocation, ~15 integer ops
function hasStraight(rankCounts: Uint8Array): boolean {
  let bits = 0;
  for (let r = 2; r <= 14; r++) if (rankCounts[r] > 0) bits |= (1 << r);
  if (rankCounts[14] > 0) bits |= (1 << 1); // Ace-low
  for (let low = 1; low <= 10; low++) {
    const mask = 0b11111 << low;
    if ((bits & mask) === mask) return true;
  }
  return false;
}
```

**Result caching** (performance recommendation — per board, not per call):

```typescript
let _lastEvalKey = "";
let _lastHandTier: HandTier = "air";

export function evaluateHand(heroCards: string[], communityCards: string[]): HandTier {
  const key = heroCards.join() + "|" + communityCards.join();
  if (key === _lastEvalKey) return _lastHandTier;
  _lastEvalKey = key;
  _lastHandTier = _evaluateHandInternal(heroCards, communityCards);
  return _lastHandTier;
}
```

**Important edge cases (from research):**
- Backdoor gutshot on flop (only 3 community cards): classify as `weak_draw`, not `draw` — needs 2 running cards, ~4% equity
- Two-pair when both pairs are entirely on the board → `medium` (hero plays kicker only)
- Full-house detection: `trips.length >= 1 && pairs.length >= 2` works because trips rank satisfies pair condition; verify the `pairs` array includes trips rank

### BoardTexture Flags

```typescript
// lib/poker/board-analyzer.ts
export interface BoardTexture {
  suitedness: "monotone" | "two_tone" | "rainbow";
  paired: boolean;         // any two board cards share rank
  connected: boolean;      // largest gap between any two ranks ≤ 2
  highCards: boolean;      // A, K, or Q present
  lowCards: boolean;       // all board cards ≤ 7
  street: "flop" | "turn" | "river";
  wetScore: 0 | 1 | 2 | 3 | 4;  // derived — drives bet sizing (see GTO Wetness Parabola)
}

export function analyzeBoard(communityCards: string[]): BoardTexture
```

**GTO Wetness Parabola** (from GTO Wizard / PioSolver aggregate studies — drives bet sizing in rule tree):

| wetScore | Board type | Example | Bet size (IP) | C-bet freq (IP) |
|---|---|---|---|---|
| 0 | Dry rainbow, no draws | K7♦2♣ | **33% pot** | 80% |
| 1 | Paired + dry | 77x, Kx paired | **33% pot** | 65–82% |
| 2 | Semi-connected two-tone | K9♣8♦ | **50% pot** | 65% |
| 3 | Connected two-tone, lots of draws | 8♥7♦6♣ | **66% pot** | 55% |
| 4 | Monotone (paradox: back to small) | Q♠9♠5♠ | **33% pot** | 45% |

Counter-intuitive finding: **monotone boards want small sizing** (not large). The flush cards in the opponent's range jump ahead of many preflop-strong hands (AK, KQ), neutralising IP's nut advantage — so small sizing is more efficient than polarised large.

```typescript
function computeWetScore(t: BoardTexture): 0 | 1 | 2 | 3 | 4 {
  if (t.suitedness === "monotone") return 4;
  if (t.paired) return 1;                                    // paired dry
  if (t.suitedness === "two_tone" && t.connected) return 3;  // draws galore
  if (t.suitedness === "two_tone") return 2;                 // one draw type
  return 0;                                                   // rainbow dry
}
```

**Caching** (same board on every poll while street is active):

```typescript
let _lastBoardKey = "";
let _lastBoardTexture: BoardTexture | null = null;

export function analyzeBoard(communityCards: string[]): BoardTexture {
  const key = communityCards.join(","); // forward-only state machine ensures stable order
  if (key === _lastBoardKey && _lastBoardTexture) return _lastBoardTexture;
  _lastBoardKey = key;
  _lastBoardTexture = _analyzeBoardInternal(communityCards);
  return _lastBoardTexture;
}
```

**Note on Ace-low wraps**: when checking `connected`, treat A as rank 1 for A-2-3 connectivity detection (Ace-low straight draw).

### Decision Rule Tree

> Rule tree lives in `lib/poker/rule-tree.ts` (pure function, independently testable — architecture review recommendation). `poker-content.ts` imports and calls it.

```typescript
// lib/poker/rule-tree.ts
interface LocalDecision {
  action: "FOLD" | "CHECK" | "CALL" | "RAISE" | "BET";
  amount: number | null;   // euros, computed from pot × fraction (or null for check/fold/call)
  confidence: number;      // 0..1
  reasoning: string;       // for overlay display
}

interface RuleTreeInput {
  tier: HandTier;
  texture: BoardTexture;   // includes wetScore
  spr: number | null;
  equity: number | null;   // from lib/poker/equity — exact out-counting
  potOddsBreakeven: number | null; // from computePotOdds()
  facingBetFraction: number;       // callAmount / potValue
  potValue: number;        // parsed once from state.pot in localDecide()
  position: string;        // "IP" derived from BTN/CO or "OOP" from UTG/MP/SB
  street: "FLOP" | "TURN" | "RIVER";
  activePlayers: number;   // players.filter(p => !p.folded && p.hasCards).length
  opponentType: string;    // from session.opponents[villainSeat].inferredType
}

export function applyRuleTree(input: RuleTreeInput): LocalDecision
```

**Sizing from GTO Wetness Parabola** (PioSolver/GTO Wizard — solver-derived):

```typescript
function betSizeFromTexture(texture: BoardTexture, potValue: number): number {
  const fractions: Record<0|1|2|3|4, number> = {
    0: 0.33,   // dry rainbow → small (value extraction, no protection needed)
    1: 0.33,   // paired → small (rare draws, hard for opponent to continue even vs 33%)
    2: 0.50,   // semi-connected two-tone → medium
    3: 0.66,   // connected two-tone → large (protect, polarise)
    4: 0.33,   // monotone → small (opponent's flush cards neutralise nut advantage)
  };
  return Math.round(potValue * fractions[texture.wetScore] * 100) / 100;
}
```

**SPR commitment thresholds** (from GTO Wizard / SplitSuit / PokerVIP — solver consensus):

| SPR zone | Commit with | Notes |
|---|---|---|
| < 3 | Any TPTK+ | Auto stack-off zone |
| 3–6 | Two pair+ | TPTK: call down on dry, pot-control on wet |
| 6–10 | Set+ | TPTK is check-call or fold vs aggression |
| > 10 | Straight/flush+ | Deep stack: implied odds dominate |

**GTO-informed decision table:**

| Condition | Action | Sizing | Confidence |
|---|---|---|---|
| SPR < 3 AND tier ≥ top_pair_gk | RAISE | all-in or max | 0.90 |
| tier = nut, any board | BET/RAISE | wetScore sizing | 0.90 |
| tier = strong + IP | BET | wetScore sizing | 0.85 |
| tier = strong + OOP | CHECK (let IP bet) or BET vs 45%+ c-bet freq | wetScore sizing | 0.75 |
| tier = top_pair_gk + IP + SPR 3–10 | BET | 33–50% | 0.80 |
| tier = top_pair_gk + OOP + dry board | CHECK-CALL ≤ 50% pot | — | 0.70 |
| tier = top_pair_gk + OOP + wet board | CHECK (pot-control) | — | 0.65 |
| tier = strong_draw (12+ outs) + IP | BET (semi-bluff) | 50–66% | 0.80 |
| tier = strong_draw + OOP | CHECK-RAISE (GTO: 12+ outs = check-raise) | 2.5x | 0.75 |
| tier = draw, equity > potOddsBreakeven | CALL | — | 0.75 |
| tier = draw, equity < potOddsBreakeven | FOLD | — | 0.82 |
| tier = medium + facingBetFraction > 0.50 | FOLD | — | 0.72 |
| tier = medium + facingBetFraction ≤ 0.33 | CALL (pot odds ok) | — | 0.65 |
| tier = weak_draw | FOLD unless pot odds > outEquity | — | 0.78 |
| tier = air + not river | CHECK or FOLD to any bet | — | 0.72 |
| tier = air + river + IP | BET bluff (13–18% freq, micro-stakes 10%) | 50% | 0.48 → AI |
| tier = air + river + OOP | FOLD | — | 0.75 |
| tier = weak + SPR > 6 + facing bet | FOLD | — | 0.78 |
| Facing check-raise | — | — | 0.30 → AI |
| street = RIVER + tier = medium or weak | — | — | 0.45 → AI |

**Confidence penalties (single accumulation point):**

```typescript
// Apply AFTER primary rule assignment, before return
if (activePlayers > 2) confidence -= 0.20 * (activePlayers - 2);
if (position === "??") confidence -= 0.10;
if (street === "RIVER" && tier === "air") confidence -= 0.30;
if (texture.wetScore === 3 && ["medium", "weak"].includes(tier)) confidence -= 0.10;
```

**Opponent-type exploit adjustments** (applied as a post-processing step — see Phase 4.5):

```typescript
// LOOSE_PASSIVE (calling station): remove bluffs, add thin value bets
if (opponentType === "LOOSE_PASSIVE" && action === "BET" && tier === "air") {
  action = "CHECK"; confidence += 0.10; reasoning += " [exploit: no bluff vs station]";
}
// TIGHT_PASSIVE (nit): add steals/bluffs
if (opponentType === "TIGHT_PASSIVE" && action === "CHECK") {
  action = "BET"; amount = betSizeFromTexture(texture, potValue) * 0.5; // smaller vs nit
  confidence += 0.05; reasoning += " [exploit: steal vs nit]";
}
// TIGHT_AGGRESSIVE: trust their aggression more, fold tighter
if (opponentType === "TIGHT_AGGRESSIVE" && facingBetFraction > 0.40) {
  if (["medium", "weak"].includes(tier)) { action = "FOLD"; confidence += 0.08; }
}
// LOOSE_AGGRESSIVE: call wider with made hands, don't bluff
if (opponentType === "LOOSE_AGGRESSIVE" && tier !== "air") {
  if (action === "FOLD" && facingBetFraction < 0.60) { action = "CALL"; confidence -= 0.10; }
}
```

**Single-allocation return pattern** (performance recommendation):

```typescript
export function applyRuleTree(input: RuleTreeInput): LocalDecision {
  let action: LocalDecision["action"] = "FOLD";
  let amount: number | null = null;
  let confidence = 0.70;
  let reasoning = "";

  // ... branches mutate the variables, never return early ...

  // penalties applied ONCE
  if (input.activePlayers > 2) confidence -= 0.20 * (input.activePlayers - 2);
  if (input.position === "??") confidence -= 0.10;

  return { action, amount, confidence, reasoning }; // single allocation
}
```

**Pot fraction → euro conversion** (parse-once pattern — potValue passed in, not re-parsed):

```typescript
// potValue already parsed in localDecide() entry — passed to rule tree as a number
function betAmount(potValue: number, fraction: number): number {
  return Math.round(potValue * fraction * 100) / 100;
}
```

### Integration into processGameState()

```typescript
// poker-content.ts — replace current requestDecision() call at hero's-turn block
// Key findings from codebase exploration:
// - heroStack is NOT top-level: use state.players.find(p => p.seat === state.heroSeat)?.stack
// - BTN/SB position (2-player) must be normalised to "BTN" before chart lookup
// - communityCards.length >= 3 required before postflop engine (architecture review)
// - potValue parsed ONCE here, passed down to computeSPR, rule tree (performance)

if (state.isHeroTurn && !lastHeroTurn && !executing && autopilotMode !== "off") {
  // ... build handMessages as today ...

  if (autopilotMode === "play") {
    let local: LocalDecision | null = null;
    try {
      local = localDecide(state);  // wrapped in try/catch — must not fail silently
    } catch (err) {
      console.error("[Poker] localDecide() threw:", err);
      executing = false;  // critical: release mutex on local engine failure
    }

    if (local && local.confidence >= CONFIDENCE_THRESHOLD) {
      console.log(`[Local] ${local.action}${local.amount ? ` €${local.amount}` : ""} (${local.confidence.toFixed(2)}) — ${local.reasoning}`);
      executing = true;
      monitorAdvice = { action: local.action, amount: local.amount, reasoning: `[Local] ${local.reasoning}` };
      await humanDelay(800, 1800);
      safeExecuteAction({ action: local.action, amount: local.amount, reasoning: local.reasoning });
    } else {
      // confidence < threshold or local engine returned null → Claude Haiku fallback
      requestDecision([...handMessages]);
    }
  } else {
    // Monitor mode: always request Claude for display purposes
    requestDecision([...handMessages]);
  }
}

// CONFIDENCE_THRESHOLD: read from chrome.storage.local at startup, default 0.60
// This allows runtime tuning without reinstalling the extension (architecture recommendation)
let CONFIDENCE_THRESHOLD = 0.60;
chrome.storage.local.get("localEngineThreshold", (v) => {
  if (typeof v.localEngineThreshold === "number") {
    CONFIDENCE_THRESHOLD = v.localEngineThreshold;
  }
});
```

---

## Critical Gaps (SpecFlow Analysis — 2026-02-24)

Seven P1 findings from automated flow analysis surfaced in `docs/analysis/2026-02-24-local-engine-flow-analysis.md`. Each is addressed in the relevant phase checklist below.

### Q1 — Preflop async race
`requestPersona()` is async; `lastPersonaRec` may still be `null` when hero's turn fires on a fast table. **Already handled** — Phase 1 falls to Claude if `lastPersonaRec === null`. Documented explicitly in Phase 1 checklist.

### Q2 — Chart is RFI-only (critical)
Persona charts encode **open-raise strategy only**. If hero faces a 3-bet, a cold-call spot, or a limp-in pot, `lastPersonaRec.action: "RAISE"` is wrong. Phase 1 must guard before using the chart:

```typescript
// Only use chart when hero is first to voluntarily act — no opponent has put money in
const facingRaise = availableActions.some(a => a.type === "CALL" && parseFloat(a.amount ?? "0") > 0);
if (facingRaise) {
  // skip chart → fall to Claude
}
```

### Q3 — FOLD-safety bypass (critical — real money)
The current FOLD→CHECK safety override lives inside `executeAction()`. The local engine must route through the same safety layer as the Claude path. **Resolution**: extract `safeExecuteAction()` to be the single point of execution for all autopilot actions:

```typescript
function safeExecuteAction(decision: { action: string; amount: number | null; reasoning: string }) {
  // (1) FOLD→CHECK override if CHECK available
  // (2) Monitor-mode intercept — log only, no DOM click
  // (3) Pre-action checkbox clearing
  executeAction(decision);
}
```

Both local engine and Claude Haiku callback call `safeExecuteAction()`, never `executeAction()` directly.

### Q4 — "Facing a bet" threshold undefined
Rule tree conditions like `"tier = medium + facing bet > 1/3 pot"` require a computed `facingBetFraction`. Concrete derivation:

```typescript
const callAction = availableActions.find(a => a.type === "CALL");
const callAmount = callAction ? parseFloat(callAction.amount ?? "0") : 0;
const potValue = parseFloat(pot.replace(/[€$£,]/g, "")) || 0;
const facingBetFraction = potValue > 0 ? callAmount / potValue : 0;
// e.g. facingBetFraction > 0.33 → "facing big bet"
```

### Q5 — Card format `"10h"` not `"Th"`
`evaluateHand()` receives raw DOM card strings. The DOM emits `"10h"` for ten of hearts (confirmed in MEMORY.md gotchas). `rankValue()` must handle the two-character `"10"` prefix:

```typescript
function rankValue(rank: string): number {
  if (rank === "10") return 10;  // DOM format
  const map: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10, "9": 9, ... };
  return map[rank] ?? 0;
}
```

Tests must cover `["10h", "10d", "10s", "10c"]` explicitly.

### Q6 — `effectiveStack` definition
`computeSPR()` needs a single euro value. Use `heroStack`. Opponent stacks are scraped but unreliable; defaulting to `heroStack` is the conservative choice and correct for heads-up deep-stack play.

### Q7 — `executing` flag lifecycle
`executing = true` must be set **before** `executeAction()` is called on the local path (same requirement as Claude path). The `!executing` guard in the rising-edge block prevents double-fire. The integration snippet in "Integration into processGameState()" already shows this; Phase 4 checklist makes it explicit.

---

## Implementation Phases

### Phase 0: Extract `safeExecuteAction()` (precondition — 0.5 day)

**Goal**: Single execution wrapper used by both local engine and Claude callback.

- [ ] Extract `safeExecuteAction(decision)` from current `executeAction()` logic in `poker-content.ts`
  - Applies FOLD→CHECK override (if FOLD requested but CHECK available → CHECK instead)
  - Applies monitor-mode intercept (log to console, update overlay, but do **not** click DOM)
  - Clears pre-action checkboxes before clicking
- [ ] Update Claude callback (`requestDecision()` response handler) to call `safeExecuteAction()` instead of `executeAction()` directly
- [ ] All subsequent phases route autopilot actions through `safeExecuteAction()` exclusively

**Success criteria**: Existing play-mode behaviour unchanged. Monitor-mode never clicks buttons.

---

### Phase 1: Preflop chart wiring (1 day)

**Goal**: Eliminate all preflop API calls. RAISE/CALL/FOLD executed directly from persona chart.

- [ ] In `processGameState()`, at hero's-turn rising edge, check:
  `communityCards.length === 0 && lastPersonaRec !== null`
- [ ] **RFI-only guard** (Q2): only use chart when `availableActions` contains no CALL with non-zero amount
  ```typescript
  const facingRaise = availableActions.some(a => a.type === "CALL" && parseFloat(a.amount ?? "0") > 0);
  if (facingRaise) fall through to requestDecision();
  ```
- [ ] If persona loaded and not facing raise and `autopilotMode === "play"`: call `safeExecuteAction()` with `lastPersonaRec.action`
- [ ] If `lastPersonaRec` is null (async not yet resolved) (Q1): fall back to `requestDecision()`
- [ ] Log `[Preflop] ${action} (chart)` on execution
- [ ] Update overlay `monitorAdvice` with chart action + persona name

**Blocker note**: RAISE clicks the raise button without custom sizing (todo 030 — same as current Claude path). At micro-stakes this is acceptable (default raise = min-raise or 3x depending on table settings).

**Success criteria**: Zero Claude API calls on preflop RFI streets when persona is loaded. 3-bet and limp spots still fall to Claude.

---

### Phase 2: Hand evaluator (2–3 days)

**Goal**: Pure function `evaluateHand()` covering all 7-card combinations.

**File**: `lib/poker/hand-evaluator.ts`

```typescript
// Card format: "Ah", "Kd", "10s", "2c" — DOM emits "10h" NOT "Th" for tens (see Q5, MEMORY.md gotchas)
export function evaluateHand(heroCards: string[], communityCards: string[]): HandTier

// Internal helpers
function parseCard(card: string): { rank: number; suit: string }
// rankValue handles both "10" (two-char DOM format) and "T" as rank 10
function rankValue(rank: string): number   // A=14, K=13, ..., "10"/T=10, 2=2
function hasFlush(cards: ParsedCard[]): boolean
function hasStraight(ranks: number[]): boolean
function groupByRank(cards: ParsedCard[]): Map<number, number>  // rank → count
function isNutFlush(heroCards: ParsedCard[], communityCards: ParsedCard[]): boolean
```

**HandTier classification logic:**
```
all 7 cards:
  straight flush → nut
  quads → nut
  full house → nut
  nut flush → nut
  flush (non-nut) → strong
  straight → strong
  set (3-of-a-kind using hole card) → strong
  two-pair → strong  [unless both pairs on board → medium]
  top-pair + good kicker (kicker > 9 OR kicker > top-pair rank - 3) → top_pair_gk
  top-pair + weak kicker → medium
  overpair → top_pair_gk
  middle-pair → medium
  bottom-pair → weak

  draw detection (hero cards + 4 community or 3 community):
    flush draw: 4 suited → draw (or strong_draw if also pair/OESD)
    OESD: 4 consecutive → draw
    gutshot: 3 of 4 consecutive → weak_draw
    combo: flush + OESD → strong_draw

  otherwise → air
```

- [ ] Implement `lib/poker/hand-evaluator.ts` (~130 lines — see reference implementation in HandTier section)
- [ ] Use pre-allocated `Uint8Array` counters at module level (see performance section)
- [ ] Implement bitmask `hasStraight()` — no sort, no allocation
- [ ] Add result caching: `_lastEvalKey` / `_lastHandTier` module-level variables
- [ ] **TPTK kicker boundary**: kicker rank ≥ J (rank 11) → `top_pair_gk`; below J → `medium`
- [ ] **Set vs trips**: set = `heroRankCounts.get(rank) === 2` → `strong`; trips = `heroRankCounts.get(rank) === 1` → `medium`
- [ ] **Overpair**: pocket pair (heroRankCounts for that rank = 2) with pair > max(boardRanks) → `top_pair_gk`
- [ ] **Full house check**: verify `pairs` array includes the trips rank (edge case from research)
- [ ] **Backdoor gutshot** (only 3 board cards): classify as `weak_draw`, not `draw`
- [ ] Unit tests covering: nut flush, non-nut flush, straight, set, trips, two-pair, TPTK with J+ kicker, TPTK with weak kicker, overpair, underpair, middle pair, bottom pair, strong_draw (combo), draw, weak_draw (gutshot), air
- [ ] Edge case tests: `"10h"/"10d"/"10s"/"10c"` notation (Q5), suited connectors, board-heavy hands, paired board with trips
- [ ] Run `bun test lib/poker/hand-evaluator.test.ts`

---

### Phase 2.5: Equity module (1–2 days)

**Goal**: Pure equity functions feeding the rule tree. Replaces the approximate "pot fraction" logic with exact calculations.

**Directory**: `lib/poker/equity/`

```
lib/poker/equity/
├── card.ts         parseCard() — handles "10h" and "Th" both as rank 10
├── outs.ts         analyzeOuts() → DrawAnalysis (flushOuts, oesdOuts, gutOuts, totalClean)
├── odds.ts         exactOutEquity(outs, street) — NOT Rule of 2/4 (exact formula)
├── pot-odds.ts     computePotOdds(potBeforeBet, betAmount, callAmount) → breakevenEquity
├── implied-odds.ts impliedOddsBonus(spr, drawType, opponentType, ...) → equity bonus
├── dirty-outs.ts   applyDirtyOutsDiscount() — non-nut flush (-1/-2), OESD on paired (-2)
├── hand-strength.ts detectStrengthEquityMismatch() — flag misleading hand strength spots
└── index.ts        re-exports
```

- [ ] Implement `card.ts` — `parseCard()` mapping "10h"→rank 10 and "Th"→rank 10 for compatibility
- [ ] Implement `outs.ts`:
  - Flush draw: count remaining cards of that suit not in deadSet
  - OESD: 4-card window spanning exactly 3 ranks (gap=3) — 2×4=8 outs
  - Double-gutshot: 2 distinct interior windows each missing 1 rank — ~8 outs
  - Gutshot: single interior gap — 4 outs
  - Combo `strong_draw`: flush + OESD, or flush + pair — deduplicate overlapping suit outs
- [ ] Implement `odds.ts` — exact formula (NOT Rule of 2/4):
  - Flop (2 to come): `1 - ((47-outs)(46-outs)) / (47*46)`
  - Turn (1 to come): `outs / 46`
- [ ] Implement `pot-odds.ts` — `breakevenEquity = callAmount / (potBeforeBet + betFacing + callAmount)`
- [ ] Implement `implied-odds.ts` — additive equity bonus capped at +12%: SPR > 15 = +4%, nut draw = +2%, calling station = +2%
- [ ] Implement `dirty-outs.ts` — non-nut flush on aggressive line = -2 outs; OESD on paired board = -2 outs
- [ ] Implement `hand-strength.ts` — `detectStrengthEquityMismatch()` for: overpair on AKQ board, J-high flush, straight on paired board
- [ ] Unit tests for each file; run `bun test lib/poker/equity/`

**Key insight from research**: a combo draw with 13+ outs is often >50% equity vs top pair — the rule tree should treat `strong_draw` as semi-bluff BET/RAISE, not just a call.

---

### Phase 3: Board analyzer (1 day)

**Goal**: Pure function `analyzeBoard()` classifying board texture.

**File**: `lib/poker/board-analyzer.ts`

```typescript
export function analyzeBoard(communityCards: string[]): BoardTexture

// Returns "flop" for 3 cards, "turn" for 4, "river" for 5
// communityCards.length === 0 → throws (preflop should not call this)
```

**Implementation:**
```typescript
suitedness:
  all same suit → "monotone"
  exactly 2 same suit → "two_tone"
  else → "rainbow"

paired:
  any rank appears ≥ 2 times → true

connected:
  sort ranks; max gap between consecutive ranks ≤ 2 → true
  (include A as 1 for A-2-3-4 wraps)

highCards:
  any rank is A, K, or Q → true

lowCards:
  all ranks ≤ 7 → true
```

- [ ] Implement `lib/poker/board-analyzer.ts` (~80 lines)
- [ ] Add `wetScore: 0|1|2|3|4` to `BoardTexture` interface (drives bet sizing in rule tree)
- [ ] Implement `computeWetScore()` mapping: monotone=4, paired=1, connected+two_tone=3, two_tone=2, rainbow=0
- [ ] Add result caching: `_lastBoardKey` / `_lastBoardTexture` module-level variables
- [ ] Ace-as-1 for A-2-3 wrap detection in `connected` flag
- [ ] **Guard**: `communityCards.length < 3 → throw` (preflop must never call this)
- [ ] Unit tests: all suitedness variants, paired boards, connected boards, high/low flags, wetScore values
- [ ] Run `bun test lib/poker/board-analyzer.test.ts`

---

### Phase 4: Decision tree + integration (3 days)

**Goal**: `localDecide()` replaces `requestDecision()` in the play-mode path for high-confidence spots.

- [ ] Move rule tree to `lib/poker/rule-tree.ts` (architecture review — must be independently testable; `poker-content.ts` depends on `chrome.*` which blocks `bun test`)
- [ ] Add `localDecide(state: GameState): LocalDecision | null` to `poker-content.ts`:
  - Returns `null` if preflop OR `communityCards.length < 3` (architecture review: `>0` is not enough — partial flops during deal)
  - **Parse `potValue` ONCE here** (performance): `const potValue = parseCurrencyString(state.pot)` — pass number to all downstream functions
  - **heroStack lookup** (codebase exploration): `state.players.find(p => p.seat === state.heroSeat)?.stack`
  - **BTN/SB normalisation** (architecture review): `const pos = rawPosition === "BTN/SB" ? "BTN" : rawPosition`
  - Calls `evaluateHand()`, `analyzeBoard()`, `analyzeOuts()`, `exactOutEquity()`, `computePotOdds()`
  - Calls `detectStrengthEquityMismatch()` — if mismatch found, apply confidence penalty
  - Calls `applyRuleTree()` from `lib/poker/rule-tree.ts`
  - Returns `{ action, amount, confidence, reasoning }`

- [ ] Add `parseCurrencyString(raw: string): number | null` helper:
  - Handles `"€38.50"`, `"$12.00"`, `"1.50 BB"` (common Playtech formats)
  - Returns `null` on NaN or empty — triggers `isNaN(potValue) → confidence -= 0.15` in caller

- [ ] Add `computeSPR(heroStackStr: string, potValue: number): number | null` (Q6):
  - `effectiveStack = parseFloat(heroStackStr.replace(...))` (opponent stack unreliable)
  - Returns `null` if potValue is 0 or NaN

- [ ] `computePotOdds()` / `computeFacingBetFraction()` — pass already-parsed `potValue` (not re-parse)

- [ ] Integrate into hero's-turn block (see full snippet in "Integration into processGameState()"):
  - `!executing` guard at block entry (Q7)
  - Wrap `localDecide()` in `try/catch` with `executing = false` in catch (architecture review)
  - `executing = true` set BEFORE calling `safeExecuteAction()` (Q3)
  - Read `CONFIDENCE_THRESHOLD` from `chrome.storage.local` (architecture review)

- [ ] Add Phase 4.5 — opponent type post-processing in `applyRuleTree()`:
  - Read `opponentType` from `session.opponents[villainSeat]?.inferredType ?? "UNKNOWN"`
  - Apply exploit delta table (see Decision Rule Tree section)
  - `"UNKNOWN"` → confidence `-0.05` (less reliable than classified opponent)

- [ ] Add `lib/poker/rule-tree.test.ts`:
  - Test all primary rule branches (nut bet, draw call, air fold, etc.)
  - Test SPR commitment zones: SPR=2 → auto-commit with TPTK; SPR=12 → no commit
  - Test confidence penalties accumulation
  - Test exploit adjustments per opponent type

- [ ] Overlay display: `[Local]` vs `[AI]` tag in advice line

- [ ] Log format: `[Local] BET €0.90 (0.82) — strong hand on dry board (wetScore=0)`

- [ ] Test with play mode on real table for 2–3 sessions; review console logs

---

## Alternative Approaches Considered

| Approach | Why Rejected |
|----------|-------------|
| GTO solver tables | 3+ week build, large data files, overkill for micro-stakes |
| WASM poker library | Extension CSP complexity, no existing integration, high risk |
| Pure AI (current) | ~600ms latency, requires server running, costly per decision |

---

## Acceptance Criteria

### Functional

- [ ] Preflop: 100% of decisions execute from persona chart (zero Claude calls when persona loaded)
- [ ] Post-flop: ≥ 80% of heads-up standard spots classified with confidence ≥ 0.60
- [ ] Multi-way (3+ players): confidence penalty applied, more decisions fall to AI
- [ ] AI fallback fires automatically and seamlessly when confidence < 0.60
- [ ] FOLD override → CHECK still applies on local path (not just Claude path)
- [ ] Overlay shows `[Local]` vs `[AI]` source tag

### Safety (real-money table)

- [ ] Local engine never executes when `executing === true` (mutex respected)
- [ ] Watchdog timeout still active for AI-fallback path
- [ ] RAISE falls back correctly if raise button unavailable (existing FALLBACK_MAP)
- [ ] Position `"??"` treated as OOP (confidence penalty, conservative play)
- [ ] Empty community cards (preflop) never reaches post-flop decision tree

### Quality

- [ ] `evaluateHand()` unit tests pass for all 9 HandTier values
- [ ] `analyzeBoard()` unit tests pass for all BoardTexture combinations
- [ ] `bun test lib/poker/` passes clean

---

## Dependencies & Risks

| Item | Impact | Mitigation |
|------|--------|-----------|
| **todo 030** (bet-slider) | RAISE/BET without custom sizing | Acceptable at micro-stakes; min-raise > CALL from a limp |
| `requestPersona()` async | Persona null on fast preflop | Phase 1 falls to Claude if `lastPersonaRec === null` (Q1) |
| Card parse errors | Wrong HandTier | `parseCard()` returns null → `evaluateHand()` returns `"air"`, confidence 0.3 → AI |
| Board card count < 3 | Partial flop during deal fired to postflop engine | Guard: `communityCards.length < 3 → return null` (architecture review — >0 is insufficient) |
| Stack/pot parse failure | NaN SPR | `parseCurrencyString()` returns null → skip SPR rules, `-0.15` confidence |
| `heroStack` not top-level | Wrong SPR calculation | Use `state.players.find(p => p.seat === state.heroSeat)?.stack` (codebase finding) |
| BTN/SB in heads-up | Chart lookup fails silently | Normalise: `"BTN/SB" → "BTN"` before persona lookup (architecture review) |
| `executing` flag race | Double-action on same turn | `!executing` guard at block entry + `try/catch` with `executing=false` in catch |
| Confidence thresholds uncalibrated | Wrong local/AI split | Phase 4 tuning: log all decisions, adjust `CONFIDENCE_THRESHOLD` via `chrome.storage.local` |
| Rule tree untestable in content script | Regressions go undetected | Move to `lib/poker/rule-tree.ts` — independently testable with `bun test` |
| Non-nut flush on aggressive line | Reverse implied odds, loses to higher flush | `dirty-outs.ts` discounts -2 outs; `strong` → `medium` when mismatch detected |
| Combo draw misclassified as weak | Folds 52%+ equity hand | `strong_draw` = 12+ outs → rule tree: BET/RAISE as semi-bluff (not call/fold) |

---

## References

### Internal

- Preflop charts: `lib/poker/personas.ts` (4,056 entries — do not edit)
- Persona lookup: `lib/poker/persona-lookup.ts`
- Persona selector: `lib/poker/persona-selector.ts`
- Content script execution: `extension/src/poker-content.ts:executeAction()` (~L700)
- Content script integration point: `extension/src/poker-content.ts:processGameState()` (~L877)
- Existing AI path: `app/api/autopilot/route.ts`
- todo 030: bet-input slider wiring (RAISE/BET custom sizing)
- Hand state + card format: `"10"` not `"T"` — see MEMORY.md gotchas

### Brainstorm

- `docs/brainstorms/2026-02-24-local-poker-agent-brainstorm.md`

### GTO Sources (research-grounded)

- [GTO Wizard — Flop Heuristics: IP C-Betting](https://blog.gtowizard.com/flop-heuristics-ip-c-betting-in-cash-games/) — c-bet frequencies and sizing by board texture
- [GTO Wizard — Stack-to-Pot Ratio](https://blog.gtowizard.com/stack-to-pot-ratio/) — SPR commitment thresholds
- [GTO Wizard — Equity Realization](https://blog.gtowizard.com/equity-realization/) — why strong draws beat weak made hands in EV
- [GTO Wizard — C-Bet Sizing Mechanics](https://blog.gtowizard.com/the-mechanics-of-c-bet-sizing/) — Wetness Parabola derivation
- [SplitSuit — SPR Strategy](https://www.splitsuit.com/spr-poker-strategy) — micro-stakes commitment zones
- [Upswing Poker — Drawing Odds & Outs](https://upswingpoker.com/poker-drawing-odds-outs-explained/) — out counting reference

### Related Learnings

- `docs/solutions/implementation-patterns/persona-design-profitable-archetypes.md` — no CALL in RFI positions
- `docs/solutions/implementation-patterns/persona-auto-selection-table-temperature.md` — per-hand locking pattern
- `docs/solutions/logic-errors/continuous-capture-race-conditions.md` — executing flag patterns
