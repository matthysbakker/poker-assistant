---
title: Static Persona Hand Charts
type: feat
date: 2026-02-18
brainstorm: docs/brainstorms/2026-02-18-static-persona-hand-charts-brainstorm.md
---

# feat: Static Persona Hand Charts

## Overview

Add static preflop hand charts tied to 4 fictive poker personas, integrated into the existing analysis results. When the AI analyzes a preflop hand, the app also shows what each persona would do with those cards in that position — providing educational context without API calls.

## Problem Statement / Motivation

Currently the app gives a single AI recommendation per hand. Users lack context for *how different playing styles* would approach the same situation. Static persona charts provide:

- **Educational value**: Learn how Nits, TAGs, LAGs, and Calling Stations think
- **Zero runtime cost**: Pure client-side lookup, no AI calls
- **Strategic context**: "The AI agrees with Sharp Eddie (TAG) on this hand"

## Proposed Solution

### Data Module: `lib/poker/personas.ts`

Static TypeScript module exporting 4 personas, each with 6 position-specific hand charts (169 hands per chart = 4,056 total data points).

```typescript
// lib/poker/personas.ts

export type PersonaAction = "RAISE" | "CALL" | "FOLD";
export type Position = "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB";

export interface Persona {
  id: string;
  name: string;
  tagline: string;
  playerType: "TIGHT_PASSIVE" | "TIGHT_AGGRESSIVE" | "LOOSE_AGGRESSIVE" | "LOOSE_PASSIVE";
  charts: Record<Position, Record<string, PersonaAction>>;
}

export const PERSONAS: Persona[] = [
  {
    id: "steady_sal",
    name: "Steady Sal",
    tagline: "Only plays the nuts, folds everything else",
    playerType: "TIGHT_PASSIVE",
    charts: { UTG: { "AA": "RAISE", "AKs": "RAISE", /* ... */ }, /* ... */ }
  },
  // ... 3 more personas
];
```

**Hand key format**: Standard 13x13 matrix notation — `"AA"`, `"AKs"`, `"AKo"`, ..., `"32o"`, `"22"` (169 unique keys).

### Card Notation Converter: `lib/poker/hand-notation.ts`

Converts AI output (`"Ah Kd"`) to chart lookup key (`"AKo"`).

```typescript
// lib/poker/hand-notation.ts

export function toHandNotation(heroCards: string): string | null
```

**Rules:**
- Split on whitespace, expect exactly 2 card codes
- Normalize rank: `"10"` → `"T"` (AI uses "10", charts use "T")
- Sort by rank (A highest, 2 lowest) — handles reversed input like `"Kd Ah"` → `"AKo"`
- Detect pair (`"As Ac"` → `"AA"`) — no suited/offsuit suffix
- Detect suited (same suit letter) → append `"s"`, else `"o"`
- Return `null` for malformed input

### Persona Lookup: `lib/poker/persona-lookup.ts`

```typescript
// lib/poker/persona-lookup.ts

import { PERSONAS, type PersonaAction, type Position } from "./personas";

interface PersonaRecommendation {
  persona: Persona;
  action: PersonaAction;
}

export function getPersonaRecommendations(
  heroCards: string,
  position: Position
): PersonaRecommendation[] | null
```

Converts `heroCards` to notation, looks up all 4 personas for that hand+position, returns array of recommendations. Returns `null` if conversion fails.

### UI Component: `components/analyzer/PersonaComparison.tsx`

```typescript
// components/analyzer/PersonaComparison.tsx

interface Props {
  heroCards: string;      // "Ah Kd"
  heroPosition: Position; // "CO"
  aiAction?: string;      // "RAISE" — to highlight matching personas
}
```

**Layout:**
- Section header: "What Would They Do?"
- 2x2 grid on desktop, 1-column stack on mobile
- Each persona card shows: name, tagline, action badge (color-coded)
- Subtle highlight on personas whose action matches the AI recommendation
- Uses existing `ACTION_COLORS` scheme (RAISE=green, CALL=yellow, FOLD=red)
- Dark card style consistent with existing sections (`bg-zinc-900/50`, `border-zinc-800`)

**Placement in `AnalysisResult.tsx`:**
After the Game State grid, before Opponents table. Groups "what to do" info together.

**Render condition:**
Only renders when ALL three are defined: `street === "PREFLOP"` AND `heroCards` AND `heroPosition`. During streaming, the section simply doesn't appear until all data arrives — no skeleton needed (consistent with how other sections already behave).

### Chart Data: Hand-Curated from Poker Theory

Based on Sklansky-Malmuth groups + established opening ranges:

| Persona | Overall VPIP | UTG | MP | CO | BTN | SB | BB |
|---------|-------------|-----|----|----|-----|----|----|
| Steady Sal (Nit) | ~10% | 7% | 9% | 12% | 15% | 10% | 12% |
| Sharp Eddie (TAG) | ~20% | 13% | 17% | 22% | 28% | 18% | 22% |
| Wild Maya (LAG) | ~30% | 18% | 25% | 33% | 42% | 30% | 38% |
| Curious Carl (Station) | ~45% | 30% | 38% | 48% | 55% | 45% | 60% |

**Key behavioral difference:**
- Sal, Eddie, Maya: small VPIP-PFR gap → they RAISE most hands they play
- Carl: large VPIP-PFR gap → he mostly CALLs instead of raising

**Scope decision:** All charts represent **RFI (raise-first-in) ranges only** — what the persona does when no one has raised yet. A small label "Opening ranges" appears on the widget. Facing-raise/defending charts are a potential follow-up.

### Data Encoding Strategy

