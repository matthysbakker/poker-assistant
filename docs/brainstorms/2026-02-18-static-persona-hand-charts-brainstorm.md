# Static Persona Hand Charts

**Date:** 2026-02-18
**Status:** Brainstorm complete

## What We're Building

A set of **static preflop hand charts** tied to 4 fictive poker personas, integrated into the existing analysis results. When the AI analyzes a preflop screenshot, the app also shows what each persona would do with those cards in that position — giving the user instant strategic context without additional API calls.

## Why This Approach

- **No runtime cost**: Charts are static data, no AI calls needed for persona comparisons
- **Educational value**: Users learn how different player types think about the same hand
- **Complements existing analysis**: The AI gives a situational recommendation; personas give archetype-based baselines
- **Aligns with existing model**: The app already classifies opponents into these 4 types

## Key Decisions

### 4 Personas (mapped to existing opponent types)

| Persona | Style | Existing Type | Tagline |
|---------|-------|---------------|---------|
| **Steady Sal** | Tight-Passive (Nit) | `TIGHT_PASSIVE` | Only plays the nuts, folds everything else |
| **Sharp Eddie** | Tight-Aggressive (TAG) | `TIGHT_AGGRESSIVE` | Selective but strikes hard |
| **Wild Maya** | Loose-Aggressive (LAG) | `LOOSE_AGGRESSIVE` | Wide ranges, relentless pressure |
| **Curious Carl** | Loose-Passive (Calling Station) | `LOOSE_PASSIVE` | Can't resist seeing a flop |

### Position-Aware Charts

Each persona has a different chart per position:
- **UTG** (Under the Gun) — tightest ranges
- **MP** (Middle Position)
- **CO** (Cutoff)
- **BTN** (Button) — widest ranges
- **SB** (Small Blind)
- **BB** (Big Blind) — special: defending vs raises

Total: **4 personas x 6 positions = 24 charts**

### 3 Actions Per Hand

Each cell maps to: **Raise**, **Call**, or **Fold**

### Hand Chart Format

The standard 13x13 matrix (169 unique hands):
- Diagonal: pocket pairs (AA → 22)
- Above diagonal: suited hands
- Below diagonal: offsuit hands

### Data Source: Hand-Curated from Poker Theory

Built from established sources:
- **Sklansky-Malmuth hand groups** (tiers 1-8) as the baseline
- **Standard opening ranges** adjusted by position
- **VPIP targets** per persona type:
  - Nit: ~10-12% overall
  - TAG: ~18-22% overall
  - LAG: ~28-35% overall
  - Calling Station: ~40-55% overall

### Integration Point

- Triggered when `street === "PREFLOP"` in analysis results
- Looks up `heroCards` + position to find each persona's action
- Displayed as a compact comparison widget below the main analysis
- Not shown for postflop streets (charts are preflop only)

## Data Structure

```typescript
type Action = "RAISE" | "CALL" | "FOLD";
type Position = "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB";

interface Persona {
  id: string;
  name: string;
  tagline: string;
  style: "TIGHT_PASSIVE" | "TIGHT_AGGRESSIVE" | "LOOSE_AGGRESSIVE" | "LOOSE_PASSIVE";
  charts: Record<Position, Record<string, Action>>; // hand key → action
}

// Hand keys: "AA", "AKs", "AKo", "AQs", ... "32o", "22"
// 169 keys per position chart
```

## Scope

- **4,056 data points** to curate (169 hands x 6 positions x 4 personas)
- Manageable because ranges follow patterns — e.g., "all pairs 77+ = RAISE" covers many cells
- One-time effort, then static forever

## Range Guidelines by Persona & Position

### Steady Sal (Nit) — ~10% overall VPIP
- UTG: ~7% (Group 1-2: AA-TT, AKs, AQs, AKo)
- MP: ~9%
- CO: ~12%
- BTN: ~15%
- SB: ~10% (tight, doesn't complete much)
- BB: ~12% (defends only premiums)

### Sharp Eddie (TAG) — ~20% overall VPIP
- UTG: ~13% (Groups 1-4)
- MP: ~17%
- CO: ~22%
- BTN: ~28%
- SB: ~18%
- BB: ~22% (defends wider)

### Wild Maya (LAG) — ~30% overall VPIP
- UTG: ~18% (Groups 1-5)
- MP: ~25%
- CO: ~33%
- BTN: ~42%
- SB: ~30%
- BB: ~38%

### Curious Carl (Calling Station) — ~45% overall VPIP
- UTG: ~30% (any ace, any pair, suited broadways)
- MP: ~38%
- CO: ~48%
- BTN: ~55%
- SB: ~45%
- BB: ~60% (calls almost everything)
- **Key difference**: Mostly CALLs instead of RAISEs (large VPIP-PFR gap)

## Open Questions

- Should we show persona recommendations for **facing a raise** (calling range) or only for **opening** (RFI range)?
  - Starting with opening/RFI only keeps scope manageable
  - Facing-raise charts could be a follow-up
- What UI treatment for the comparison widget? Compact inline vs expandable accordion?
- Should we highlight which persona matches the AI's recommendation?

## Next Steps

1. Run `/workflows:plan` to design the implementation
2. Curate the 24 hand charts (likely a script + manual review)
3. Build the data module and lookup logic
4. Add the comparison widget to the analysis UI
