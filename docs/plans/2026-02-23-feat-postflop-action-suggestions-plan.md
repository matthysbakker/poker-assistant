---
title: "feat: Post-Flop Action Suggestions"
type: feat
date: 2026-02-23
---

# Post-Flop Action Suggestions

## Overview

The extension already calls Claude on every street (PREFLOP, FLOP, TURN, RIVER) whenever it detects the hero's action buttons. However, the current system is **preflop-optimised** — the AI schema, system prompt, and hand context accumulator all lack the inputs Claude needs to give high-quality post-flop decisions.

This plan upgrades the analysis pipeline to give Claude rich post-flop context: board texture, stack-to-pot ratio (SPR), pot odds, draw counting, action history from prior streets, and street-specific reasoning.

---

## Problem Statement

When the hero faces a flop c-bet, Claude only sees:

- A screenshot
- `"PREFLOP: Hero holds Ah Kd. FLOP: Board is Qs Jh 7c"`

It does **not** see:
- That the board is a two-tone connected wet texture
- That hero has 15 outs (flush + OESD)
- That the SPR is 4.2 (medium commitment)
- That hero is getting 2.5:1 (needs 29% equity to call profitably)
- That hero raised preflop from BTN, opponent defended BB
- What Claude recommended on the previous street

This results in generic advice ("call with your draw") that misses key post-flop concepts like semi-bluffing equity, SPR-based commitment, and range advantage.

---

## Proposed Solution

Three coordinated changes to the analysis pipeline:

1. **Schema extension** — add optional post-flop fields so Claude can return structured data for board texture, draws, SPR, pot odds, and facing-action
2. **System prompt extension** — add a post-flop analysis step guiding Claude to compute these fields when `street !== "PREFLOP"`
3. **Hand context enhancement** — store the previous street's Claude recommendation in `StreetSnapshot` and include action sequences in `buildHandContext()`

These changes are **additive and backwards-compatible**: all new fields are `optional()`, `DeepPartial` handles missing values in the UI, and the preflop path is unchanged.

---

## Technical Approach

### 1. Schema Extension (`lib/ai/schema.ts`)

Add optional post-flop fields to `handAnalysisSchema`. Per the known gotcha: **Zod `.describe()` strings are implicit LLM instructions** — each description must align with the system prompt.

```typescript
// lib/ai/schema.ts — additions to handAnalysisSchema

boardTexture: z.string().optional().describe(
  "Board texture description (e.g., 'Paired monotone', 'Rainbow dry board', 'Two-tone connected'). " +
  "Omit for preflop."
),

draws: z.string().optional().describe(
  "Active draws for hero: flush draws, straight draws, combo draws, backdoor draws, and total outs. " +
  "Example: 'Nut flush draw + OESD = 15 outs'. Omit if no relevant draws or preflop."
),

equityEstimate: z.string().optional().describe(
  "Hero's estimated equity vs opponent's likely range on this street. " +
  "Example: '~65% vs likely top-pair range'. Omit for preflop or if highly uncertain."
),

spr: z.string().optional().describe(
  "Stack-to-pot ratio (SPR): effective stack divided by pot size. " +
  "Example: 'SPR 4.2 — medium commitment, set/two-pair are committed'. Omit for preflop."
),

potOdds: z.string().optional().describe(
  "Pot odds if hero is facing a bet. Format: 'Getting 2.5:1, need 29% equity to call'. " +
  "Omit if hero is not facing a bet or preflop."
),

facingAction: z.string().optional().describe(
  "The action hero is currently facing (e.g., 'Facing a 2/3-pot c-bet', 'Facing a check-raise', " +
  "'First to act, no bet facing'). Omit for preflop."
),
```

### 2. System Prompt Extension (`lib/ai/system-prompt.ts`)

Add a **post-flop analysis block** after step 3 (exploit analysis) and before step 4 (recommend action). Both `SYSTEM_PROMPT` and `SYSTEM_PROMPT_WITH_DETECTED_CARDS` need updating.

**New analysis step (steps 3b — post-flop only):**

```
3b. POST-FLOP ANALYSIS (skip if street = PREFLOP):
  - Board texture: is it wet (connected/suited), dry (unconnected/rainbow), paired, or monotone?
    Wet boards favour the player with more draws (often the caller's range).
  - Identify hero's draws: flush draws (9 outs), open-ended straight draws (8), gutshots (4),
    combo draws (12-15). Mention nut draw vs weak draws.
  - Estimate equity vs likely opponent range given their position and prior actions.
  - Compute SPR: effective stack / pot size. Low SPR (<4) = commit; medium SPR (4-12) = proceed with care;
    high SPR (>12) = no commitment needed yet.
  - If facing a bet: state pot odds as a ratio and the equity needed to call profitably.
  - Identify whose range has the advantage on this board: did the preflop aggressor (likely c-betting)
    or the caller (floating/defending) connect better with the runout?
  - State what action hero is facing (c-bet, donk, check-raise, or no bet facing).
```

