# GTO Post-Flop Rule Engine Reference
**Date:** 2026-02-24
**Sources:** GTO Wizard blog (aggregate solver reports), SplitSuit Poker, Upswing Poker, RunItOnce, 888poker, PokerVIP

This document encodes GTO post-flop principles as concrete decision rules suitable for a TypeScript rule-based engine. All frequencies are derived from PioSolver/GTO Wizard aggregate reports for 100bb 6-max NLHE unless noted. Micro-stakes exploitative adjustments are noted separately.

---

## 1. Board Texture Classification

### Wetness Score (0–4)

Assign a wetness score based on the flop's connectedness and suitedness. This drives c-bet frequency and sizing decisions downstream.

```typescript
type BoardTexture = {
  paired: boolean;          // any two cards share rank
  monotone: boolean;        // all three cards same suit
  twoTone: boolean;         // exactly two cards same suit
  rainbow: boolean;         // all different suits
  highCardRank: number;     // highest card rank (2=2, 14=Ace)
  connected: boolean;       // possible straight on board (gap <= 4 between any two cards)
  semiConnected: boolean;   // gap <= 2 between at least two cards
  wetScore: number;         // 0 = bone dry, 4 = very wet
}

function classifyBoard(cards: [Card, Card, Card]): BoardTexture {
  // wetScore calculation:
  // +0 rainbow/paired: very dry
  // +1 two-tone disconnected
  // +2 two-tone semi-connected (e.g. K87, T75)
  // +3 two-tone connected (e.g. 876, 987)
  // +2 monotone (paradoxically smaller sizing, see section 6)
}
```

### Board Texture Examples

| Board       | Texture           | wetScore | C-Bet Sizing |
|-------------|-------------------|----------|--------------|
| K♥7♦2♣      | Rainbow dry       | 0        | 33% pot      |
| A♠7♥2♦      | Rainbow dry       | 0        | 33% pot      |
| K♥9♦8♣      | Rainbow connected | 2        | 50-66% pot   |
| K♣Q♦8♦      | Two-tone semi     | 2        | 50-66% pot   |
| 8♦7♦6♣      | Connected two-tone| 3        | 66-75% pot   |
| Q♦8♦7♦      | Monotone          | 2        | 33% pot      |
| 7♥7♦2♣      | Paired dry        | 0        | 25-33% pot   |
| T♥T♦3♣      | Paired high       | 0        | 25-33% pot   |

---

## 2. C-Bet Frequency by Position and Board Texture

### IP C-Bet (In Position, e.g. BTN vs BB, CO vs BTN)

Source: GTO Wizard aggregate reports (PioSolver, cash game 100bb)

```typescript
function ipCBetFrequency(texture: BoardTexture): number {
  // Returns frequency as 0.0-1.0

  if (texture.paired) {
    // Paired boards: bet VERY frequently but small
    // Higher pair card = higher frequency
    if (texture.highCardRank >= 10) return 0.82; // TT/JJ/QQ/KK/AA-type paired board
    if (texture.highCardRank >= 7)  return 0.72;
    return 0.65;
  }

  if (texture.monotone) {
    // Monotone drastically reduces betting frequency
    // Flush in opponent's range neutralizes your range advantage
    return 0.45; // ~50% frequency, heavily mixed strategy
  }

  if (texture.wetScore >= 3) {
    // Highly connected boards (876, 987, TJ8)
    // IP still has range advantage but must use it selectively
    return 0.55;
  }

  if (texture.wetScore >= 2) {
    // Semi-connected or two-tone (K87, T75 two-tone)
    return 0.65;
  }

  // Dry rainbow disconnected: highest frequency
  // "Disconnected boards are hardest for either player to connect with,
  //  preserving IP's preflop advantage" — GTO Wizard
  return 0.80;
}
```

### OOP C-Bet (Out of Position, e.g. SB/BB vs BTN, EP vs CO/BTN)

Key insight: OOP average c-bet frequency is ~35% vs IP's ~80%.
Checking OOP keeps pot small and avoids being raised off equity.

Source: GTO Wizard blog "C-Betting As the OOP Preflop Raiser"
- UTG vs BTN: c-bets only 32.5% of flops
- CO vs BTN: c-bets only ~35% of flops
- SB vs BB (blind vs blind): c-bets ~40% (more range advantage)

