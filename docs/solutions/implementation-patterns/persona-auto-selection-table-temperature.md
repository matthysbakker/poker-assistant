---
title: "Persona Auto-Selection Based on Table Temperature"
date: 2026-02-23
category: implementation-patterns
module: poker/personas
problem_type: best_practice
component: service_object
symptoms:
  - "PersonaComparison shows all 4 personas with equal weight — no guidance on which to follow"
  - "Extension overlay shows hero cards and pot but no persona context during live play"
  - "Player has to mentally select a strategy without knowing the table profile"
root_cause: missing_tooling
resolution_type: code_fix
severity: medium
tags: [personas, table-temperature, auto-selection, rotation, overlay, session-tracking, deception]
---

# Persona Auto-Selection Based on Table Temperature

## Problem

The persona comparison grid showed all 4 profitable archetypes simultaneously with equal visual weight. The player had to mentally decide which persona to follow without any context about the current table. Additionally, the extension overlay showed zero persona data — a live player in monitor/play mode had no in-game guidance at all.

Two related gaps:
1. **No recommendation**: "Which of these 4 should I use right now?" was unanswered
2. **Overlay blind spot**: The DOM overlay rendered cards, pot, and turn status but nothing about strategy

## Root Cause

The session tracker (`lib/storage/sessions.ts`) was already accumulating opponent player types via `updateOpponentProfiles()` after each Claude analysis. This data (TIGHT_PASSIVE, LOOSE_AGGRESSIVE, etc.) was never used to inform the persona display — it was only used to build the context string sent to Claude. The connection between "what kind of opponents are at this table" and "which persona to play" was missing entirely.

## Solution

### New module: `lib/poker/table-temperature.ts`

Derives a `TableProfile` from the session's opponent data. Needs ≥3 known (non-UNKNOWN) opponents. Requires strict majority (>50%) to declare a temperature. Ties fall through to "balanced".

```typescript
export type TableTemperature =
  | "tight_passive" | "tight_aggressive"
  | "loose_passive" | "loose_aggressive"
  | "balanced" | "unknown";

export interface TableProfile {
  temperature: TableTemperature;
  reads: number; // opponents with known (non-UNKNOWN) type
}

export function deriveTableTemperature(
  opponents: Record<number, { inferredType: string }>,
): TableProfile
```

**Selection matrix rationale:**

| Table temperature | Best persona(s) | Why |
|---|---|---|
| `tight_passive` | Exploit Hawk + LAG Assassin | They fold too much — steal aggressively |
| `loose_passive` | TAG Shark | They call too much — pure value betting |
| `tight_aggressive` | GTO Grinder + TAG Shark | They fight back — stay unexploitable |
| `loose_aggressive` | GTO Grinder | They bluff too much — GTO is non-exploitable |
| `balanced` / `unknown` | GTO Grinder | Safe default |

### New module: `lib/poker/persona-selector.ts`

Maps temperature to candidate personas, then handles single vs. tied selection.

```typescript
export interface SelectedPersona {
  persona: Persona;
  action: PersonaAction;
  alternatives: Persona[];  // other equally valid personas
  rotated: boolean;         // true when randomly chosen from tied candidates
}

export function selectPersona(
  temperature: TableTemperature,
  heroCards: string,
  position: ChartPosition,
  rng: () => number = Math.random,  // injectable for tests
): SelectedPersona | null
```

**Random rotation for deception:** When two personas tie (e.g. `tight_passive` → Exploit Hawk or LAG Assassin), one is randomly picked per hand. `Math.random()` is NOT seeded — each hand gets a fresh roll. This prevents regulars from reading the hero's style over multiple hands at the same table.

The `rng` parameter is injectable for deterministic tests:
```typescript
// Test: rng=0 picks first candidate, rng=0.99 picks last
const first = selectPersona("tight_passive", "Ah Kd", "BTN", () => 0);
const last = selectPersona("tight_passive", "Ah Kd", "BTN", () => 0.99);
expect(first!.persona.id).not.toBe(last!.persona.id);
```

### Locking per-hand in `app/page.tsx`

The persona is computed once at PREFLOP start and locked until the hand ends. Avoids mid-hand recalculation when new opponent data arrives.

```typescript
// Computed once per hand, cleared on WAITING
const [selectedPersona, setSelectedPersona] = useState<SelectedPersona | null>(null);
const prevStreetRef = useRef(handState.street);

useEffect(() => {
  const prev = prevStreetRef.current;
  prevStreetRef.current = handState.street;

  if (handState.street === "PREFLOP" && prev === "WAITING") {
    const session = getSession();
    const profile = deriveTableTemperature(session.opponents);
    const selection = selectPersona(
      profile.temperature,
      handState.heroCards.join(" "),
      handState.heroPosition!,
    );
    setSelectedPersona(selection);

    // Notify extension overlay via postMessage
    if (selection) {
      window.postMessage({
        source: "poker-assistant-app",
        type: "PERSONA_RECOMMENDATION",
        personaName: selection.persona.name,
        action: selection.action,
        temperature: profile.temperature,
        reads: profile.reads,
      }, window.location.origin);
    }
  } else if (handState.street === "WAITING") {
    setSelectedPersona(null);
  }
}, [handState.street]);
```

**Why `useEffect` + `useState` (not just `useRef`):** The per-hand lock is enforced by only calling `setSelectedPersona` on the WAITING→PREFLOP transition. `useState` is required to trigger the UI re-render that propagates `recommendedPersonaId` to `PersonaComparison`. The `prevStreetRef` ensures we only react to the specific transition, not every render.

