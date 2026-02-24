---
title: Opponent Modelling Integration into Rule-Based Decision Engine
date: 2026-02-24
status: research
tags: [rule-engine, opponent-modelling, vpip, af, exploit, confidence]
---

# Opponent Modelling — Rule Engine Integration Brainstorm

Research findings on integrating opponent type data into the local rule-based decision
engine (`localDecide()` in `poker-content.ts`). This document covers VPIP/AF
interpretation, per-type exploit adjustments, confidence scoring, seat vs table scope,
sample size thresholds, and anti-patterns.

---

## 1. VPIP / Aggression Factor Interpretation

### What the stats mean

| Stat | What it measures | Range |
|------|-----------------|-------|
| VPIP | % of hands player voluntarily puts money in preflop | 10–20% tight, 20–30% loose, 40%+ very loose |
| PFR  | % hands where player raises preflop | typically VPIP - 2-5% for balanced players |
| AF (Aggression Factor) | ratio of aggressive to passive postflop actions | <2 passive, 2-4 balanced, >4 aggressive |
| VPIP–PFR gap | how often player calls vs raises | large gap (>10%) → calling station, small gap → aggressor |

### Mapping to inferred player types in this system

The `inferredType` Claude produces maps directly onto stat profiles:

| InferredType | VPIP profile | AF profile | VPIP-PFR gap |
|---|---|---|---|
| TIGHT_PASSIVE | 10–18% | <2 | large (calls more than raises) |
| TIGHT_AGGRESSIVE | 12–22% | 3–6+ | small (nearly as many raises as calls) |
| LOOSE_PASSIVE | 30–55% | <2 | very large (calls most of the wide range) |
| LOOSE_AGGRESSIVE | 28–50% | 4–8+ | moderate (raises many of those wide hands) |

### Post-flop interpretation of a bet given opponent VPIP

When a LOOSE_PASSIVE (VPIP > 40%) bets into you:
- Their wide range hits boards infrequently. When they bet, they're more likely to have
  made a pair or better than to be semi-bluffing, because passive players rarely bluff.
- Their value range is WIDE — second pair, weak top pair, and weak two pair are all
  "value" for them.
- **Do NOT discount their hand by assuming it's a bluff.** They are not bluffing.
  They missed most of the time and are likely to CHECK. When they bet, take it seriously.

When a LOOSE_AGGRESSIVE (VPIP > 35%, high AF) bets or raises:
- Their range is wide AND they bet frequently regardless of hand strength.
- Their value-to-bluff ratio is out of balance — too many bluffs relative to their
  frequency.
- Discount their bluff likelihood downward only slightly. Widen your calling range
  with made hands, but do not bluff-raise them — they will call.

When a TIGHT_AGGRESSIVE bets:
- Their range is narrow AND they bet for value/semi-bluff. This is the most credible bet.
- High probability of top pair or better, or a strong draw with equity.
- Dramatically reduce the bluff component of their range.

When a TIGHT_PASSIVE bets:
- When a nit bets, they almost certainly have it. Nearly pure value.
- Very little bluffing component. Treat this as a near-nut range.

### Summary formula for bluff-discount modifier

```
bluffDiscount(type):
  TIGHT_PASSIVE:    -0.85  (their bet range is 85% value, discount bluffs heavily)
  TIGHT_AGGRESSIVE: -0.50  (balanced-ish, still discount bluffs some)
  LOOSE_PASSIVE:    -0.70  (they never bluff, discount bluffs heavily despite wide range)
  LOOSE_AGGRESSIVE: -0.20  (they bluff a lot, discount bluffs only slightly)
  UNKNOWN:           0.00  (assume GTO balance)
```

Used to adjust the hero's call threshold:
- High bluffDiscount → tighten call range (need stronger hand to call)
- Low bluffDiscount → call wider (include bluff-catchers)

---

## 2. Exploit Adjustments by Opponent Type

These are post-processing adjustments applied AFTER the base rule tree produces a
`{ action, amount, confidence }`. They modify the action, sizing, or confidence.

### 2a. LOOSE_PASSIVE (calling station)

**Profile**: VPIP 35–60%, AF < 2, never bluffs, calls too wide.

