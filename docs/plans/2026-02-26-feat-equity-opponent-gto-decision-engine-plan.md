---
title: "feat: Equity Engine + Opponent Stats + GTO Lookup Tables"
type: feat
date: 2026-02-26
brainstorm: docs/brainstorms/2026-02-26-open-source-poker-research-brainstorm.md
---

# feat: Equity Engine + Opponent Stats + GTO Lookup Tables

## Overview

Three composing improvements to the postflop decision engine:

- **A — Equity engine**: replace outs-only equity with range-vs-hero equity using `node-poker-odds-calculator`. Equity buckets drive both action selection and bet sizing.
- **B — Opponent stats**: DOM-scrape opponent actions (fold/call/raise) into a structured log; compute VPIP/AF/PFR live; use VPIP to parameterize the villain range for Feature A.
- **C — GTO lookup tables**: encode existing `gto-postflop-rule-engine.md` data as a queryable JSON table; insert as Phase 3 in the decision pipeline before the rule tree (Phase 4).

These three compose: **B feeds A** (opponent VPIP → villain range width), **C provides the baseline** (GTO-recommended action + sizing), **A confirms or adjusts** (equity-bucket override when equity diverges from GTO baseline).

---

## Current Architecture

Decision pipeline in `extension/src/poker-content.ts` (`processGameState()`):

```
Phase 1a  Persona chart fast-path (preflop RFI)
Phase 1b  RFI fallback (rfi-fallback.ts)
Phase 2   Facing raise / limp / 3-bet (facing-raise.ts)
--- PHASE 3 MISSING ---
Phase 4   Postflop local engine → localDecide(state) → applyRuleTree(input)
```

**Current equity** in `lib/poker/rule-tree.ts` line 97:
```typescript
const rawEquity = exactOutEquity(adjustedOuts, seenCount, streetsLeft);
// outs-only formula — ignores villain range entirely
```

**Bet sizing** in `lib/poker/board-analyzer.ts`:
```typescript
betFractionFromWetScore(wetScore) // returns 0.33 / 0.50 / 0.66 based on board only
// ignores hand strength, equity, position
```

**Opponent data** in `lib/storage/sessions.ts`:
```typescript
OpponentProfile.actions: string[] // prose strings from Claude analysis — not parseable
// Cannot compute VPIP/PFR/AF from these
```

---

## Technical Decisions

### Execution environment for equity calculation

`node-poker-odds-calculator` targets Node.js and cannot be bundled into the browser extension. **Decision: server-side API route.**

The extension already calls `localhost:PORT/api/persona` and `localhost:PORT/api/record`. Add a new `/api/equity` endpoint. Accept the round-trip latency (~5–20ms on localhost) as an acceptable trade-off for exact equity.

### Villain range representation

A VPIP percentage does not directly translate to a range without a mapping function. Use a preflop hand strength ordering table (standard poker theory) to map `VPIP%` → top N% of hands → set of combo strings.

```typescript
interface VillainRange {
  combos: string[];       // e.g. ["AAs", "KKs", ..., "72o"]
  vpipSource: number;     // VPIP% this was derived from (for debugging)
  confidence: number;     // 0-1, based on sample size
  source: "vpip_derived" | "default_random";
}
```

Default range when no history: `source: "default_random"` = all 1326 combos (random hand).

### DOM action scraping for Feature B

Claude is no longer the decision engine and runs less frequently. The existing `actions: string[]` in `OpponentProfile` (prose from Claude) will not reliably fill. **Decision: add parallel DOM scraping of opponent actions** directly in `poker-content.ts`, independent of Claude.

The poker client's DOM renders action announcements ("Player 3 raises to €0.12") — scrape these alongside the existing button and card scrapers.

### Arbitration between C (GTO) and A (equity)

When GTO lookup hits and equity engine computes a different recommendation:

```
GTO frequency ≥ 0.70 (clear GTO action) → use GTO as baseline, use A only for sizing
GTO frequency 0.40–0.70 (mixed strategy) → use A's equity bucket to choose
GTO frequency < 0.40 (rare GTO action)   → use A's equity bucket
GTO miss                                  → use A's equity bucket
```