**Update step 4 (recommend action) to include post-flop sizing guidance:**

```
4. Recommend ONE action (FOLD, CHECK, CALL, BET, RAISE). If BET or RAISE:
   - Preflop: standard sizing (2.5x open, 3x 3-bet, etc.)
   - Flop/Turn: state sizing as fraction of pot (e.g., "2/3 pot"). Consider:
     • Polarized hands (strong made + bluffs) → larger sizing (3/4 to full pot)
     • Linear value range → smaller sizing (1/2 pot)
     • Semi-bluffs with strong equity → can bet larger (leverage fold equity + equity)
   - River: polarize — bet near-pot with strong hands/bluffs; check/fold marginal hands
```

### 3. Hand Context Enhancement

#### 3a. Store analysis in `StreetSnapshot` (`lib/hand-tracking/types.ts`)

The `StreetSnapshot` interface already has a placeholder `analysis?: HandAnalysis` field in the original plan but it was never implemented. Enable it:

```typescript
// lib/hand-tracking/types.ts
export interface StreetSnapshot {
  street: Street;
  heroCards: CardCode[];
  communityCards: CardCode[];
  timestamp?: number;
  analysis?: HandAnalysis;   // Already in original plan — wire it up
}
```

#### 3b. Store completed analysis result in state machine

When Claude finishes streaming (the `onAnalysisComplete` callback in `app/page.tsx`), dispatch an action to store the result into the current street's snapshot:

```typescript
// New action type
{ type: "ANALYSIS_COMPLETE"; analysis: HandAnalysis }

// In handReducer: find the snapshot for the current street and update it
case "ANALYSIS_COMPLETE":
  return {
    ...state,
    streets: state.streets.map(s =>
      s.street === state.street ? { ...s, analysis: action.analysis } : s
    ),
    analyzing: false,
  };
```

#### 3c. Enhance `buildHandContext()` (`lib/hand-tracking/use-hand-tracker.ts`)

Include the previous street's Claude recommendation so Claude has continuity:

```typescript
export function buildHandContext(state: HandState): string {
  const lines: string[] = [];
  if (state.heroPosition) {
    lines.push(`Hero position: ${state.heroPosition}.`);
  }
  for (const snap of state.streets) {
    if (snap.street === "PREFLOP") {
      lines.push(`PREFLOP: Hero holds ${snap.heroCards.join(" ")}.`);
      if (snap.analysis) {
        lines.push(`  → Claude recommended: ${snap.analysis.action}${snap.analysis.amount ? ` ${snap.analysis.amount}` : ""} (${snap.analysis.reasoning.slice(0, 120)}…)`);
      }
    } else if (snap.communityCards.length > 0) {
      lines.push(`${snap.street}: Board is ${snap.communityCards.join(" ")}.`);
      if (snap.analysis) {
        lines.push(`  → Claude recommended: ${snap.analysis.action}${snap.analysis.amount ? ` ${snap.analysis.amount}` : ""}`);
      }
    }
  }
  return lines.join(" ");
}
```

### 4. UI — Render Post-Flop Fields (`app/(components)/AnalysisResult.tsx`)

Add a collapsible "Post-Flop Analysis" section that shows when `object.street !== "PREFLOP"`. Only render when at least one post-flop field is present:

```tsx
// app/(components)/AnalysisResult.tsx

{object.street && object.street !== "PREFLOP" && (
  object.boardTexture || object.spr || object.draws || object.potOdds
) && (
  <PostFlopPanel
    boardTexture={object.boardTexture}
    draws={object.draws}
    equityEstimate={object.equityEstimate}
    spr={object.spr}
    potOdds={object.potOdds}
    facingAction={object.facingAction}
  />
)}
```

The `PersonaComparison` component already gates on `object.street === "PREFLOP"` — no change needed there. Post-flop suggestions come entirely from Claude.

---

## Acceptance Criteria

- [x] On FLOP, TURN, and RIVER, `AnalysisResult` shows a "Post-Flop Analysis" panel with at least `boardTexture`, `draws`, `spr`
- [x] When hero is facing a bet, `potOdds` and `facingAction` are populated in the response
- [x] When Claude finishes streaming on any street, the analysis is stored in the corresponding `StreetSnapshot`
- [x] On the TURN, `buildHandContext()` includes the PREFLOP and FLOP recommendations
- [x] On the RIVER, context includes PREFLOP, FLOP, and TURN recommendations
- [x] The `PersonaComparison` panel remains PREFLOP-only (no regression)
- [x] Preflop analysis output is unchanged (all new fields are optional, absent in preflop responses)
- [x] Continuous mode (Haiku) populates the core fields (`action`, `boardTexture`, `spr`) but may skip `concept` and `tip`