**Exploit principles**:
1. Value bet thinner — second pair, weak aces, even third pair on dry boards can be bet.
2. Size up on value — they call pot-sized bets with third pair; don't leave money on the table.
3. Remove bluffs entirely — any bluff line is EV-negative. They will call.
4. Check weak made hands back vs betting — not to check-raise, but to avoid inflating
   a pot where they happen to have caught up.

**Action overrides**:

| Base rule tree says | Opponent is LOOSE_PASSIVE | Modified decision |
|---|---|---|
| CHECK (medium hand, OOP) | → they rarely bluff, so no free card risk | BET for thin value at 40% pot |
| BET (value, 50% pot) | → size up, they call anyway | BET at 70-75% pot |
| BET/RAISE (semi-bluff) | → remove the bluff; just check or call | CHECK or CALL |
| FOLD (marginal, facing small bet) | → their bet range is wide value not bluff | reconsider CALL if pot odds >= 25% |

**Confidence modifier**: `+0.10`
Loose passives are the most predictable opponent type. Adjustments carry high reliability.

**Sizing multiplier**: `1.30` on value bets (increase sizing by 30%)

### 2b. TIGHT_AGGRESSIVE (TAG)

**Profile**: VPIP 12–22%, AF 3–6, high PFR relative to VPIP, 3-bets with purpose.

**Exploit principles**:
1. Reduce bluff frequency against them significantly — they do not fold to bluffs easily.
2. Tighten call thresholds — when they bet, they have it. Bluff-catchers are rarely good.
3. Respect their raises — fold more than GTO suggests with medium-strength hands.
4. Attack their weakness — when they CHECK, their range is usually capped. Bet into their
   checks aggressively in position.

**Action overrides**:

| Base rule tree says | Opponent is TIGHT_AGGRESSIVE | Modified decision |
|---|---|---|
| BET (semi-bluff) | → reduce bluffing | check instead, or reduce sizing to probe |
| CALL (medium hand, facing raise) | → tighten; they rarely raise without it | FOLD instead |
| RAISE (bluff) | → do not bluff-raise TAGs | FOLD |
| BET (value) on blank turn | → standard, they call too infrequently with nothing | keep, confidence +0.05 |

**Confidence modifier**: `-0.05` (they fight back, increasing uncertainty on bluff spots)

**Bluff-frequency suppressor**: Suppress all pure-air bluffs; allow semi-bluffs with 8+ outs only.

### 2c. LOOSE_AGGRESSIVE (LAG / maniac)

**Profile**: VPIP 35–55%, AF 4–8+, wide ranges + aggressive, raises frequently.

**Exploit principles**:
1. Call wider with made hands — second pair, weak top pair are valid call-downs.
2. Do not bluff — they will call or raise; bluffs fail catastrophically.
3. GTO-defensive: do not over-adjust, they will notice and re-exploit.
4. Let them bluff into you — checking back made hands can be correct to induce.
5. Pot control is secondary — they will build the pot for you; focus on hand strength.

**Action overrides**:

| Base rule tree says | Opponent is LOOSE_AGGRESSIVE | Modified decision |
|---|---|---|
| FOLD (medium, facing c-bet) | → widen call range vs LAG aggression | CALL if pot odds >= 22% |
| BET (semi-bluff) | → do not bluff LAGs | CHECK/CALL |
| CHECK (medium, IP) | → pot control is fine; let them bluff | keep CHECK |
| RAISE (bluff over their bet) | → never bluff-raise a LAG | CALL instead |

**Confidence modifier**: `-0.10`
LAGs create the most variance. Their wide bluffing range means both call and fold have merit,
which reduces the rule engine's certainty. More AI fallback is appropriate in edge spots.

**Call-width expansion**: Expand call threshold by 8–12% equity (vs. the GTO baseline).

### 2d. TIGHT_PASSIVE (nit)

**Profile**: VPIP 10–18%, AF < 2, almost never bluffs, barely bets even with strong hands.

**Exploit principles**:
1. Steal from them aggressively preflop — they fold to any raise from OOP positions.
2. Bluff them on scary boards — they are over-folding if the board is frightening.
3. When they show aggression: fold everything except nuts. Nits who bet or raise always
   have it. No exceptions.
