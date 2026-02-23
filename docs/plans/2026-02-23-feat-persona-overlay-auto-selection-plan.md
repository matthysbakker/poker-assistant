---
title: "feat: Persona Auto-Selection in Overlay Based on Table Temperature"
type: feat
date: 2026-02-23
---

# feat: Persona Auto-Selection in Overlay Based on Table Temperature

## Overview

Add intelligent persona recommendations to the live poker overlay and the Next.js analysis page. The system reads the session's accumulated opponent type data (already tracked in `lib/storage/sessions.ts`) to derive a **table temperature** (tight-passive, loose-aggressive, etc.), then selects the most exploitative persona for that table profile.

When two personas are equally suited, they are **randomly rotated per hand** — preventing regulars from reading the hero's style over multiple sessions.

---

## Problem Statement

Personas currently live in a static 2×2 grid (`PersonaComparison`) on the Next.js page — all 4 are shown with equal weight, and the player has to mentally pick one. The extension overlay shows no persona data at all.

Two gaps:
1. **No guidance**: the player sees 4 choices but gets no recommendation for the current table.
2. **Overlay blind spot**: while playing in monitor/play mode (DOM autopilot), the overlay shows hero cards and actions but no persona context.

---

## Proposed Solution

### Table Temperature

Derive a single table profile from the existing session opponent data (`getSession().opponents`). Each opponent has an `inferredType` from Claude's analysis (`TIGHT_PASSIVE`, `TIGHT_AGGRESSIVE`, `LOOSE_PASSIVE`, `LOOSE_AGGRESSIVE`, `UNKNOWN`). Count and classify:

| Profile | Trigger condition |
|---|---|
| `tight_passive` | >50% of known opponents are TIGHT_PASSIVE |
| `loose_passive` | >50% are LOOSE_PASSIVE |
| `tight_aggressive` | >50% are TIGHT_AGGRESSIVE |
| `loose_aggressive` | >50% are LOOSE_AGGRESSIVE |
| `balanced` | No clear majority (mixed table) |
| `unknown` | <3 opponents with known types |

### Persona Selection Matrix

| Table Temperature | Best Persona(s) | Why |
|---|---|---|
| `tight_passive` | **Exploit Hawk** + **LAG Assassin** | They fold too much — steal aggressively |
| `loose_passive` | **TAG Shark** | They call too much — pure value betting |
| `tight_aggressive` | **GTO Grinder** + **TAG Shark** | They fight back — stay unexploitable, solid |
| `loose_aggressive` | **GTO Grinder** | They bluff too much — GTO is non-exploitable |
| `balanced` / `unknown` | **GTO Grinder** | Safe default, exploits no specific leak but avoids all leaks |

### Random Rotation (Deception Layer)

When 2+ personas tie in the selection matrix, **randomly rotate one per hand**. Rotation triggers at PREFLOP start (when `HandState.street` transitions from WAITING). The selected persona is locked for the duration of that hand and stored in a React ref (not state, to avoid re-renders).

This makes the hero's style unreadable over many hands at the same table.

### Two Display Surfaces

**A. Next.js analysis page** (screenshot / continuous capture path):
- `PersonaComparison` gets a new `recommendedPersonaId` prop
- Recommended persona card gets a highlighted "▶ Recommended" badge
- A "Table: tight-passive (4 reads)" chip appears above the grid

**B. Extension overlay** (DOM autopilot monitor/play mode):
- After each Claude analysis on the page, a `PERSONA_RECOMMENDATION` postMessage is sent back to the content script
- Content script stores the recommendation and adds it as a compact line to the overlay:
  ```
  ─────────────────────
  Exploit Hawk → RAISE   [tight table]
  ```

---

## Technical Considerations

### Data already available

- `lib/storage/sessions.ts:47` — `updateOpponentProfiles()` already stores `inferredType` per opponent after every Claude analysis
- `lib/storage/sessions.ts:21` — `getSession()` reads from `sessionStorage` — available anywhere in the Next.js page context
- `components/analyzer/AnalysisResult.tsx:181` — `PersonaComparison` is already mounted at the right place, preflop only
- `extension/src/poker-content.ts:47` — content script already handles page→extension messages but currently only receives `CAPTURE` / `FRAME` / `EXTENSION_CONNECTED`