This is a pure function: `arbitrate(gtoHit, equityBucket, board, hand, state) → LocalDecision`.

### GTO table data source

The existing `docs/solutions/implementation-patterns/gto-postflop-rule-engine.md` encodes GTO Wizard / PioSolver aggregate data as TypeScript constants. Use this as the seed data — no external solver required for v1.

---

## Implementation Phases

### Phase 0: Shared Infrastructure (prerequisite for everything)

**Goal:** Define the types and data contracts that A, B, C all depend on.

#### 0.1 — `VillainRange` type and VPIP-to-range mapping

**File: `lib/poker/villain-range.ts`** (new)

```typescript
export interface VillainRange {
  combos: string[];
  vpipSource: number;
  confidence: number;
  source: "vpip_derived" | "default_random";
}

// Maps VPIP % → top N% of preflop hands by strength
// Buckets: 10 / 15 / 20 / 25 / 30 / 35 / 40 / 50 / 60 / random
export function vpipToRange(vpip: number, confidence: number): VillainRange;

export const DEFAULT_VILLAIN_RANGE: VillainRange; // all 1326 combos, confidence 0.5
```

Hand ordering follows standard preflop equity ranking (pairs by rank descending, then AKs, AQs, ... suited connectors, ... offsuit broadways, etc.).

#### 0.2 — `StructuredAction` type in OpponentProfile

**File: `lib/storage/sessions.ts`** (modify)

Add `structuredActions` alongside existing `actions: string[]`:

```typescript
export interface StructuredAction {
  street: "PREFLOP" | "FLOP" | "TURN" | "RIVER";
  action: "FOLD" | "CHECK" | "CALL" | "RAISE" | "BET";
  amount?: number;     // in €, null for FOLD/CHECK
  isVpip: boolean;     // preflop: true if CALL or RAISE and not BB check
  timestamp: number;
}

export interface OpponentProfile {
  // existing fields remain
  actions: string[];             // keep for backward compat / display
  structuredActions: StructuredAction[]; // NEW — machine-parseable
}
```

#### 0.3 — Extend `RuleTreeInput`

**File: `lib/poker/rule-tree.ts`** (modify `RuleTreeInput` interface)

Add:
```typescript
rangeEquity?: number;           // pre-computed hero equity vs villain range (0–1)
villainRange?: VillainRange;    // villain range estimate (passed in, not computed inside)
```

---

### Phase 1: Feature C — GTO Lookup Tables