```typescript
function oopCBetFrequency(
  texture: BoardTexture,
  heroPosition: 'SB' | 'EP' | 'MP' | 'CO',
  villainPosition: 'BB' | 'BTN'
): number {
  const baseFreq = heroPosition === 'SB' ? 0.40 : 0.33;

  // Dry boards: slightly higher (more range advantage maintained)
  if (!texture.paired && !texture.connected && texture.rainbow) {
    return Math.min(baseFreq + 0.10, 0.55);
  }

  // Connected/wet boards: lower (more dangerous, IP can check-raise)
  if (texture.wetScore >= 2) {
    return Math.max(baseFreq - 0.10, 0.20);
  }

  // Paired boards: slightly higher (range advantage, hard to make draws)
  if (texture.paired) {
    return baseFreq + 0.08;
  }

  return baseFreq;
}
```

---

## 3. C-Bet Sizing Rules

### The Wetness Parabola (GTO Wizard / GTO+ aggregate studies)

```
Dry board    → Small sizing (25–33% pot)
Semi-wet     → Medium sizing (50% pot)
Wet board    → Large sizing (66–75% pot)
Very wet / monotone → Back to small (33% pot)
```

This is the "wetness parabola" — sizing goes up then comes back down on the most connected boards.

```typescript
function cBetSizing(texture: BoardTexture, position: 'IP' | 'OOP'): number {
  // Returns bet as fraction of pot (e.g. 0.33 = 33% pot)

  if (texture.monotone) {
    // Monotone: drastically reduce. Opponent's flush range nullifies nut advantage.
    // Source: GTO Wizard "The Mechanics of C-Bet Sizing"
    return 0.33;
  }

  if (texture.paired) {
    // Paired boards: small sizing effective. Draws rare = hard to continue facing small bet.
    // Source: GTO Wizard "Flop Heuristics IP C-Betting in Cash Games"
    return 0.33;
  }

  if (texture.wetScore >= 3) {
    // Highly connected (876, 987): large sizing for protection/polarization
    // "Connected boards lean towards larger bet" — GTO Wizard
    return position === 'IP' ? 0.75 : 0.66;
  }

  if (texture.wetScore >= 2) {
    // Semi-connected or two-tone: medium
    return 0.50;
  }

  // Dry rainbow: small (25–33%)
  // "Bet small on a dry board" — Wetness Parabola heuristic
  return 0.33;
}
```

### OOP Sizing Note
OOP prefers smaller sizes (20–33%) with a bias toward pot-control. On very dry boards, OOP can occasionally use 50% to deny equity. Overbets are almost exclusively an IP tool.

---

## 4. Double Barrel (Turn C-Bet) Frequency

### General Turn Betting Framework

