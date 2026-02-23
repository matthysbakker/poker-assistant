---
title: "feat: Redesign personas as profitable poker archetypes"
type: feat
date: 2026-02-19
---

# feat: Redesign Personas as Profitable Poker Archetypes

## Overview

Replace the 4 poker personas (which currently include 2 losing/marginal player types) with 4 profitable archetypes that all represent winning strategies. Decouple personas from the opponent classification system (`PLAYER_TYPES`).

## Problem Statement

The current personas map 1:1 to the opponent classification grid:
- **Curious Carl** (Calling Station) is a losing player type — the "fish" that funds winning players
- **Steady Sal** (Nit) barely breaks even after rake at micro stakes
- Showing "what would a calling station do?" teaches bad habits

Research shows only 8-12% of online poker players are long-term winners. All profitable archetypes share: aggression, positional awareness, and balanced/exploitative range construction.

## Proposed Solution

4 new personas, all profitable, with distinct strategies:

| Persona | Style | VPIP | Signature |
|---|---|---|---|
| **GTO Grinder** | Solver-balanced | ~23% | Balanced bluffs (suited connectors, blocker aces) |
| **TAG Shark** | Value-heavy | ~20% | Premium-focused, linear ranges |
| **LAG Assassin** | Pressure | ~30% | Widest ranges, raise-or-fold, max aggression |
| **Exploit Hawk** | Positional stealer | ~22% | Tight EP, very wide LP steals |

### Decoupling

- `PLAYER_TYPES` on `Opponent` schema: **unchanged** (still TIGHT_PASSIVE etc.)
- `Persona.playerType` field: **removed**, replaced with `style` string
- Persona and opponent classification serve different purposes

## Technical Approach

### Phase 1: Update Types and Generator Script

**Files:** `scripts/generate-charts.ts`, `lib/poker/personas.ts`

- [x] Remove `playerType` field from `Persona` interface, add `style: string`
- [x] Replace 4 persona definitions (SAL, EDDIE, MAYA, CARL) with new ones
- [x] Update output template in generator
- [x] Run generator to produce new `personas.ts`

#### New Persona Definitions

```typescript
// scripts/generate-charts.ts

const GTO_GRINDER: PersonaRanges = {
  UTG: {
    raise: "77+, ATs+, A5s-A4s, KQs, KJs, QJs, JTs, AKo, AQo",
    // ~15% — premiums + suited broadways + blocker aces (A5s/A4s)
  },
  MP: {
    raise: "66+, A8s+, A5s-A4s, KTs+, QTs+, JTs, T9s, AKo, AQo, AJo",
    // ~18%
  },
  CO: {
    raise: "44+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+, QJo",
    // ~24%
  },
  BTN: {
    raise: "22+, A2s+, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A7o+, K9o+, QTo+, JTo",
    // ~32%
  },
  SB: {
    raise: "55+, A7s+, A5s-A4s, KTs+, QTs+, JTs, T9s, 98s, ATo+, KJo+, QJo",
    // ~22% — 3-bet or fold (no completing)
  },
  BB: {
    raise: "88+, ATs+, KQs, AKo, AQo",
    call: "22-77, A2s-A9s, K8s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, A9o-ATo, KTo+, QJo, JTo",
    // ~28% defend — calls are defending vs raise
  },
};

const TAG_SHARK: PersonaRanges = {
  UTG: {
    raise: "77+, ATs+, KQs, AKo, AQo",
    // ~13% — tight, linear, value-heavy
  },
  MP: {
    raise: "66+, A9s+, KJs+, QJs, AKo, AQo, AJo",
    // ~16%
  },
  CO: {
    raise: "44+, A7s+, K9s+, QTs+, JTs, T9s, ATo+, KJo+, QJo",
    // ~22%
  },
  BTN: {
    raise: "22+, A2s+, K7s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, A8o+, KTo+, QTo+, JTo",
    // ~28%
  },
  SB: {
    raise: "66+, A8s+, KTs+, QJs, JTs, ATo+, KQo",
    // ~18%
  },
  BB: {
    raise: "99+, AJs+, KQs, AKo",
    call: "22-88, A2s-ATs, K9s+, Q9s+, J9s+, T9s, 98s, 87s, A9o-AJo, KTo+, QJo, JTo",
    // ~24% defend
  },
};

const LAG_ASSASSIN: PersonaRanges = {
  UTG: {
    raise: "55+, A5s+, K9s+, QTs+, JTs, T9s, 98s, ATo+, KJo+",
    // ~18% — wider EP than others
  },
  MP: {
    raise: "33+, A3s+, K7s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, A9o+, KTo+, QJo",
    // ~24%
  },
  CO: {
    raise: "22+, A2s+, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A7o+, K9o+, QTo+, JTo",
    // ~33%
  },
  BTN: {
    raise: "22+, A2s+, K2s+, Q4s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, 43s, A2o+, K7o+, Q9o+, J9o+, T9o",
    // ~42% — very wide
  },
  SB: {
    raise: "33+, A2s+, K7s+, Q9s+, J9s+, T9s, 98s, 87s, A8o+, KTo+, QJo",
    // ~30%
  },
  BB: {
    raise: "77+, A9s+, KJs+, QJs, AKo, AQo, AJo",
    call: "22-66, A2s-A8s, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A2o+, K9o+, QTo+, JTo, T9o",
    // ~38% defend — wide defense
  },
};

const EXPLOIT_HAWK: PersonaRanges = {
  UTG: {
    raise: "77+, ATs+, KQs, AKo, AQo",
    // ~14% — conservative EP, no marginal opens
  },
  MP: {
    raise: "66+, A9s+, KJs+, QJs, AKo, AQo, AJo",
    // ~16% — still tight
  },
  CO: {
    raise: "33+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, A9o+, KTo+, QJo, JTo",
    // ~28% — starts widening here (steal position)
  },
  BTN: {
    raise: "22+, A2s+, K4s+, Q6s+, J7s+, T7s+, 96s+, 85s+, 75s+, 65s, 54s, A5o+, K9o+, QTo+, J9o+, T9o",
    // ~35% — very wide steals
  },
  SB: {
    raise: "44+, A4s+, K8s+, QTs+, JTs, T9s, 98s, 87s, A9o+, KTo+, QJo",
    // ~25% — aggressive iso-raises
  },
  BB: {
    raise: "88+, ATs+, KQs, AKo, AQo",
    call: "22-77, A2s-A9s, K8s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, A8o-ATo, KTo+, QJo, JTo",
    // ~26% defend
  },
};
```