Build before A (A's arbitration logic calls C).

#### 1.1 — Define types

**File: `lib/poker/gto/types.ts`** (new)

```typescript
export type GtoAction = "BET" | "CHECK" | "CALL" | "FOLD" | "RAISE";

export interface GtoEntry {
  key: string;                // normalized lookup key
  action: GtoAction;
  frequency: number;          // 0.0–1.0 (how often GTO takes this action)
  sizingFraction: number;     // fraction of pot (0 if CHECK/FOLD)
  source: string;             // citation from gto-postflop-rule-engine.md
}

export interface GtoTableLookupResult {
  hit: true;
  entry: GtoEntry;
} | {
  hit: false;
}
```

#### 1.2 — Key serialization

**File: `lib/poker/gto/key.ts`** (new)

Key format: `"${position}_${street}_ws${wetScore}${paired}_${handTier}_${facingBet}"`

Where:
- `position`: `"IP"` or `"OOP"` — derived from hero position relative to last aggressor
- `street`: `"flop"` | `"turn"` | `"river"`
- `wetScore`: `0`–`4`
- `paired`: `"p"` if board is paired, `""` otherwise
- `handTier`: one of 9 values from `HandTier` type
- `facingBet`: `"bet"` | `"nobet"`

Examples:
- `"IP_flop_ws0_top_pair_gk_nobet"` → IP, dry board, top pair GK, no bet to act on
- `"OOP_turn_ws2_draw_bet"` → OOP, semi-wet turn, draw hand, facing a bet

```typescript
export function buildGtoKey(
  position: string,
  street: string,
  board: BoardTexture,
  handTier: HandTier,
  facingBet: boolean
): string;
```

IP/OOP derivation: `position === "BTN" || position === "CO"` when aggressor is in blinds → IP; otherwise look at position relative to last aggressor from preflop.

#### 1.3 — Populate tables from reference doc

**File: `lib/poker/gto/tables.ts`** (new)

Encode constants from `gto-postflop-rule-engine.md` sections 2, 3, 4, 5, 7 as a `Map<string, GtoEntry>`.

Key spots to encode (minimum viable table, ~120 entries):

| Scenario | Action | Freq | Sizing |
|---|---|---|---|
| IP, dry (ws0), any tier, nobet | BET | 0.80 | 0.33 |
| IP, semi (ws2), strong, nobet | BET | 0.65 | 0.50 |
| IP, wet (ws3), strong, nobet | BET | 0.55 | 0.66 |
| IP, monotone, any, nobet | BET | 0.45 | 0.33 |
| IP, paired high, any, nobet | BET | 0.82 | 0.33 |
| OOP, dry, any, nobet | BET | 0.40 | 0.33 |
| OOP, wet, any, nobet | BET | 0.22 | 0.33 |
| IP, any, weak/air, nobet | CHECK | 0.80 | 0 |
| IP, any, draw (8+ outs), bet | CALL | 0.75 | 0 |
| OOP, wet, draw 12+, any | RAISE | 0.70 | 2.5x |
| River, any, air, nobet | CHECK | 0.85 | 0 |
| River, any, nut, nobet | BET | 0.90 | 0.75 |

(Full table: combine all tiers × textures × positions × streets per the reference doc constants.)

```typescript
export const GTO_TABLE: Map<string, GtoEntry> = new Map([
  ["IP_flop_ws0_nut_nobet",           { action: "BET",   frequency: 0.90, sizingFraction: 0.33, source: "gto-postflop-rule-engine.md §2" }],
  ["IP_flop_ws0_top_pair_gk_nobet",   { action: "BET",   frequency: 0.80, sizingFraction: 0.33, source: "gto-postflop-rule-engine.md §2" }],
  // ... ~120 entries
]);
```

#### 1.4 — Lookup function

**File: `lib/poker/gto/lookup.ts`** (new)

```typescript
export function lookupGtoSpot(
  position: string,
  board: BoardTexture,
  hand: HandEvaluation,
  facingBet: boolean,
  state: RuleTreeInput
): GtoTableLookupResult;
```

Returns `{ hit: true, entry }` on exact match, `{ hit: false }` on miss. No fuzzy matching for v1 — clean miss means fall-through to Phase 4.

#### 1.5 — Wire into Phase 3 in `poker-content.ts`

**File: `extension/src/poker-content.ts`** (modify `processGameState()`)

Insert between Phase 2 and Phase 4:

```typescript
// Phase 3 — GTO lookup
if (autopilotMode !== "off" && state.communityCards.length >= 3) {
  const gtoResult = lookupGtoSpot(position, boardTexture, hand, facingBet, ruleInput);
  if (gtoResult.hit && gtoResult.entry.frequency >= 0.70) {
    // High-confidence GTO action — execute directly
    safeExecuteAction(gtoResult.entry.action, gtoResult.entry.sizingFraction * state.pot);
    return;
  }
  // Store partial result for arbitration in Phase 4
  ruleInput.gtoHint = gtoResult.hit ? gtoResult.entry : null;
}
```

Add `gtoHint?: GtoEntry | null` to `RuleTreeInput`.

---

### Phase 2: Feature A — Equity Engine

#### 2.1 — Install library

```bash
bun add poker-odds-calculator
```

Verify: import in `app/api/` context (Node.js), confirm not needed in browser bundle.

#### 2.2 — `/api/equity` endpoint

**File: `app/api/equity/route.ts`** (new)

```typescript
import { OddsCalculator, CardGroup, Board } from "poker-odds-calculator";

export const maxDuration = 10;

POST /api/equity
Body: { heroCards: string[], communityCards: string[], villainCombos?: string[] }
Response: { equity: number, confidence: number }
```

- `heroCards`: e.g. `["Ah", "Kd"]`
- `communityCards`: 3–5 cards
- `villainCombos`: array of combo strings from `VillainRange.combos`; if omitted, compute vs random hand

Card format: needs conversion from our `"10s"` → `"Ts"` format because the library uses `T` for ten. Add a `convertCardFormat(card: string): string` helper.

#### 2.3 — Equity buckets and bet sizing

**File: `lib/poker/equity/buckets.ts`** (new)

```typescript
export type EquityBucket =
  | "dominating"   // >65%: value bet large
  | "ahead"        // 50-65%: value bet medium or check
  | "marginal"     // 40-50%: check or thin value
  | "drawing"      // 25-40%: call if odds met, bluff if fold equity
  | "behind"       // <25%: fold or bluff (river)

export function classifyEquity(equity: number): EquityBucket;

// Sizing per bucket AND board texture
export function betSizingFromEquity(
  bucket: EquityBucket,
  board: BoardTexture,
  street: "flop" | "turn" | "river",
  position: "IP" | "OOP"
): number; // fraction of pot
```

Sizing table (composing equity bucket with wetness parabola from reference doc):

| Bucket | ws0 | ws2 | ws3–4 | River |
|---|---|---|---|---|
| dominating | 0.33 | 0.50 | 0.66 | 0.75 |
| ahead | 0.33 | 0.33 | 0.50 | 0.50 |
| marginal | 0 (check) | 0 (check) | 0 (check) | 0 |
| drawing | 0.50 (semi-bluff) | 0.66 | 0.66 | 0 |
| behind | 0 | 0 | 0 | 0.66 (bluff) or 0 |

#### 2.4 — Arbitration function

**File: `lib/poker/gto/arbitrate.ts`** (new)

```typescript
export function arbitrate(
  gtoHint: GtoEntry | null,
  equityBucket: EquityBucket,
  board: BoardTexture,
  hand: HandEvaluation,
  state: RuleTreeInput
): { action: string; sizingFraction: number; source: "gto" | "equity" | "ruletree" };
```

Logic:
1. If `gtoHint` and `gtoHint.frequency >= 0.70` → return GTO action with equity-adjusted sizing
2. If `gtoHint` and `0.40 <= frequency < 0.70` → use equity bucket to choose between GTO's top actions
3. No GTO hint or freq < 0.40 → use equity bucket directly
4. Return `source` tag for debugging overlay

#### 2.5 — Wire into `processGameState()`

**File: `extension/src/poker-content.ts`**

At Phase 4 entry, fetch equity from `/api/equity` and pass `rangeEquity` into `RuleTreeInput`:

```typescript
// Before Phase 4:
const villainRange = opponentVillainRange ?? DEFAULT_VILLAIN_RANGE;
const equityResp = await fetch(`${API_BASE}/api/equity`, {
  method: "POST",
  body: JSON.stringify({ heroCards, communityCards, villainCombos: villainRange.combos })
});
const { equity } = await equityResp.json();

ruleInput.rangeEquity = equity;
ruleInput.villainRange = villainRange;
```

In `applyRuleTree()` at line 97, replace:
```typescript
const rawEquity = exactOutEquity(adjustedOuts, seenCount, streetsLeft);
```
with:
```typescript
const rawEquity = input.rangeEquity ?? exactOutEquity(adjustedOuts, seenCount, streetsLeft);
```

Keep `exactOutEquity` as fallback for when the API call fails or times out.

#### 2.6 — Update the debug overlay

Show equity % and source (`"gto" | "equity" | "ruletree"`) in the existing autopilot recommendation overlay.

---

### Phase 3: Feature B — Opponent Stats Engine

#### 3.1 — DOM scraping of opponent actions

**File: `extension/src/poker-content.ts`** (modify)

The poker client renders action announcements in a `div.action-log` or similar element. Survey the DOM to find the selector — add to the existing `scrapeTableStats()` pattern.

Add a new function `scrapeOpponentActions()` that runs alongside the existing state scrape on every tick. It should:

1. Find new action entries since last tick (compare to cached last-seen action text)
2. Parse action text: `"Player 3 raises to €0.12"` → `{ seat: 3, action: "RAISE", amount: 0.12 }`
3. Map `seat` to `OpponentProfile`
4. Push a `StructuredAction` into `session.opponents[seat].structuredActions`

```typescript
interface ParsedAction {
  seat: number;
  action: "FOLD" | "CALL" | "RAISE" | "BET" | "CHECK";
  amount?: number;
  street: "PREFLOP" | "FLOP" | "TURN" | "RIVER";
}

function scrapeOpponentActions(currentStreet: Street): ParsedAction[];
```

**Note:** The exact DOM selector must be determined empirically by inspecting the live poker client. This is the highest-uncertainty step in Feature B. Plan for a scraping trial phase.

#### 3.2 — Opponent stats module

**File: `lib/poker/opponent-stats.ts`** (new)

```typescript
export interface OpponentStats {
  vpip: number;       // 0–1 (voluntarily put money in preflop %)
  pfr: number;        // 0–1 (preflop raise %)
  af: number;         // aggression factor: (bets+raises) / (calls+checks)
  handsObserved: number;
  confidence: number; // from sampleConfidenceMultiplier()
}

export function computeStats(actions: StructuredAction[], handsObserved: number): OpponentStats;

// Converts stats to villain range for equity engine
export function statsToVillainRange(stats: OpponentStats): VillainRange;
```

VPIP definition: VPIP = actions where `isVpip === true` / `handsObserved`.
PFR definition: PREFLOP RAISE actions / `handsObserved`.
AF definition: (BET + RAISE) / max(1, CALL + CHECK) — across all streets.

#### 3.3 — `/api/stats` endpoint

**File: `app/api/stats/route.ts`** (new)

```typescript
GET /api/stats?username=Player3
Response: { stats: OpponentStats | null, handsFound: number }
```

Reads `data/hands/**/*.json`, filters by `opponentHistory[*].username === username`, aggregates structured actions, computes stats via `computeStats()`.

**Extension calls this at hand start** (when `state.phase === "PREFLOP"` and we have opponent usernames), like it calls `/api/persona`.

#### 3.4 — Wire villain range into Phase 4

**File: `extension/src/poker-content.ts`**

At hand start (PREFLOP phase), fetch stats for each visible opponent and cache them:

```typescript
const seatStats: Record<number, OpponentStats> = {};
for (const seat of visibleOpponentSeats) {
  if (opponentUsernames[seat]) {
    const resp = await fetch(`${API_BASE}/api/stats?username=${opponentUsernames[seat]}`);
    const { stats } = await resp.json();
    if (stats) seatStats[seat] = stats;
  }
}
```

When building `ruleInput` for postflop, identify the main villain (last aggressor or seat to act on hero):
```typescript
const mainVillainStats = seatStats[mainVillainSeat];
opponentVillainRange = mainVillainStats
  ? statsToVillainRange(mainVillainStats)
  : DEFAULT_VILLAIN_RANGE;
```

---

## File Change Summary

### New files

| File | Purpose |
|------|---------|
| `lib/poker/villain-range.ts` | `VillainRange` type + `vpipToRange()` |
| `lib/poker/equity/buckets.ts` | Equity buckets + bet sizing |
| `lib/poker/gto/types.ts` | `GtoEntry`, `GtoTableLookupResult` |
| `lib/poker/gto/key.ts` | Key serialization, IP/OOP derivation |
| `lib/poker/gto/tables.ts` | Pre-populated lookup table (~120 entries) |
| `lib/poker/gto/lookup.ts` | `lookupGtoSpot()` |
| `lib/poker/gto/arbitrate.ts` | `arbitrate()` function |
| `lib/poker/opponent-stats.ts` | `computeStats()`, `statsToVillainRange()` |
| `app/api/equity/route.ts` | Equity computation endpoint |
| `app/api/stats/route.ts` | Opponent stats endpoint |

### Modified files

| File | Change |
|------|--------|
| `lib/poker/rule-tree.ts` | Add `rangeEquity`, `villainRange`, `gtoHint` to `RuleTreeInput`; use `rangeEquity` in line 97 |
| `lib/storage/sessions.ts` | Add `StructuredAction` + `structuredActions[]` to `OpponentProfile` |
| `extension/src/poker-content.ts` | Phase 3 GTO lookup, equity fetch, opponent action scraping, villain range cache |

---

## Acceptance Criteria

### Feature A
- [x] `/api/equity` returns correct equity for a sample hand (e.g. `AhKd` on `Qs Jh 7c` board vs top-25% range ≈ 48%)
- [x] `EquityBucket` correctly classifies 0.40 → `"marginal"`, 0.67 → `"dominating"`
- [x] `betSizingFromEquity("dominating", ws2, "flop", "IP")` → 0.50
- [x] Extension produces a recommendation on flop that uses `rangeEquity` (visible in overlay as "equity" source)
- [x] Falls back to outs-based equity on API timeout (timeout: 3s)

### Feature B
- [x] `computeStats()` returns correct VPIP for 10 actions: 3 preflop raises + 2 calls + 5 folds = 0.50
- [ ] `scrapeOpponentActions()` parses "Player 3 raises to €0.12" into `{ seat: 3, action: "RAISE", amount: 0.12 }` — **deferred: DOM selector unknown, requires empirical inspection of live poker client (Open Question 1)**
- [x] `/api/stats?username=X` returns aggregated stats across all stored hand records
- [x] Villain range in Phase 4 reflects a tight opponent's VPIP (15%) as narrower than random range
- [x] Minimum sample gate: below 8 hands observed, falls back to default random range

### Feature C
- [x] `lookupGtoSpot("BTN", ws0 board, top_pair_gk, false)` → `{ hit: true, entry: { action: "BET", freq: 0.80, sizing: 0.33 } }`
- [x] `lookupGtoSpot(...)` returns `{ hit: false }` for a key not in table
- [x] Phase 3 in `processGameState()` intercepts a clear GTO spot (freq ≥ 0.70) and returns without reaching Phase 4
- [x] Phase 3 falls through to Phase 4 on a miss
- [x] `arbitrate()` returns `"gto"` source for high-frequency GTO hits, `"equity"` for mixed spots

### Integration
- [x] On a dry-board nut hand (nut flush on K72r): Phase 3 hits (freq 0.82), returns BET 33% — equity confirms (equity ≈ 0.85 → "dominating")
- [x] On a wet-board medium hand (middle pair on 876): Phase 3 hits (freq 0.55, mixed), equity is 0.44 ("marginal"), arbitrate returns CHECK
- [x] Overlay shows `source: "gto"`, `"equity"`, or `"ruletree"` per recommendation
- [x] No regression in preflop fast-path (Phases 1–2 unaffected)

---

## Open Questions

1. **DOM selector for action log**: Which element in the poker client DOM renders "Player 3 raises to €0.12"? Needs empirical inspection. If not accessible, Feature B's data collection falls back to Claude analysis results only — reducing accuracy.

2. **Multi-way pots**: Equity vs two villains is not simply the sum. For v1, compute equity vs the main villain only (last aggressor) in multi-way pots. Note in overlay when multi-way.

3. **River bluffing**: The equity bucket `"behind"` maps to a bluff if fold equity > (1 - equity). Fold equity is not computed anywhere. For v1, use a heuristic: if villain VPIP < 25% (nitty), fold equity = 0.40; default = 0.25. Track as a follow-up improvement.

4. **Card format conversion**: `node-poker-odds-calculator` uses `T` not `10`. Need `convertCardFormat()` utility. Must be in server-side code only (library is Node.js).

5. **GTO table completeness**: The initial ~120 entries cover common spots. Many spots will miss and fall through to Phase 4. Track miss rate in production to identify which entries to add.

---

## Dependencies

- `bun add poker-odds-calculator` — MIT, TypeScript, enumeration-based
- No new dev dependencies

## Related Docs

- `docs/solutions/implementation-patterns/gto-postflop-rule-engine.md` — seed data for Phase 1
- `docs/brainstorms/2026-02-26-open-source-poker-research-brainstorm.md` — OSS research and chosen approaches
- `lib/poker/rule-tree.ts` — primary postflop hook point
- `extension/src/poker-content.ts` — decision pipeline, Phase 3 insertion point
