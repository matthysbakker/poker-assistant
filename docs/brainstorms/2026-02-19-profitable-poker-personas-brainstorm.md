# Profitable Poker Personas

**Date:** 2026-02-19
**Status:** Brainstorm complete

## What We're Building

Redesign the 4 poker personas so they all represent **profitable** player archetypes — strategies that would make money over many sessions of online poker. The current personas map to the opponent classification grid (nit, TAG, LAG, calling station), which includes two losing/marginal types. The new personas should be educational models of *how to win*.

## Why This Change

### Current Problem

The existing personas mirror the PLAYER_TYPES used for opponent classification:

| Current Persona | Type | Long-Term Profitability |
|---|---|---|
| Steady Sal | Nit (TIGHT_PASSIVE) | Marginal — barely breaks even after rake |
| Sharp Eddie | TAG (TIGHT_AGGRESSIVE) | Profitable |
| Wild Maya | LAG (LOOSE_AGGRESSIVE) | Profitable if skilled |
| **Curious Carl** | **Calling Station (LOOSE_PASSIVE)** | **Losing — the classic "fish"** |

Showing "what would a calling station do?" as a persona teaches bad habits. A nit that folds everything barely beats rake at micro stakes.

### Research Findings

Deep research on profitable online poker archetypes (2024-2026) reveals:

- **Only ~8-12% of online players are long-term winners** after rake (GipsyTeam 2025 analysis)
- All profitable archetypes share: **aggression** (PFR close to VPIP), **positional awareness**, and **emotional control**
- The modern consensus is **GTO as baseline + exploitative deviations** when reads are available
- TAG is the baseline winning style; LAG has the highest ceiling; GTO-based is the modern standard
- Win rates range from 3-12 bb/100 depending on style and stakes

## Key Decisions

### Decouple Personas from Opponent Classification

- **PLAYER_TYPES** (`TIGHT_PASSIVE`, `TIGHT_AGGRESSIVE`, `LOOSE_PASSIVE`, `LOOSE_AGGRESSIVE`, `UNKNOWN`) stays as-is for tagging opponents at the table
- **Personas** become independent: 4 profitable strategies a user can learn from
- They serve completely different purposes: "how to categorize who you're playing against" vs "how to play to win"

### The 4 New Personas

| Persona | Style | VPIP | Expected Win Rate | Replaces |
|---|---|---|---|---|
| **GTO Grinder** | Solver-based, balanced ranges | ~23% | 3-6 bb/100 | NEW |
| **TAG Shark** | Tight-aggressive, disciplined | ~20% | 4-8 bb/100 | Sharp Eddie (similar) |
| **LAG Assassin** | Wide, aggressive, GTO-informed | ~30% | 5-12 bb/100 | Wild Maya (+ GTO foundation) |
| **Exploit Hawk** | Reads-based, adapts to table | ~22% base | Variable | Steady Sal + Curious Carl |

### How They Differ in Chart Terms

| Persona | EP VPIP | LP VPIP | Signature Trait |
|---|---|---|---|
| **GTO Grinder** | ~15% | ~28% | Includes suited connectors & suited aces as solver-balanced bluffs. Proper bluff:value ratios. |
| **TAG Shark** | ~13% | ~25% | Linear, value-heavy ranges. Premium-focused. Less speculative hands. |
| **LAG Assassin** | ~18% | ~40% | Widest ranges by far. Lots of suited gappers, connectors. Almost never calls — raises or folds. |
| **Exploit Hawk** | ~14% | ~32% | TAG core but significantly wider steals (CO/BTN/SB). Tighter EP. Exploits fold-heavy populations. |

### Key Differentiators Explained

**GTO Grinder vs TAG Shark:**
The GTO Grinder plays slightly wider because they include hands that serve as balanced bluffs (e.g., A5s, 76s). The TAG Shark is more linear — when they play a hand, it's usually for value. GTO Grinder sacrifices some immediate EV for unexploitability.

**LAG Assassin:**
Significantly wider than both, especially in position. The LAG opens suited gappers (86s, 75s), suited one-gaps (J9s, T8s), and even some suited two-gaps from the button. Almost zero calling — they raise or fold. Highest variance but highest ceiling.

**Exploit Hawk:**
Similar overall VPIP to TAG Shark but distributed differently. Tighter in early position (no marginal opens), much wider in steal positions (CO/BTN/SB). Represents the player who knows most opponents fold too much to late-position raises.

### Descriptive Names (Not Character Names)

Using descriptive names that immediately communicate what each persona does, rather than fun character names. "GTO Grinder" tells you more than "GTO Gary" at a glance.

### Taglines

| Persona | Tagline |
|---|---|
| GTO Grinder | "Balanced ranges, no exploitable leaks" |
| TAG Shark | "Premium hands, maximum aggression" |
| LAG Assassin | "Wide ranges, relentless pressure" |
| Exploit Hawk | "Adapts to the table, steals relentlessly" |

## Range Guidelines

### GTO Grinder (~23% overall VPIP)

Solver-derived ranges with proper bluff:value ratios:
- **UTG**: ~15% — premiums + suited broadways + A5s-A4s (blocker bluffs)
- **MP**: ~18% — add suited connectors (87s, 76s), more suited aces
- **CO**: ~24% — wider suited connectors, suited gappers
- **BTN**: ~32% — most suited hands, offsuit broadways, small pairs
- **SB**: ~22% — 3-bet or fold (no calling from SB)
- **BB**: ~28% — defend wider vs steals (position disadvantage priced in)

### TAG Shark (~20% overall VPIP)

