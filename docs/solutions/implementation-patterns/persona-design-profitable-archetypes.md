---
title: "Persona Design: Use Profitable Archetypes, Not Opponent Classifications"
category: implementation-patterns
module: poker/personas
tags: [personas, poker-theory, design-decision, decoupling]
date: 2026-02-21
---

# Persona Design: Use Profitable Archetypes, Not Opponent Classifications

## Problem

The poker assistant's persona system initially mapped 1:1 to the opponent classification grid (TIGHT_PASSIVE, TIGHT_AGGRESSIVE, LOOSE_PASSIVE, LOOSE_AGGRESSIVE). This meant two of the four "teaching" personas represented losing player types:

- **Curious Carl** (Calling Station / LOOSE_PASSIVE) — the classic "fish" that funds other players' profits
- **Steady Sal** (Nit / TIGHT_PASSIVE) — barely breaks even after rake at micro stakes

Showing "what would a calling station do with this hand?" teaches bad habits. The personas were meant to be educational, but two of them demonstrated strategies that lose money over time.

## Root Cause

The design conflated two separate concerns:

1. **Opponent classification** — categorizing players at the table to exploit their tendencies
2. **Strategy demonstration** — showing how different winning approaches play the same hand

These serve opposite purposes. Opponent classification includes losing types *because you want to identify and exploit them*. Strategy demonstration should only include types *worth emulating*.

## Solution

### Decouple Personas from Opponent Types

- `PLAYER_TYPES` (`TIGHT_PASSIVE`, `TIGHT_AGGRESSIVE`, etc.) stays as-is for tagging opponents in the AI schema
- `Persona` interface gets its own `style` field, independent of `PLAYER_TYPES`
- The two systems serve different purposes and should evolve independently

### Replace with 4 Profitable Archetypes

All personas should represent strategies that make money over many sessions:

| Persona | Style | VPIP | Key Trait |
|---|---|---|---|
| GTO Grinder | Solver-balanced | ~23% | Includes blocker bluffs (A5s/A4s) for balance |
| TAG Shark | Value-heavy | ~19% | Linear ranges, premium-focused |
| LAG Assassin | Pressure | ~35% | Widest ranges, raise-or-fold |
| Exploit Hawk | Positional stealer | ~24% | Tight EP, very wide LP steals |

### No Open-Limping for Profitable Personas

In RFI (raise-first-in) positions, profitable players raise or fold — they don't limp. The `CALL` action should only exist in BB charts where it represents defending against a raise, which is a different semantic.

## Key Insight

Research shows only 8-12% of online poker players are long-term winners after rake. All profitable archetypes share:
- **Aggression** — PFR close to VPIP (small gap)
- **Positional awareness** — wider ranges in late position
- **No limping** — raise or fold in opening spots

The differentiation between profitable styles is *how* they approach the game, not whether they're tight/loose:
- GTO Grinder: balanced bluff-to-value ratios
- TAG Shark: value-heavy, linear
- LAG Assassin: maximum pressure, widest ranges
- Exploit Hawk: adapts ranges by position (tight EP → wide LP)

## Prevention

When designing "teaching" or "example" archetypes in any domain:
1. Only include archetypes worth emulating
2. Keep classification systems (for identifying others) separate from demonstration systems (for teaching users)
3. If a persona represents a losing strategy, it belongs in opponent analysis, not in "what should I do?"

## References

- Brainstorm: `docs/brainstorms/2026-02-19-profitable-poker-personas-brainstorm.md`
- Plan: `docs/plans/2026-02-19-feat-profitable-poker-personas-plan.md`
- PR: #6
- Generator: `scripts/generate-charts.ts`
- Research sources in brainstorm document