**Key range design principles:**
- **No CALL in RFI positions** — all profitable styles raise or fold when opening
- **CALL only in BB** — represents defending vs a single raise
- **GTO Grinder** includes blocker aces (A5s/A4s) that others don't — the solver signature
- **TAG Shark** is the most linear — every hand played is strong
- **LAG Assassin** includes suited gappers and connectors others skip
- **Exploit Hawk** has the biggest EP-to-LP spread — tight UTG/MP, wide CO/BTN/SB

### Phase 2: Update UI Component

**Files:** `components/analyzer/PersonaComparison.tsx`

- [x] Update header text: "What Would They Do?" → "Strategy Comparison"
- [x] Verify persona name + tagline display works with new data
- [x] No structural changes needed (component doesn't use `playerType`)

#### New Persona Metadata

```typescript
// In generate-charts.ts PERSONA_DEFS:
{
  id: "gto_grinder",
  name: "GTO Grinder",
  tagline: "Balanced ranges, no exploitable leaks",
  style: "gto",
},
{
  id: "tag_shark",
  name: "TAG Shark",
  tagline: "Premium hands, maximum aggression",
  style: "tag",
},
{
  id: "lag_assassin",
  name: "LAG Assassin",
  tagline: "Wide ranges, relentless pressure",
  style: "lag",
},
{
  id: "exploit_hawk",
  name: "Exploit Hawk",
  tagline: "Adapts to the table, steals relentlessly",
  style: "exploit",
},
```

### Phase 3: Verify No Breakage

- [x] Confirm `PLAYER_TYPES` in `lib/ai/schema.ts` is untouched
- [x] Confirm `OpponentTable.tsx` still works (uses `Opponent.playerType`, not `Persona.playerType`)
- [x] Confirm `sessions.ts` opponent tracking is unaffected
- [x] Confirm `persona-lookup.ts` works with new Persona shape (it doesn't reference `playerType`)
- [x] Verify `AnalysisResult.tsx` import of `ChartPosition` still works

### Phase 4: Add package.json Script

- [x] Add `"generate-charts": "bun run scripts/generate-charts.ts"` to package.json
- [x] Document regeneration command

## Acceptance Criteria

- [ ] 4 new personas: GTO Grinder, TAG Shark, LAG Assassin, Exploit Hawk
- [ ] All 4 are profitable archetypes with distinct, differentiated ranges
- [ ] `Persona.playerType` removed, replaced with `Persona.style`
- [ ] `PLAYER_TYPES` for opponent classification unchanged
- [ ] PersonaComparison renders correctly with new persona names/taglines
- [ ] No CALL (limp) in RFI positions — only RAISE or FOLD
- [ ] BB charts include CALL (defend) entries
- [ ] Generator script produces valid 4,056 data points (4 × 6 × 169)
- [ ] Dev server starts without errors
- [ ] PersonaComparison displays on preflop screenshots

## Spec-Flow Edge Cases Addressed

| Edge Case | Decision |
|---|---|
| CHECK preflop (BB walk) | No change — CHECK won't match any persona, no highlight shown. Acceptable. |
| CALL in non-BB positions | Removed — profitable personas raise or fold when opening |
| SB action semantics | SB = raise or fold (no completing). SB CALL removed. |
| All 4 agree on same action | No special UI treatment for now. Could add "All agree" callout later. |
| Exploit Hawk dynamic behavior | Static chart. Exploit philosophy baked into range construction (tight EP, wide LP). |
| Persona-specific colors | Not added — action colors (green/yellow/red) are more informative |
| Display order in 2x2 grid | GTO Grinder (TL), TAG Shark (TR), LAG Assassin (BL), Exploit Hawk (BR) |

## Dependencies & Risks

- **Low risk**: This is a data replacement + minor type change. No architectural changes.
- **Range accuracy**: The ranges are based on poker research but should be reviewed by a poker expert for optimal play.
- **Future**: Tournament stack-dependent charts are a v2 feature (completely separate system).

## References

- Brainstorm: `docs/brainstorms/2026-02-19-profitable-poker-personas-brainstorm.md`
- Original persona brainstorm: `docs/brainstorms/2026-02-18-static-persona-hand-charts-brainstorm.md`
- Generator script: `scripts/generate-charts.ts`
- Generated output: `lib/poker/personas.ts`
- UI component: `components/analyzer/PersonaComparison.tsx`
- Lookup: `lib/poker/persona-lookup.ts`
- Hand notation: `lib/poker/hand-notation.ts`