4. Value bet narrowly against them — they call infrequently, so thin value becomes
   breakeven or losing quickly.

**Action overrides**:

| Base rule tree says | Opponent is TIGHT_PASSIVE | Modified decision |
|---|---|---|
| CHECK (OOP, medium) | → missed steal opportunity | BET as bluff/semi-bluff on scare cards |
| CALL (medium, facing bet) | → nit bet = near-nut range | FOLD |
| BET (thin value) | → they rarely call without top pair+ | CHECK back instead |
| RAISE (bluff on blank board) | → they may not fold fast enough | prefer CHECK/CALL; bluff only on scare cards |

**Confidence modifier**: `+0.08` on fold/bluff decisions, `-0.15` on value-bet decisions
(high confidence when folding to their bets, lower confidence trying to value-bet thin).

**Bluff-frequency boost on scare cards**: Allow pure bluffs on A/K high boards and
monotone boards where nit's range is under pressure.

---

## 3. Confidence Scoring Adjustments

The base rule tree produces `confidence: 0..1`. Opponent type modifies it as a delta.

### Per-type baseline modifier

```typescript
type ConfidenceDelta = {
  base: number;       // applied to all decisions vs this type
  valueBet: number;   // additional delta when action = BET (value context)
  bluff: number;      // additional delta when action = BET/RAISE (bluff context)
  callDown: number;   // additional delta when action = CALL (facing bet)
};

const OPPONENT_CONFIDENCE_MODIFIERS: Record<PlayerType, ConfidenceDelta> = {
  LOOSE_PASSIVE: {
    base:     +0.10,   // most predictable, highest confidence boost
    valueBet: +0.08,   // thin value lines are reliable vs calling stations
    bluff:    -0.25,   // bluffs are reliably bad; reduce confidence in bluff lines
    callDown: +0.05,   // pot odds calls are more reliable (their bet range is value)
  },
  TIGHT_AGGRESSIVE: {
    base:     -0.05,   // they fight back; harder to read
    valueBet: +0.05,   // value bets hold up vs TAGs (they fold marginal hands)
    bluff:    -0.20,   // bluffs are risky; reduce confidence
    callDown: -0.10,   // calling down vs TAG raise is uncertain
  },
  LOOSE_AGGRESSIVE: {
    base:     -0.10,   // highest variance; least certain
    valueBet: +0.03,   // value still holds but they stack off differently
    bluff:    -0.30,   // never bluff LAGs; extreme penalty
    callDown: +0.05,   // call-downs vs LAG bluffs are slightly more reliable
  },
  TIGHT_PASSIVE: {
    base:     +0.08,   // predictable overall
    valueBet: -0.12,   // thin value is bad vs nits (they rarely pay off)
    bluff:    +0.10,   // bluffs on scare cards are reliable vs nits
    callDown: -0.20,   // when nit bets, calling is very risky (their range is near-nut)
  },
  UNKNOWN: {
    base:     -0.10,   // unknown opponent = GTO play only; lower confidence overall
    valueBet:  0.00,
    bluff:    -0.05,
    callDown:  0.00,
  },
};
```

### Unknown opponents and AI fallback

When the villain in the current hand has `inferredType = "UNKNOWN"` AND the base
confidence is below 0.70, route to AI fallback regardless of the overall threshold.
Rationale: against an unknown player, the rule engine's exploit adjustments are a guess.
Claude can infer from the screenshot's visible bet sizes, stack sizes, and prior action.

```typescript
if (villainType === "UNKNOWN" && baseConfidence < 0.70) {
  return null; // force AI path
}
```

---

## 4. Seat-Aware vs. Table-Aware Decisions

### Two-layer model

Both layers should exist simultaneously:

**Table-level (TableTemperature) → persona selection**
Already implemented in `persona-selector.ts`. Chooses the preflop persona and
general playing style for the session. This is a session-level strategic commitment.

**Seat-level (specific villain in this hand) → post-flop adjustments**
The villain in the current hand applies specific exploit adjustments to the local
decision. This is the per-decision tactical layer.

### When to use which layer