After a flop c-bet is called:
- The turn c-bet range should be **polarized** (strong made hands + selected bluffs)
- **Blank turns** (cards that don't change board texture) → higher barreling frequency (~55-65% of flop c-bet range)
- **Scare cards** for villain (completing draws, pairing board) → lower barreling frequency
- **Board-improving cards for hero** (giving hero a strong hand or nut advantage) → higher frequency

```typescript
type TurnCard = {
  rank: number;
  suit: Suit;
  completesFlushDraw: boolean;   // 4th card of same suit as flop two-tone
  completesOpenEndedDraw: boolean; // connects to make straight possible
  pairsBoard: boolean;            // pairs a flop card
  isOvercard: boolean;            // higher rank than all flop cards
}

function doubleBàrrelFrequency(
  texture: BoardTexture,
  turnCard: TurnCard,
  position: 'IP' | 'OOP'
): number {
  // Base frequency: 55% IP, 40% OOP
  let freq = position === 'IP' ? 0.55 : 0.40;

  // Turn completes draws villain was calling with → bad barrel card, reduce
  if (turnCard.completesFlushDraw || turnCard.completesOpenEndedDraw) {
    freq -= 0.20;
  }

  // Blank turn (low card that changes nothing) → maintain pressure
  if (!turnCard.completesFlushDraw && !turnCard.completesOpenEndedDraw && !turnCard.pairsBoard) {
    freq += 0.10;
  }

  // Overcard that hits hero's range more than villain's → increase
  if (turnCard.isOvercard && !turnCard.completesFlushDraw) {
    freq += 0.05;
  }

  return Math.max(0.15, Math.min(0.75, freq));
}
```

### Turn Sizing
Source: GTOBase 6-max cash library (100bb, PioSolver)
- Turn bets: primarily **25% pot and 50% pot** sizing
- Blank turns on dry boards: 33–50% pot
- Connected boards / polarized range: 50–66% pot
- River approach: geometric sizing (bet amounts that put villain at same equity threshold each street)

---

## 5. Check-Raise Frequency (OOP Defender)

Check-raise is a critical OOP defensive tool. It achieves two goals: building pots with strong hands and balancing the check-raise range with semi-bluffs (strong draws).

### When to Check-Raise OOP

```typescript
function shouldCheckRaiseOOP(
  handStrength: HandStrength,
  texture: BoardTexture,
  opponentBetSize: number, // as fraction of pot
  potOdds: number
): 'checkRaise' | 'call' | 'fold' {

  // Strong value hands: check-raise for value and protection
  if (handStrength.twoPlus) { // two pair, set, straight, flush
    if (texture.wetScore >= 2) return 'checkRaise'; // protection needed on wet boards
    if (texture.wetScore < 2) return 'call';         // dry board, trap IP
  }

  // Strong draws (12+ outs: combo draw): check-raise as semi-bluff
  // Combo draws (pair + OESD = 13 outs, flush draw + pair = 11 outs)
  // have enough equity to check-raise profitably
  if (handStrength.outs >= 12) {
    return 'checkRaise';
  }

  // Medium draws (8-9 outs: flush draw, OESD): call if pot odds are right
  if (handStrength.outs >= 8) {
    if (potOdds <= 0.35) return 'call'; // getting at least 35% pot odds (bet <= 54% pot)
    return 'fold';
  }

  // Paired boards specifically: OOP check-raises MORE than average
  // "BB check-raises significantly on paired flops" — GTO Wizard
  if (texture.paired && handStrength.tripsOrFull) {
    return 'checkRaise';
  }

  return 'call'; // default: call with marginal hands
}
```

### Check-Raise Sizing
- Flop check-raise: typically 2.5x to 3x the bet (e.g. opponent bets 33% pot → check-raise to ~75-90% pot)
- Check-raise too small (2x) is generally not GTO — gives opponent easy continue
- Check-raise sizing should make opponent roughly indifferent to continuing

---

## 6. SPR-Based Commitment Thresholds

Source: SplitSuit, GTO Wizard glossary, PokerVIP, 888poker

SPR = effective_stack / pot_at_start_of_street

### Stack-Off Decision Tree

```typescript
function shouldStackOff(
  handStrength: HandStrengthCategory,
  spr: number,
  texture: BoardTexture,
  isMicroStakes: boolean
): 'stackOff' | 'callDown' | 'potControl' | 'fold' {

  // SPR < 3: almost always commit (mistakes are cheap, pot is relative to stack)
  if (spr < 3) {
    if (handStrength >= HandStrengthCategory.TOP_PAIR_GOOD_KICKER) return 'stackOff';
    if (handStrength >= HandStrengthCategory.MIDDLE_PAIR_GOOD_KICKER) return 'callDown';
    return 'fold';
  }

  // SPR 3-6: decision zone, depends on hand strength and board texture
  if (spr < 6) {
    if (handStrength >= HandStrengthCategory.TWO_PAIR) return 'stackOff';
    if (handStrength >= HandStrengthCategory.TOP_PAIR_GOOD_KICKER) {
      // TPTK: stack off on dry static boards, pot-control on wet dynamic boards
      return texture.wetScore <= 1 ? 'callDown' : 'potControl';
    }
    return 'potControl';
  }

  // SPR 6-10: need strong hands
  if (spr < 10) {
    if (handStrength >= HandStrengthCategory.SET) return 'stackOff';
    if (handStrength >= HandStrengthCategory.TWO_PAIR) {
      return texture.wetScore >= 2 ? 'stackOff' : 'callDown';
    }
    if (handStrength >= HandStrengthCategory.TOP_PAIR_TOP_KICKER) return 'potControl';
    return 'fold'; // facing heavy action
  }

  // SPR 10+: only straights, flushes, sets, and premium two pairs
  if (handStrength >= HandStrengthCategory.STRAIGHT_OR_BETTER) return 'stackOff';
  if (handStrength >= HandStrengthCategory.SET && !texture.paired) return 'stackOff';
  if (handStrength >= HandStrengthCategory.TOP_PAIR_TOP_KICKER) return 'potControl';
  return 'fold';
}

// SPR Quick Reference Table (GTO consensus):
// Hand          | SPR < 3     | SPR 3-6     | SPR 6-10    | SPR 10+
// TPTK (AK/AQ)  | stack off   | call down   | pot control | pot control
// Top pair wk.k | call down   | pot control | fold        | fold
// Two pair      | stack off   | stack off   | call down   | pot control
// Set           | stack off   | stack off   | stack off   | stack off
// Flush draw    | call (35%eq)| call        | call        | call (pot odds)
// OESD (8 out)  | call        | call        | fold (no implied odds) | fold
```

---

## 7. Bluffing Frequency by Bet Sizing (River)

Source: SplitSuit, GTO Wizard, RunItOnce — derived from alpha (bluff break-even formula)

The GTO river bluff frequency equals the pot odds percentage you give your opponent.
**Bluff % = Bet / (Pot + Bet + Bet) = Bet / (Pot + 2*Bet)**

```typescript
function riverBluffFrequency(betSizeAsFractionOfPot: number): number {
  // The aggressor's bluff % equals opponent's pot odds %
  // pot odds % = bet / (pot + bet) for the caller
  // For a balanced range, aggressor should bluff at that rate

  const bet = betSizeAsFractionOfPot;
  return bet / (1 + bet); // This gives the bluff fraction of the betting range
}

// Pre-computed reference:
// Bet 1/3 pot (0.33x): bluff 25% of betting range, value 75%
// Bet 1/2 pot (0.50x): bluff 33% of betting range, value 67%
// Bet 2/3 pot (0.67x): bluff 40% of betting range, value 60%
// Bet pot    (1.00x): bluff 50% of betting range, value 50%

// Practical simplification for rule engine:
const RIVER_BLUFF_RATE: Record<string, number> = {
  'third_pot':   0.25, // bet 33% pot  → 25% bluffs in range
  'half_pot':    0.33, // bet 50% pot  → 33% bluffs in range
  'two_thirds':  0.40, // bet 67% pot  → 40% bluffs in range
  'pot':         0.50, // bet 100% pot → 50% bluffs in range
};

// Multi-street build-up heuristic (RunItOnce, GTO simplified):
// Flop:  1/3 value needed in range  (can bluff 2/3 of betting range)
// Turn:  1/2 value needed in range  (can bluff 1/2 of betting range)
// River: 2/3 value needed in range  (can bluff only 1/3 of betting range at 50% pot)
```

### River Bluff Candidate Selection
- Best bluff candidates: missed draws that have **blocker effects** to villain's strong hands
- Never bluff into a calling station (micro-stakes exploitative adjustment: bluff ~10-15% at NL2/NL5)
- OOP river bluff frequency should be lower (~15-20% less than IP) because IP can check back for free showdown

---

## 8. Pot Odds and Draw Decision Rules

### The 2x and 4x Rules (Approximation)

```typescript
// Rule of 2 (one card to come): outs * 2 ≈ equity %
// Rule of 4 (two cards to come): outs * 4 ≈ equity %

function drawEquity(outs: number, cardsTocome: 1 | 2): number {
  return outs * (cardsTocome === 1 ? 2 : 4); // percentage
}

// Common draw equities:
// Flush draw (9 outs):  18% on turn, 36% on flop (two cards)
// OESD (8 outs):       16% on turn, 32% on flop
// Gutshot (4 outs):    8% on turn,  16% on flop
// Combo draw (13+ outs): 26%+ on turn, 52%+ on flop (often favorite!)
```

### Call/Fold Decision vs C-Bet

```typescript
function facingBetDecision(
  potOddsPercent: number,  // call / (pot + call) as %
  drawOuts: number,
  isOnFlop: boolean,
  hasPosition: boolean,
  impliedOddsMultiplier: number // 1.0 = no implied odds, 1.5 = good implied odds
): 'call' | 'raise' | 'fold' {

  const rawEquity = drawOuts * (isOnFlop ? 4 : 2);
  const adjustedEquity = rawEquity * impliedOddsMultiplier;

  // Pure draw decision:
  if (adjustedEquity >= potOddsPercent) return 'call';

  // Combo draw (12+ outs): consider check-raise instead of call
  if (drawOuts >= 12 && !hasPosition) return 'raise';

  return 'fold';
}

// Practical call thresholds vs common bet sizes:
// Facing 33% pot bet: need 20% equity to call  (pot odds: 1/(1+3) = 25% → 20% pot odds)
//   → 5-outs+ on flop (rule of 4: 5*4=20%)
//   → 10-outs+ on turn (rule of 2: 10*2=20%)
// Facing 50% pot bet: need 25% equity to call
//   → 7-outs+ on flop (7*4=28%)
//   → 13-outs+ on turn (13*2=26%)
// Facing 75% pot bet: need 30% equity to call
//   → 8-outs+ on flop (8*4=32%)
//   → flush draw minimum on turn
// Facing pot bet:     need 33% equity to call
//   → 9-outs+ on flop (9*4=36%)
//   → only combo draws on turn

// KEY POT ODDS TABLE:
const POT_ODDS_THRESHOLD: Record<string, number> = {
  'third_pot':   20, // need 20% equity
  'half_pot':    25, // need 25% equity
  'two_thirds':  29, // need 29% equity
  'pot':         33, // need 33% equity
};
```

### Made Hand vs Draw Decisions

```typescript
// When to call with MADE HAND facing a raise:
// Facing a raise, made hands need to assess if they're ahead vs villain's raising range
//
// Top pair top kicker vs flop check-raise (wet board):
//   → call if SPR < 6
//   → fold/pot-control if SPR >= 6 (villain's check-raise range heavily weighted to two pair+)
//
// Top pair weak kicker vs any aggression (wet board):
//   → fold if SPR >= 4 (villain's value range dominates)
//   → call if SPR < 3 (committed, pot-control line)
```

---

## 9. Equity vs Equity Realization

Why strong draws often beat weak made hands in EV:

```typescript
// THEORETICAL: Strong draw (flush draw, 9 outs) vs weak top pair (TP weak kicker)
//
// Flush draw has:
//   - 35% raw equity on flop (9*4 ≈ 36%)
//   - HIGH equity realization: flush draws either complete or miss — clear decision tree
//   - Fold equity: can semi-bluff raise and take pot immediately
//   - Implied odds: when flush completes, can extract large bets
//
// Weak top pair has:
//   - ~65% raw equity vs flush draw
//   - LOW equity realization:
//     * Must call bets on multiple streets
//     * Faces difficult decisions when draws complete
//     * Cannot bluff rivers credibly
//     * Gets check-raised off equity frequently
//
// EV Result: On a two-tone board, weak TPWK often has LOWER EV than a flush draw
// due to the equity realization gap. This is why solvers prefer to:
//   - Check back weak made hands OOP (protect equity, avoid tough spots)
//   - Bet draws aggressively (fold equity + implied odds)

// Rule for engine:
function handEVCategory(hand: HandAnalysis, board: BoardTexture): 'high_ev' | 'medium_ev' | 'low_ev' {
  if (hand.outs >= 12) return 'high_ev';       // combo draw: often favorite
  if (hand.outs >= 8 && board.wetScore >= 2) return 'medium_ev'; // flush/OESD on wet board
  if (hand.strength === 'TOP_PAIR_TOP_KICKER') return 'medium_ev';
  if (hand.strength === 'TOP_PAIR_WEAK_KICKER' && board.wetScore >= 2) return 'low_ev';
  if (hand.strength === 'MIDDLE_PAIR') return 'low_ev';
  return 'medium_ev';
}
```

---

## 10. IP vs OOP Comprehensive Summary

### Flop Strategy Summary Table

| Scenario          | C-Bet Freq | Sizing    | Double Barrel | Notes |
|-------------------|-----------|-----------|---------------|-------|
| IP dry rainbow    | 80%       | 33% pot   | 60%           | High freq, small size, protect with occasional check |
| IP semi-connected | 65%       | 50% pot   | 50%           | Balanced approach |
| IP wet connected  | 55%       | 66-75% pot| 40-50%        | Selective, polarized |
| IP monotone       | 45%       | 33% pot   | 35%           | Mixed strategy, small bets |
| IP paired high    | 82%       | 33% pot   | 55%           | Very high freq, very small |
| OOP vs BTN dry    | 40%       | 33% pot   | 30%           | Much tighter, small pots |
| OOP vs BTN wet    | 22%       | 33% pot   | 20%           | Mostly check, check-raise traps |
| OOP BB vs BTN     | 35%       | 33% pot   | 25%           | Check-raise is primary weapon |

### Position Adjustments
- **IP advantage**: realize equity better, can bet/check with any hand for free river card
- **OOP penalty**: every check gives IP a free card; every bet risks a raise
- **Check-raise as OOP compensation**: the primary tool for OOP to apply pressure
- **OOP bet sizing**: smaller bets OOP (33% pot) to keep ranges wide and pot manageable

---

## 11. Micro-Stakes Exploitative Adjustments (NL2/NL5 €0.01/€0.02)

GTO provides the baseline; these exploitative adjustments maximize winrate vs typical micro-stakes opponents.

```typescript
// Micro-stakes player profile:
// - Call too much (VPIP 30-45%, limp-call preflop)
// - Fold too much to turn/river bets (once they miss draws)
// - Don't check-raise enough
// - Over-value weak made hands

// Adjustments:
const MICRO_STAKES_ADJUSTMENTS = {
  // 1. Value bet thinner and more frequently
  valueBetFrequencyBonus: +0.15,  // bet 15% more often with value hands

  // 2. Bluff LESS (calling stations don't fold)
  riverBluffFrequencyPenalty: -0.50, // bluff only half as often as GTO suggests

  // 3. C-bet more with strong hands (they'll call)
  strongHandCBetBonus: +0.10,

  // 4. Don't bluff missed draws vs stations
  // If opponent VPIP > 40%, set bluffFrequency to 0 on river

  // 5. Size up with value on wet boards (they call with draws and pairs)
  wetBoardValueSizingBonus: +0.15, // 66% → 75-80% pot

  // 6. C-bet turn more with made hands (they call with worse)
  turnCBetWithMadeHandBonus: +0.10,
};
```

---

## 12. Minimum Defense Frequency (MDF)

The defender must call at least MDF% of their range to prevent pure bluffing profitability.

```typescript
function minimumDefenseFrequency(betSizeAsFractionOfPot: number): number {
  // MDF = Pot / (Pot + Bet)
  const pot = 1;
  const bet = betSizeAsFractionOfPot;
  return pot / (pot + bet);
}

// MDF Quick Reference:
// Facing 33% pot bet: must defend 75% of range
// Facing 50% pot bet: must defend 67% of range
// Facing 75% pot bet: must defend 57% of range
// Facing pot bet:     must defend 50% of range
// Facing 2x pot bet:  must defend 33% of range

// Practical implication: when c-bet frequency is 80% on dry board with 33% bet,
// BB must call with top 75% of their continuing range — most pairs and draws qualify
```

---

## Summary: TypeScript Decision Constants

```typescript
// C-BET FREQUENCIES (IP, 100bb 6-max, GTO baseline)
export const CBET_FREQ_IP = {
  DRY_RAINBOW:     0.80,
  SEMI_CONNECTED:  0.65,
  WET_CONNECTED:   0.55,
  MONOTONE:        0.45,
  PAIRED_HIGH:     0.82,
  PAIRED_LOW:      0.65,
} as const;

// C-BET FREQUENCIES (OOP, GTO baseline)
export const CBET_FREQ_OOP = {
  DRY_RAINBOW:     0.40,
  SEMI_CONNECTED:  0.28,
  WET_CONNECTED:   0.22,
  MONOTONE:        0.35,
  PAIRED_HIGH:     0.42,
} as const;

// BET SIZING (as fraction of pot)
export const CBET_SIZE = {
  DRY_RAINBOW:     0.33,
  SEMI_CONNECTED:  0.50,
  WET_CONNECTED:   0.66,
  MONOTONE:        0.33,
  PAIRED:          0.33,
} as const;

// RIVER BLUFF RATE (fraction of betting range)
export const RIVER_BLUFF_RATE = {
  THIRD_POT: 0.25,
  HALF_POT:  0.33,
  TWO_THIRDS:0.40,
  POT:       0.50,
} as const;

// SPR COMMITMENT THRESHOLDS
export const SPR_STACK_OFF = {
  TOP_PAIR_GOOD_KICKER:  { auto: 3, situational: 6,  fold_above: 10 },
  TOP_PAIR_TOP_KICKER:   { auto: 3, situational: 6,  fold_above: 12 },
  TWO_PAIR:              { auto: 6, situational: 10, fold_above: 16 },
  SET:                   { auto: 10, situational: 20, fold_above: 30 },
  FLUSH_DRAW:            { call_if_pot_odds_met: true }, // always pot-odds based
  OESD:                  { call_if_pot_odds_met: true },
} as const;

// POT ODDS REQUIRED (to call)
export const CALL_EQUITY_THRESHOLD = {
  THIRD_POT:  0.20,
  HALF_POT:   0.25,
  TWO_THIRDS: 0.29,
  POT:        0.33,
} as const;

// DRAW OUTS FOR CATEGORIES
export const DRAW_OUTS = {
  FLUSH_DRAW:          9,
  OESD:                8,
  GUTSHOT:             4,
  COMBO_FLUSH_PAIR:    11, // flush draw + pair (or fd + gutshot)
  COMBO_OESD_PAIR:     13, // OESD + pair
  COMBO_FLUSH_OESD:    15, // flush draw + OESD (massive semi-bluff)
} as const;
```

---

## Sources

- [GTO Wizard - Flop Heuristics: IP C-Betting in Cash Games](https://blog.gtowizard.com/flop-heuristics-ip-c-betting-in-cash-games/)
- [GTO Wizard - The Mechanics of C-Bet Sizing](https://blog.gtowizard.com/the-mechanics-of-c-bet-sizing/)
- [GTO Wizard - C-Betting As the OOP Preflop Raiser](https://blog.gtowizard.com/c-betting-as-the-oop-preflop-raiser/)
- [GTO Wizard - Stack-to-Pot Ratio](https://blog.gtowizard.com/stack-to-pot-ratio/)
- [GTO Wizard - Equity Realization](https://blog.gtowizard.com/equity-realization/)
- [GTO Wizard - The Math of Multi-Street Bluffs](https://blog.gtowizard.com/the-math-of-multistreet-bluffs/)
- [SplitSuit Poker - Perfect GTO Bluffing](https://www.splitsuit.com/perfect-gto-bluffing)
- [SplitSuit Poker - SPR Strategy](https://www.splitsuit.com/spr-poker-strategy)
- [Upswing Poker - GTO C-Bet Quiz Answers](https://upswingpoker.com/gto-c-bet-quiz-answers/)
- [PokerVIP - Stack-to-Pot Ratios](https://www.pokervip.com/strategy-articles/texas-hold-em-no-limit-advanced/stack-to-pot-ratios)
- [888poker - Board Textures](https://www.888poker.com/magazine/poker-board-textures)
- [GTO Wizard - Pot Geometry](https://blog.gtowizard.com/pot-geometry/)
- [GTO Wizard - Check-Raising a Single Pair](https://blog.gtowizard.com/check-raising-a-single-pair/)
- [GTOBase - 6-max Cash Library Overview](https://blog.gtobase.com/theory/overview-of-the-new-gto-poker-solutions-in-the-6-max-cash-library/)
- [RunItOnce - GTO Simplified](https://www.runitonce.com/chatter/gto-simplified/)
- [PokerCoaching - 6-Max GTO Cash Game Adjustments](https://pokercoaching.com/blog/6-max-gto-cash-game-adjustments/)