### Extension overlay: postMessage channel

The content script (`extension/src/poker-content.ts`) runs in the poker site's context — it cannot access `sessionStorage` from the Next.js app. The persona recommendation travels via `window.postMessage`.

```typescript
// In poker-content.ts — module-level state
interface PersonaRec { name: string; action: string; temperature: string; }
let lastPersonaRec: PersonaRec | null = null;

// Listener
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.source !== "poker-assistant-app") return;
  if (event.data.type === "PERSONA_RECOMMENDATION") {
    lastPersonaRec = { name: event.data.personaName,
                       action: event.data.action,
                       temperature: event.data.temperature };
  }
});
```

Overlay render (preflop only — no community cards yet):
```typescript
const isPreflop = state.communityCards.length === 0 && state.heroCards.length > 0;
const personaHtml = isPreflop && lastPersonaRec
  ? `<div>...<span>${lastPersonaRec.name}</span> → ${lastPersonaRec.action} [${lastPersonaRec.temperature}]</div>`
  : isPreflop ? `<div>Persona: —</div>` : "";
```

Clear on mode "off" to avoid stale recommendations across sessions:
```typescript
if (autopilotMode === "off") {
  lastPersonaRec = null;
  // ... remove overlay element
}
```

### `PersonaComparison` UI

Added `recommendedPersonaId` and `tableTemperature` props. Recommended persona gets indigo border + `▶` indicator. When `rotated: true`, shows `↻` instead. Temperature chip shows reads count.

```tsx
// Temperature chip (hidden when unknown/no reads)
{tableTemperature && tableTemperature.temperature !== "unknown" && (
  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
    {TEMPERATURE_LABELS[tableTemperature.temperature]} · {tableTemperature.reads} reads
  </span>
)}

// Recommended card
className={isRecommended
  ? "border-indigo-600/60 bg-indigo-950/30"
  : matchesAI ? "border-emerald-700/50 bg-emerald-950/20"
  : "border-zinc-800 bg-zinc-900/50"}

// Badge
{isRecommended && (
  <span className="text-xs text-indigo-400">{rotated ? "↻" : "▶"}</span>
)}
```

## Why This Works

1. **Data was already there**: `PokerSession.opponents` already stored `inferredType` per seat from each Claude analysis. The only missing piece was using it.

2. **Preflop-only is correct**: Persona charts only cover preflop RFI. Attempting postflop advice without charts would mislead. The `communityCards.length === 0` check in the overlay and `street === "PREFLOP"` in the component enforce this.

3. **Per-hand lock prevents confusion**: Without locking, the persona could flip mid-hand if new opponent data arrives (e.g., second Claude analysis sees the same player classified differently). Locking on WAITING→PREFLOP ensures the hero commits to one strategy per hand.

4. **Random rotation is meaningful deception**: `Math.random()` (unseeded) on every PREFLOP start means opponents who track patterns across 100+ hands can't predict whether you'll play TAG or GTO on this particular hand. This is meta-game theory: table-level randomisation against observant regulars.

5. **postMessage is the right channel for extension→page**: The content script is sandboxed from the Next.js app's `sessionStorage`. postMessage (same origin) is the correct IPC mechanism. The page sends `source: "poker-assistant-app"` and the content script filters on that to avoid false positives from third-party scripts.

## Prevention / Patterns to Follow

- **When adding session tracking to a feature, ask "who should consume this data?"** — session data should drive UI decisions, not just be passed to Claude as context strings.
- **Lock per-hand state on the WAITING→PREFLOP transition**, not on every render or every frame. Use `prevStreetRef` to detect the specific transition.
- **Use injectable `rng` for any randomness in library code** — `Math.random()` as a default, injectable for deterministic tests.
- **Preflop-only persona guidance** — never attempt to extrapolate postflop recommendations from RFI charts.
- **Clear extension state (`lastPersonaRec = null`) on mode changes** — stale state from a previous session can show wrong recommendations in the next session.
- **Temperature needs ≥3 reads for a confident classification** — with 1–2 observations, return `unknown` and default to GTO Grinder. Never guess a profile from a single opponent's classification.

## Files

| File | Role |
|---|---|
| `lib/poker/table-temperature.ts` | Derives `TableProfile` from session opponents |
| `lib/poker/persona-selector.ts` | Selection matrix + rotation logic |
| `lib/poker/__tests__/table-temperature.test.ts` | 10 unit tests (all 6 profiles, edge cases) |
| `lib/poker/__tests__/persona-selector.test.ts` | 18 unit tests (matrix, rotation, injectable rng) |
| `components/analyzer/PersonaComparison.tsx` | Added `recommendedPersonaId`, `tableTemperature`, `rotated` props |
| `components/analyzer/AnalysisResult.tsx` | Passes persona props through |
| `app/page.tsx` | Computes + locks persona per hand, sends postMessage |
| `extension/src/poker-content.ts` | Receives postMessage, extends overlay |

## Related Issues

- See also: [persona-design-profitable-archetypes.md](./persona-design-profitable-archetypes.md) — why personas are decoupled from opponent classification (prerequisite reading)
- See also: [continuous-capture-state-machine.md](./continuous-capture-state-machine.md) — the hand state machine that drives the WAITING→PREFLOP transition used to lock personas