### Message flow for extension overlay

```
app/page.tsx
  └─ after handleOpponentsDetected fires (each analysis completes)
     └─ compute selectedPersona via selectPersona(temperature, heroCards, position)
        └─ window.postMessage({ source: "poker-assistant-app", type: "PERSONA_RECOMMENDATION",
                                 personaName, action, temperature })

poker-content.ts
  └─ window.addEventListener("message") — listens for source: "poker-assistant-app"
     └─ stores { personaName, action, temperature } in module-level variable
        └─ next updateOverlay() call renders the persona line
```

> **Note:** The content script runs in the poker site's context. It can receive `window.postMessage` from the Next.js tab via the background relay — or directly if the user has the poker site and app open simultaneously (same-tab injection). The exact channel depends on whether DOM autopilot and screenshot capture are used together. If the page is not open, the overlay shows `Persona: —` gracefully.

### Extension build

`bun build extension/src/poker-content.ts` already bundles transitive imports. Adding an import from `lib/poker/personas.ts` is safe if needed for local fallback lookup. However, the preferred approach is postMessage (no duplication of the 4,056-data-point chart bundle in every extension build).

### Random rotation seeding

- Use `Math.random()` — not seeded. Each hand gets a fresh roll.
- Store result in a `useRef<string | null>` (`lockedPersonaRef`) in the component that manages `handState`
- Reset to `null` on `WAITING → PREFLOP` transition, then assign immediately
- This avoids state re-render churn and stale closure issues (same pattern as `detectingRef`)

### Preflop-only scope

Persona charts only cover preflop RFI situations. The recommendation is shown only when `street === "PREFLOP"` — same gating as the existing `PersonaComparison`. On flop/turn/river, the overlay line is hidden (not replaced with a postflop guess).

---

## Acceptance Criteria

### Functional

- [ ] `deriveTableTemperature(session)` correctly classifies tables with ≥3 known opponents
- [ ] `selectPersona(temperature, heroCards, position)` returns the correct persona per matrix
- [ ] When 2 personas tie, `selectPersona()` randomly returns one of them (50/50 over many calls)
- [ ] The same persona is locked for the duration of a single hand (no mid-hand flip)
- [ ] When table temperature is `unknown`, GTO Grinder is always selected
- [ ] `PersonaComparison` highlights the recommended persona with a clear visual indicator
- [ ] The temperature chip shows count of opponent reads (e.g., "tight-passive · 4 reads")
- [ ] Extension overlay renders persona name + action for PREFLOP hands
- [ ] Extension overlay gracefully shows `—` when no recommendation is available
- [ ] No persona recommendation is shown postflop

### Quality

- [ ] `lib/poker/table-temperature.ts` has unit tests covering all 6 temperature profiles
- [ ] `lib/poker/persona-selector.ts` has unit tests for each matrix cell + random rotation
- [ ] `PersonaComparison` visual change does not break existing snapshot/display tests
- [ ] Rotation does not cause re-renders (verified by checking `lockedPersonaRef` is a ref, not state)

---

## Implementation Phases

### Phase 1 — Core Logic (no UI changes)

**New:** `lib/poker/table-temperature.ts`

```typescript
// lib/poker/table-temperature.ts
export type TableTemperature =
  | "tight_passive"
  | "tight_aggressive"
  | "loose_passive"
  | "loose_aggressive"
  | "balanced"
  | "unknown";

export interface TableProfile {
  temperature: TableTemperature;
  reads: number; // number of opponents with known type
}

export function deriveTableTemperature(
  opponents: Record<number, { inferredType: string; handsObserved: number }>
): TableProfile
```

**New:** `lib/poker/persona-selector.ts`

```typescript
// lib/poker/persona-selector.ts
export interface SelectedPersona {
  persona: Persona;
  action: PersonaAction;
  alternatives: Persona[]; // other equally valid personas (for display)
  rotated: boolean;        // true when this was a random pick from alternatives
}

export function selectPersona(
  temperature: TableTemperature,
  heroCards: string,
  position: ChartPosition,
  rng?: () => number,     // injectable for tests
): SelectedPersona | null
```