Rather than manually typing 4,056 entries, define ranges using pattern rules in a helper script, then expand to the full 169-hand lookup:

```typescript
// scripts/generate-charts.ts (one-time generation script)

// Define ranges compactly:
const nitUTG = {
  raise: ["AA", "KK", "QQ", "JJ", "TT", "AKs", "AQs", "AKo"],
  call: ["99", "AJs"],
  // everything else = FOLD
};

// Expand to full 169-hand Record<string, PersonaAction>
// Output to lib/poker/personas.ts
```

The generated data is committed as static TypeScript — the script is a dev tool, not runtime code.

## Technical Considerations

### Card Notation Edge Cases

| Input | Expected Output | Note |
|-------|----------------|------|
| `"Ah Kd"` | `"AKo"` | Standard case |
| `"Ah Kh"` | `"AKs"` | Suited |
| `"As Ac"` | `"AA"` | Pair — no s/o suffix |
| `"Kd Ah"` | `"AKo"` | Reversed order — sort by rank |
| `"10h 9s"` | `"T9o"` | Ten normalization |
| `"10h 10s"` | `"TT"` | Ten pair |
| `"2c Ah"` | `"A2o"` | Low card first — sort |
| `""` or `"Ah"` | `null` | Malformed |

### Position Type Reuse

The `Position` type already exists in `lib/ai/schema.ts` (Zod enum). Export a standalone TypeScript type from `lib/poker/personas.ts` rather than coupling to Zod. Both define the same 6 values.

### No Impact on Streaming

The persona widget is a pure client-side lookup triggered by already-streamed fields. Zero impact on API performance or streaming architecture.

## Acceptance Criteria

### Functional Requirements

- [ ] `lib/poker/hand-notation.ts` — converts `"Ah Kd"` strings to `"AKo"` notation with all edge cases handled
- [ ] `lib/poker/personas.ts` — exports 4 personas with complete charts (all 169 hands × 6 positions × 4 personas)
- [ ] `lib/poker/persona-lookup.ts` — looks up all 4 persona recommendations for a given hand + position
- [ ] `components/analyzer/PersonaComparison.tsx` — renders 2x2 grid with persona name, tagline, color-coded action badge
- [ ] Widget only appears when `street === "PREFLOP"` and `heroCards` + `heroPosition` are both defined
- [ ] Personas matching the AI's recommended action get a subtle highlight
- [ ] Section header "What Would They Do?" with "Opening ranges" label
- [ ] Responsive: 2x2 grid on desktop, stacked on mobile
- [ ] `scripts/generate-charts.ts` — generates chart data from compact range definitions

### Data Requirements

- [ ] Nit (Steady Sal): ~10% overall VPIP, mostly RAISE entries, very few CALLs
- [ ] TAG (Sharp Eddie): ~20% overall VPIP, mostly RAISE, position-dependent widening
- [ ] LAG (Wild Maya): ~30% overall VPIP, aggressive RAISE bias, wide button range
- [ ] Calling Station (Curious Carl): ~45% overall VPIP, large CALL proportion, rarely folds on BTN

### Testing

- [ ] Unit tests for `toHandNotation()` — all edge cases from the table above
- [ ] Unit test validating chart completeness: every persona × position has exactly 169 entries
- [ ] Unit test validating every entry is a valid `PersonaAction`

## Implementation Phases

### Phase 1: Data Foundation

1. Create `lib/poker/hand-notation.ts` with `toHandNotation()` function
2. Create `scripts/generate-charts.ts` with compact range definitions for all 24 charts
3. Generate `lib/poker/personas.ts` with full chart data
4. Create `lib/poker/persona-lookup.ts` with lookup function
5. Write tests for notation converter and chart completeness

### Phase 2: UI Integration

1. Create `components/analyzer/PersonaComparison.tsx`
2. Integrate into `AnalysisResult.tsx` — render conditionally for preflop hands
3. Style consistently with existing dark theme and `ACTION_COLORS`
4. Add responsive layout (2x2 → stacked)
5. Add AI-match highlighting

### Phase 3: Polish

1. Show persona comparison in `HandHistoryItem.tsx` for preflop hands (data already saved)
2. Review chart data accuracy against established poker theory
3. Tweak colors/spacing based on visual testing

## Dependencies & Risks

**Risk: Chart data accuracy** — Hand-curated ranges must align with established poker theory. Mitigation: use Sklansky-Malmuth groups as baseline, cross-reference with published opening ranges from poker training sites.

**Risk: BB/SB usefulness** — RFI-only charts are misleading for BB (almost always faces a raise). Mitigation: clear "Opening ranges" label. Follow-up feature: add facing-raise charts.

**Dependency: None** — pure client-side, no new packages, no API changes.

## Future Considerations

- **Facing-raise charts**: Add BB/SB defending ranges and 3-bet ranges for all positions
- **Interactive full charts**: Let users click a persona to see the full 13x13 matrix
- **Custom personas**: Let users define their own ranges
- **Postflop heuristics**: Extend personas to postflop decisions (much more complex)

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-18-static-persona-hand-charts-brainstorm.md`
- AI schema (Position, PlayerType): `lib/ai/schema.ts:3-21`
- Analysis result UI: `components/analyzer/AnalysisResult.tsx`
- Opponent table (styling reference): `components/analyzer/OpponentTable.tsx`
- Action colors: `lib/poker/types.ts`
- Card detection types: `lib/card-detection/types.ts`

### External References

- Sklansky-Malmuth hand groups: Groups 1-8 starting hand tiers
- Standard opening ranges: VPIP/PFR framework for player classification
- 169 unique starting hands: 13 pairs + 78 suited + 78 offsuit = 1,326 combos → 169 strategic categories