---

## Implementation Phases

### Phase 1 — Schema + Prompt (No State Changes)

**Files:** `lib/ai/schema.ts`, `lib/ai/system-prompt.ts`

- Add 6 optional fields to `handAnalysisSchema`
- Add post-flop analysis block to both system prompt variants
- Update step 4 sizing guidance

**Risk:** Low. All fields are optional. Zod `DeepPartial` on the client handles any field Claude omits.

**Validate:** Run the extension against a real post-flop screenshot. Check that Claude now populates `boardTexture`, `spr`, and `draws`. Compare reasoning quality vs baseline.

---

### Phase 2 — Store Analysis in StreetSnapshot

**Files:** `lib/hand-tracking/types.ts`, `lib/hand-tracking/state-machine.ts`, `app/page.tsx`

- Add `analysis?: HandAnalysis` to `StreetSnapshot` (it's already in the type spec; wire it up)
- Add `ANALYSIS_COMPLETE` action type to state machine
- Call dispatch in `app/page.tsx` when `useObject` finishes (the `onFinish` callback or when `isLoading` flips to false)

**Risk:** Low-medium. The state machine pattern is well-established. The dispatch must be reliable even if Claude errors out — add a `finally` guard.

---

### Phase 3 — Enhance `buildHandContext()`

**Files:** `lib/hand-tracking/use-hand-tracker.ts`

- Update `buildHandContext()` to iterate `state.streets` and append analysis summaries
- Truncate reasoning to ~120 chars to avoid bloating the context string
- Test with a 3-street hand to confirm the accumulated string looks sensible

**Risk:** Low. `buildHandContext()` is a pure function. Edge case: analysis stored with only partial fields (streaming interrupted) — only append if `snap.analysis?.action` is defined.

---

### Phase 4 — Post-Flop UI Panel

**Files:** `app/(components)/AnalysisResult.tsx` (or new `PostFlopPanel.tsx`)

- Add `PostFlopPanel` component rendering the 6 new fields
- Wire into `AnalysisResult` with the `street !== "PREFLOP"` guard
- Style to match existing card/analysis sections (Tailwind v4)

**Risk:** Low. Purely additive UI. Use optional chaining throughout — `DeepPartial` means fields can be `undefined` mid-stream.

---

## Dependencies

- Phases 1 and 2 are independent and can be built in parallel
- Phase 3 requires Phase 2 (needs `analysis` stored in snapshot before building context)
- Phase 4 requires Phase 1 (needs schema fields defined before rendering them)

---

## Out of Scope

- **Static post-flop charts per persona** — requires a large decision matrix (c-bet frequencies, barrel frequencies, check-raise tendencies per board texture). Defer.
- **Bet amount OCR** — accurately reading raise sizes from the screenshot for precise pot odds calculation. Currently Claude estimates from the screenshot; OCR would make it exact. Defer.
- **Facing-raise preflop charts** (3-bet/call ranges) — a separate chart set from RFI. Defer.
- **Opponent showdown history tracking** — updating opponent profiles when cards are revealed. Defer.

---

## Risks & Gotchas

| Risk | Mitigation |
|------|-----------|
| `spr` / `potOdds` inaccurate (Claude estimates from screenshot) | Add `.describe()` note: "Estimate from visible stack/pot labels, state if approximate" |
| Analysis dispatch fires before `HandAnalysis` is fully resolved | Only dispatch on `onFinish` / when `isLoading === false && object.action !== undefined` |
| Context string grows too long across 4 streets | Truncate each `reasoning` to 120 chars; keep context to ~300 chars total |
| Schema `.describe()` strings conflict with system prompt | Review all new `.describe()` calls against system prompt wording before shipping |
| Continuous mode (Haiku) skips optional fields | Acceptable — core fields (`action`, `boardTexture`, `spr`) are compact enough for Haiku |
| Previous street analysis is wrong and fed back to Claude | Trust Claude's corrections; do not filter or validate stored analysis before re-feeding |

---

## References

- Schema: `lib/ai/schema.ts`
- System prompt: `lib/ai/system-prompt.ts`
- Hand tracker hook: `lib/hand-tracking/use-hand-tracker.ts`
- State machine: `lib/hand-tracking/state-machine.ts`
- Types: `lib/hand-tracking/types.ts`
- Analysis result UI: `app/(components)/AnalysisResult.tsx` (or `components/AnalysisResult.tsx`)
- Autopilot prompt (post-flop examples): `lib/ai/autopilot-prompt.ts:15-17`
- Continuous capture plan: `docs/plans/2026-02-18-feat-continuous-capture-hand-tracking-plan.md`
- Persona design learning: `docs/solutions/implementation-patterns/persona-design-profitable-archetypes.md`
- AI SDK streaming learning: `docs/solutions/implementation-patterns/ai-sdk-v6-streaming-structured-output.md`