### Phase 2 — Next.js Page Integration

**Modified:** `app/page.tsx`
- After `handleOpponentsDetected`, call `selectPersona()` and store result in a `useRef` (locked for the hand)
- Reset `lockedPersonaRef.current` on `WAITING → PREFLOP` transition
- Pass `recommendedPersonaId` down to `AnalysisResult`

**Modified:** `components/analyzer/AnalysisResult.tsx:181`
- Add `recommendedPersonaId?: string` to props
- Pass through to `PersonaComparison`

**Modified:** `components/analyzer/PersonaComparison.tsx`
- Add `recommendedPersonaId?: string` + `tableTemperature?: TableProfile` props
- Render a `▶ Recommended` badge on the matching card
- Show temperature chip: `tight-passive · 4 reads` above the grid

### Phase 3 — Extension Overlay

**Modified:** `app/page.tsx`
- After computing `selectedPersona`, `window.postMessage` a `PERSONA_RECOMMENDATION` event:
  ```typescript
  window.postMessage({
    source: "poker-assistant-app",
    type: "PERSONA_RECOMMENDATION",
    personaName: selectedPersona.persona.name,
    action: selectedPersona.action,
    temperature: profile.temperature,
    reads: profile.reads,
  }, window.location.origin);
  ```

**Modified:** `extension/src/poker-content.ts`
- Add `window.addEventListener("message")` (or extend existing handler if one exists)
- Store `lastPersonaRec: { name, action, temperature } | null` at module level
- Extend `updateOverlay()` to render a persona line when `isHeroTurn` and preflop state is active:
  ```
  ─────────────────────
  Exploit Hawk → RAISE  [tight]
  ```
- Clear `lastPersonaRec` on mode change to `"off"`

### Phase 4 — Polish

- Add `rotated: true` indicator in `PersonaComparison` (e.g., small "↻ rotated" text on recommended card)
- Ensure temperature reads are reset when `resetSession()` is called
- Document the selection matrix in a comment block in `persona-selector.ts`

---

## Files Touched

| File | Change |
|---|---|
| `lib/poker/table-temperature.ts` | **NEW** — temperature derivation logic |
| `lib/poker/persona-selector.ts` | **NEW** — persona selection matrix + rotation |
| `app/page.tsx:82` | Compute + lock persona after `handleOpponentsDetected` |
| `app/page.tsx:47` | Send `PERSONA_RECOMMENDATION` postMessage |
| `components/analyzer/AnalysisResult.tsx:181` | Pass `recommendedPersonaId` to `PersonaComparison` |
| `components/analyzer/PersonaComparison.tsx` | Add recommended badge + temperature chip |
| `extension/src/poker-content.ts:674` | Receive persona rec + extend `updateOverlay()` |

---

## Out of Scope

- Postflop persona guidance (no charts exist)
- DOM autopilot deriving table temperature independently from scraped DOM data
- Tournament mode (stack-dependent) personas
- User ability to manually override the auto-selected persona (future)
- Persisting persona history to `localStorage` across sessions

---

## Open Questions

1. Should the extension overlay show the persona even when `isHeroTurn === false`? (Could be useful as ambient info while waiting for turn.)
2. Should `rotated: true` be surfaced to the user, or stay hidden? Showing it might be educational ("I rotated to LAG Assassin to stay unpredictable") but adds visual noise.
3. If the page is closed and the user only uses the DOM autopilot, should the content script do a local fallback persona lookup (GTO Grinder by default) rather than show `—`?

---

## References

- `lib/storage/sessions.ts:47` — `updateOpponentProfiles()` (existing opponent tracking)
- `lib/poker/persona-lookup.ts:16` — `getPersonaRecommendations()` (existing chart lookup)
- `components/analyzer/PersonaComparison.tsx` — current 2×2 persona grid
- `components/analyzer/AnalysisResult.tsx:181` — where `PersonaComparison` is mounted
- `extension/src/poker-content.ts:674` — `updateOverlay()` (current overlay renderer)
- `app/page.tsx:82` — `handleOpponentsDetected` (trigger point for persona selection)
- Brainstorm: `docs/brainstorms/2026-02-19-profitable-poker-personas-brainstorm.md`