Premium-focused, value-heavy ranges:
- **UTG**: ~13% — TT+, ATs+, KQs, AKo, AQo
- **MP**: ~16% — add 99, A9s, KJs, suited connectors
- **CO**: ~22% — add 77+, broadways, more suited aces
- **BTN**: ~28% — wider pairs, suited connectors, offsuit broadways
- **SB**: ~18% — 3-bet linear, fold weak
- **BB**: ~24% — defend top of range vs steals

### LAG Assassin (~30% overall VPIP)

Wide, aggressive, GTO-informed:
- **UTG**: ~18% — 55+, A7s+, K9s+, QTs+, JTs, T9s, ATo+, KJo+
- **MP**: ~24% — add suited gappers, more offsuit broadways
- **CO**: ~33% — most suited hands, offsuit connectors
- **BTN**: ~42% — very wide, any suited, most offsuit broadways
- **SB**: ~30% — aggressive 3-bets and isolation raises
- **BB**: ~38% — defends wide, re-raises aggressively

### Exploit Hawk (~22% baseline VPIP, wider in steal positions)

TAG core + population-adjusted steals:
- **UTG**: ~14% — conservative, only clear value hands
- **MP**: ~16% — still tight, no marginal opens
- **CO**: ~28% — significantly wider than TAG (steal-focused)
- **BTN**: ~35% — very wide steals, any ace, suited kings, connectors
- **SB**: ~25% — aggressive 3-bets, wide isolation vs limpers
- **BB**: ~26% — defends solid range, re-raises tight opponents

## Data Changes

### Chart Regeneration

- Update `scripts/generate-charts.ts` with new persona definitions
- Regenerate `lib/poker/personas.ts` with new range data
- Update PersonaComparison component with new names/taglines
- Total: **4 personas x 6 positions x 169 hands = 4,056 data points**

### Persona Data Structure (unchanged)

```typescript
interface Persona {
  id: string;          // "gto_grinder", "tag_shark", "lag_assassin", "exploit_hawk"
  name: string;        // "GTO Grinder", etc.
  tagline: string;
  playerType: string;  // No longer maps to PLAYER_TYPES — independent identifier
  charts: Record<ChartPosition, Record<string, PersonaAction>>;
}
```

### Breaking Change: `playerType` Field

Currently `playerType` on Persona maps to PLAYER_TYPES. After decoupling:
- Persona gets a new `style` field (e.g., `"GTO_BALANCED"`, `"TAG"`, `"LAG"`, `"EXPLOITATIVE"`)
- The old `playerType` field is removed from Persona
- PLAYER_TYPES on Opponent schema stays unchanged

## Research Sources

### Profitable Player Types
- [GTO Wizard — How To Become a Winning Poker Player in 2025](https://blog.gtowizard.com/how-to-become-a-winning-poker-player-in-2025-part-1/)
- [Upswing Poker — GTO vs Exploitative Play](https://upswingpoker.com/gto-vs-exploitative-play-game-theory-optimal-strategy/)
- [Poker Coaching — GTO vs Exploitative Strategy](https://pokercoaching.com/blog/exploitative-or-gto-which-is-the-better-poker-strategy/)
- [My Poker Coaching — GTO Poker Master Guide 2025](https://www.mypokercoaching.com/gto-poker/)

### Win Rates and Statistics
- [GipsyTeam — How Many Winning Cash Game Players Are There?](https://www.gipsyteam.com/news/12-12-2025/number-of-winning-cash-game-players) — only 7.5-20% of players are winners after rake
- [BlackRain79 — Good Win Rates for Micro and Small Stakes](https://www.blackrain79.com/2014/06/good-win-rates-for-micro-and-small_6.html)
- [MicroGrinder — Understanding Win Rates](https://microgrinder.com/poker-strategy-articles/introduction-to-win-rates/)

### Player Classification
- [Pokerology — 6 Poker Player Styles Explained](https://www.pokerology.com/poker/strategy/playing-styles/)
- [GTO Wizard — Profiles: Modeling Exploitable Opponents](https://blog.gtowizard.com/profiles_explained_modeling_exploitable_opponents/)
- [Bluff the Spot — Player Types](https://www.bluffthespot.com/blog/player-types)

### Exploitation Strategies
- [SplitSuit — Exploit Poker Fish for Maximum Value](https://www.splitsuit.com/how-to-exploit-poker-fish-for-value)
- [DeepSolver — Exploitative Poker Against Recreational Players](https://deepsolver.com/blog/exploitative-poker-how-to-adjust-against-recreational-players)
- [Hand2Note — 5 Exploitative Adjustments](https://hand2note.com/Blog/Features/5-exploitative-adjustments-to-aggressive-fish)

## Game Type Decision

**Cash game only for v1.** The 4 personas assume ~100bb deep, standard RFI situations.

Tournament support deferred to v2 — requires stack-size-dependent charts (Deep 60bb+, Medium 25-60bb, Short 15-25bb, Push/Fold <15bb), ICM adjustments, and ante-adjusted ranges. Potentially 4x the data volume.

## Open Questions

- Should the persona comparison highlight which persona *most agrees* with Claude's recommendation?
- Should we add a brief "why" tooltip for each persona's action? (e.g., "GTO Grinder raises A5s here as a blocker bluff")
- Future: could personas have postflop tendencies too? (e.g., c-bet frequency, check-raise frequency)
- Future: tournament stack-dependent charts (v2)

## Next Steps

1. Run `/workflows:plan` to design implementation
2. Define exact ranges per persona per position in `generate-charts.ts`
3. Regenerate `personas.ts`
4. Update PersonaComparison component with new names/taglines/colors
5. Remove the `playerType` coupling between Persona and PLAYER_TYPES