| Decision | Use table-level | Use seat-level |
|---|---|---|
| Preflop persona selection | YES | No |
| Preflop RFI sizing (open wider vs tight table) | YES | No |
| Post-flop action vs specific villain | No | YES |
| Confidence modifier | No | YES (use villain's type) |
| Bluff frequency | Indirect (persona) | YES (villain's AF) |
| Value bet sizing | Indirect (persona) | YES (villain's VPIP) |

### Implementation

In `localDecide()`, identify the "primary villain" as:
- In heads-up: the one remaining opponent.
- In multi-way: the last aggressor (the player who bet/raised most recently).
  If no aggressor, use the first active player to act after hero.

```typescript
const primaryVillain = state.opponents.find(
  o => o.seat === state.lastAggressorSeat
) ?? state.opponents[0];

const villainType = primaryVillain?.playerType ?? "UNKNOWN";
const delta = OPPONENT_CONFIDENCE_MODIFIERS[villainType];
```

### Multi-way caution

When 3+ players are active:
- The table-level temperature drives the primary adjustment.
- Do NOT apply aggressive seat-level exploit logic (too many unknowns).
- Apply a flat confidence penalty of `-0.15` per player beyond 2.
- Force AI if 4+ players are active (existing rule — no change needed).

---

## 5. Sample Size: When Is Exploitation Reliable?

The critical question for this system: Claude classifies opponents from ONE screenshot.
How reliable is that single-image read?

### Research consensus on hands needed

| Sample | Reliability |
|---|---|
| 1 hand (screenshot) | Rough signal only; use for direction, not certainty |
| 10–25 hands | Basic read, sufficient for coarse adjustments |
| 30–50 hands | Good read, confident enough for exploit play |
| 100+ hands | Reliable; strong exploitation justified |
| 300+ hands | Very reliable; maximum exploitation |

### This system's constraint

Claude infers type from ONE screenshot. This is equivalent to a 1–3 hand read.
Tournament pros do the same, but with significant uncertainty.

**Practical handling**:

```typescript
// handsObserved comes from PokerSession opponent history
const handsObserved = session.opponents[seat]?.handsObserved ?? 0;

function sampleConfidenceMultiplier(handsObserved: number): number {
  if (handsObserved === 0) return 0.50;  // single screenshot: half confidence in exploit
  if (handsObserved < 5)   return 0.65;  // a few hands: rough signal
  if (handsObserved < 15)  return 0.80;  // moderate signal
  if (handsObserved < 30)  return 0.90;  // good read
  return 1.00;                            // reliable exploitation
}

const exploitStrength = sampleConfidenceMultiplier(handsObserved);
// Scale the delta: appliedDelta = delta.base * exploitStrength
```

### Starting conservative

For the initial implementation, apply exploit adjustments at 50% strength until `handsObserved >= 5`.
This prevents overconfident exploit play on a single-frame read from Claude.

### `buildOpponentContext()` integration

The existing `buildOpponentContext()` in `lib/ai/system-prompt.ts` already tracks
`handsObserved` per seat. This can feed `sampleConfidenceMultiplier()` without any
schema changes.

---

## 6. Anti-Patterns in Exploit Play

### AP-1: Over-bluffing calling stations (most common mistake)

**What happens**: Hero sees a passive player and interprets passivity as weakness.
Decides to bluff repeatedly on scare cards.

**Why it fails**: Loose-passive players have wide CALLING ranges, not wide FOLDING ranges.
Their passivity means they do not RAISE, but they do CALL with anything.

**Rule engine guard**:
```typescript
if (action === "BET" && isBluff && villainType === "LOOSE_PASSIVE") {
  action = "CHECK";
  confidence = 0.85;
  reasoning = "Remove bluffs vs calling station — they call too wide";
}
```

**Severity**: P1. This single error accounts for a huge portion of EV loss against fish.

### AP-2: Under-bluffing nits on non-threatening boards

**What happens**: Hero respects a nit and never bluffs, missing steal opportunities.

**Why it fails**: Nits fold to aggression. On dry, low boards (7-2-rainbow), their
range connects very infrequently. Checking back opportunities is leaving EV on the table.

**Rule engine guard**:
```typescript
if (action === "CHECK" && villainType === "TIGHT_PASSIVE" && isScarecardBoard) {
  action = "BET";
  amount = "40% pot";
  confidence = 0.72;
  reasoning = "Nit folds non-nut hands to pressure on scare boards";
}
```

### AP-3: Folding to LAG c-bets with hands that are good enough to call

**What happens**: Hero faces a c-bet from a LAG on a board that missed hero's range.
Hero folds a pair because the bet looks strong.

**Why it fails**: LAG c-bet frequency is very high — sometimes 80%+. A pair beats most
of their bluffing range. Folding here is massive over-folding.

**Rule engine guard**:
```typescript
if (action === "FOLD" && tier === "medium" && villainType === "LOOSE_AGGRESSIVE") {
  const potOdds = computePotOdds(availableActions, pot);
  if (potOdds !== null && potOdds < 0.32) {
    action = "CALL";
    confidence = 0.68;
    reasoning = "Call wider vs LAG high c-bet frequency — pair is likely best";
  }
}
```

### AP-4: Calling a nit's bet with bluff-catchers

**What happens**: Hero has a medium hand, pot odds look reasonable, hero calls.
But the nit bet range is so narrow that medium hands have minimal equity.

**Why it fails**: Nit's betting range is so value-heavy that hero's equity vs their
range is well below pot-odds threshold, even if pot odds appear positive.

**Rule engine guard**:
```typescript
if (action === "CALL" && villainType === "TIGHT_PASSIVE" && tier === "medium") {
  action = "FOLD";
  confidence = 0.78;
  reasoning = "Nit's betting range is near-value; medium hand has poor equity vs their range";
}
```

### AP-5: Tilt-chasing: adjusting exploit strength after losing hands

Not a code pattern — a design warning. The exploit adjustments should be stateless
and based on observed type only, not on recent results. Do not dynamically inflate
bluff frequencies after a bad beat or shrink them after a cooler.

### AP-6: Applying table-wide exploit to the wrong villain

**What happens**: Table temperature is `loose_passive` so engine always applies
loose_passive exploits. But the specific villain in this hand is a TIGHT_AGGRESSIVE
reg who joined two hands ago.

**Why it fails**: Table temperature reflects the aggregate; individual seats may diverge.

**Resolution**: Per-seat adjustment always overrides table temperature adjustment in
the post-flop decision. Table temperature only drives preflop persona selection.

---

## 7. Implementation Architecture — Post-Processing Step

All exploit adjustments are applied as a POST-PROCESSING step on the base `LocalDecision`.
This is cleanest for the rule engine plan in `2026-02-24-feat-local-poker-decision-engine-plan.md`.

```typescript
// poker-content.ts

interface ExploitContext {
  villainType: PlayerType;
  handsObserved: number;
  isBluffLine: boolean;   // derived from tier (air/weak_draw) + action (BET/RAISE)
  isValueLine: boolean;   // derived from tier (nut/strong/top_pair_gk) + action (BET)
  isCallDown: boolean;    // action === "CALL" facing a bet
}

function applyExploitAdjustments(
  base: LocalDecision,
  ctx: ExploitContext,
): LocalDecision {
  const mod = OPPONENT_CONFIDENCE_MODIFIERS[ctx.villainType];
  const strength = sampleConfidenceMultiplier(ctx.handsObserved);

  let { action, amount, confidence, reasoning } = base;

  // Bluff suppression
  if (ctx.isBluffLine) {
    confidence += mod.bluff * strength;
    if (confidence < 0.40 && action === "BET") {
      action = "CHECK";
      confidence = Math.max(confidence + 0.20, 0.55);
      reasoning += ` [Exploit: bluff removed vs ${ctx.villainType}]`;
    }
  }

  // Value sizing boost for LOOSE_PASSIVE
  if (ctx.villainType === "LOOSE_PASSIVE" && ctx.isValueLine && amount) {
    amount = scaleBetSize(amount, 1.30);  // +30% sizing
    reasoning += " [Exploit: size up vs calling station]";
  }

  // Call-down adjustment
  if (ctx.isCallDown) {
    confidence += mod.callDown * strength;
    // Tight passive bet = near-nut: force fold on medium hands
    if (ctx.villainType === "TIGHT_PASSIVE" && base.action === "CALL") {
      action = "FOLD";
      confidence = 0.78;
      reasoning += " [Exploit: nit bet range is near-value]";
    }
    // LAG c-bet: widen call range
    if (ctx.villainType === "LOOSE_AGGRESSIVE" && confidence < 0.60) {
      confidence += 0.10; // boost call confidence vs LAG
      reasoning += " [Exploit: call wider vs LAG high-freq c-bet]";
    }
  }

  // Base confidence modifier
  confidence += mod.base * strength;

  // Clamp to [0.0, 1.0]
  confidence = Math.min(1.0, Math.max(0.0, confidence));

  return { action, amount, confidence, reasoning };
}
```

### Where it fits in `localDecide()`

```typescript
function localDecide(state: GameState): LocalDecision | null {
  // ... existing Phase 4 logic ...
  const base = applyRuleTree(tier, texture, spr, potOdds, position, street, activePlayers);

  // Phase 5 (opponent exploit layer):
  const villain = state.opponents.find(o => o.seat === state.lastAggressorSeat)
    ?? state.opponents[0];
  const ctx: ExploitContext = {
    villainType: villain?.playerType ?? "UNKNOWN",
    handsObserved: session.opponents[villain?.seat]?.handsObserved ?? 0,
    isBluffLine: isBluffLine(base.action, tier),
    isValueLine: isValueLine(base.action, tier),
    isCallDown: base.action === "CALL",
  };

  return applyExploitAdjustments(base, ctx);
}
```

---

## 8. Decision: Seat-Level Type Source

The opponent type for exploit adjustments should come from:
1. `PokerSession.opponents[seat].inferredType` — the accumulated session read.
2. Fall back to the current hand's `state.opponents[seat].playerType` from Claude's output.
3. Fall back to "UNKNOWN" if neither exists.

This allows the session read (multiple hands) to override the single-hand screenshot read
when available, improving reliability as the session progresses.

---

## Summary Table: Concrete Post-Processing Rules

| Villain type | Base confidence delta | Bluff delta | Value sizing | Call-down delta | Override |
|---|---|---|---|---|---|
| LOOSE_PASSIVE | +0.10 | -0.25 (remove bluff) | ×1.30 | +0.05 | Remove pure bluffs entirely |
| TIGHT_AGGRESSIVE | -0.05 | -0.20 | ×1.00 | -0.10 | Fold medium hands to raise |
| LOOSE_AGGRESSIVE | -0.10 | -0.30 (remove bluff) | ×1.00 | +0.05 | Call wider with made hands |
| TIGHT_PASSIVE | +0.08 | +0.10 (scare cards only) | ×0.85 | -0.20 | Fold medium hands to any bet |
| UNKNOWN | -0.10 | -0.05 | ×1.00 | ±0.00 | Force AI if confidence < 0.70 |

All deltas scaled by `sampleConfidenceMultiplier(handsObserved)` (0.50 at 0 hands → 1.00 at 30+ hands).

---

## References

- Internal: `lib/poker/table-temperature.ts` — `TableTemperature` type
- Internal: `lib/ai/schema.ts` — `PLAYER_TYPES`, `PlayerType`
- Internal: `lib/ai/system-prompt.ts` — `buildOpponentContext()`, `handsObserved`
- Internal: `docs/plans/2026-02-24-feat-local-poker-decision-engine-plan.md`
- External: [PokerCoaching: VPIP Stat](https://pokercoaching.com/blog/vpip-poker-stat/)
- External: [Upswing Poker: Calling Stations](https://upswingpoker.com/calling-stations-poker-strategy/)
- External: [888Poker: TAG Opponents](https://www.888poker.com/magazine/strategy/tight-aggressive-poker)
- External: [SmartPokerStudy: HUD Reliability & Sample Sizes](https://smartpokerstudy.com/hud-reliability-number-of-hands-and-sample-sizes-226/)
- External: [Red Chip Poker: Exploits Playbook](https://redchippoker.com/poker-exploits-playbook/)
- External: [PokerCode: LAG Players](https://www.pokercode.com/blog/loose-aggressive-poker)
- External: [GTO Wizard: Five Imbalances of Exploitative Poker](https://blog.gtowizard.com/the-five-imbalances-of-exploitative-poker/)
