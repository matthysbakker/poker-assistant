---
module: Poker Assistant
date: 2026-02-24
problem_type: best_practice
component: development_workflow
symptoms:
  - "HandRecord JSON files are isolated snapshots — no way to link records from the same session or same hand"
  - "Cannot answer: which PREFLOP/FLOP/TURN/RIVER records belong to the same poker hand?"
  - "Table temperature and persona selection at decision time are discarded after use, not persisted"
  - "query-hands.ts shows aggregate statistics but cannot show a hand's full street-by-street progression"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: medium
tags: [hand-tracking, session-logging, context-pipeline, improvement-loop, state-machine, capture-context]
---

# Implementation Pattern: Wiring Cross-Cutting Context Through the Capture→Analyze Pipeline

## Problem

The poker assistant wrote `HandRecord` JSON files to disk on every analysis, but each record was an **isolated snapshot**. You could not answer:

- Which hands came from the same browser session?
- Which PREFLOP/FLOP/TURN/RIVER records belong to the same poker hand?
- What was the table temperature when Claude gave this advice?
- Which persona was auto-selected for this hand?

All of this data existed transiently in React state and the state machine, but was never persisted at write time.

## Environment

- Module: Poker Assistant (Next.js 16, App Router)
- Affected Components: state machine, `HandRecord`, API route, `AnalysisResult`, `page.tsx`, `query-hands.ts`
- Date: 2026-02-24

## Symptoms

- `data/hands/*.json` records have no `sessionId` or `pokerHandId` — cannot group by hand or session
- `tableTemperature` computed from `deriveTableTemperature()` but thrown away after `PersonaComparison` renders
- `selectPersona()` result posted to overlay but never written to disk
- `handState.heroPosition` available in state machine but not in `HandRecord`
- `scripts/query-hands.ts --group-by-hand` doesn't exist — only aggregate stats

## What Didn't Work

**Attempted: store VPIP/AF from DOM in `tableStats: { vpip, af }`**
- **Why it failed:** VPIP/AF are scraped by `poker-content.ts`, which is a content script running in the **poker table browser context** (e.g. GGPoker tab). The main assistant app at `localhost:3006` is a completely separate context. These numbers are never sent to `localhost:3006` via `window.postMessage`. The field had to be replaced with `tableReads: number` (count of classified opponents from `TableProfile.reads`), which IS available on the main page.

## Solution

### 1. Generate `pokerHandId` in the state machine at WAITING→PREFLOP

```typescript
// lib/hand-tracking/types.ts — add to HandState
pokerHandId: string | null;  // null in WAITING, UUID otherwise

// lib/hand-tracking/state-machine.ts — in INITIAL_STATE
pokerHandId: null,

// In handleDetection(), forward transition confirmation:
const pokerHandId =
  detectedStreet === "PREFLOP" && state.street === "WAITING"
    ? crypto.randomUUID()
    : state.pokerHandId;
return { ...state, street: detectedStreet, pokerHandId, ... };
```

All streets of the same hand share one `pokerHandId`. It clears to `null` when WAITING_HYSTERESIS resets state.

### 2. Extend `HandRecord` with linkage and context fields

```typescript
// lib/storage/hand-records.ts
export interface HandRecord {
  // ... existing fields ...

  // Linkage
  sessionId: string | null;      // From PokerSession.id in sessionStorage
  pokerHandId: string | null;    // Groups PREFLOP→FLOP→TURN→RIVER

  // Table context at decision time
  tableTemperature: TableTemperature | null;
  tableReads: number | null;     // Opponents that informed the temperature
  heroPositionCode: Position | null;
  personaSelected: {
    personaId: string;
    personaName: string;
    action: string;
    temperature: TableTemperature | null;
  } | null;
}
```

### 3. Wire a `CaptureContext` bag from `page.tsx` → `AnalysisResult` → POST body → API route

```typescript
// components/analyzer/AnalysisResult.tsx — new export
export interface CaptureContext {
  sessionId: string;
  pokerHandId: string | null;
  tableTemperature: TableTemperature | null;
  tableReads: number | null;
  heroPositionCode: Position | null;
  personaSelected: { personaId, personaName, action, temperature } | null;
}

// In submit() effect:
submit({
  image: imageBase64,
  opponentHistory,
  handContext,
  captureMode,
  ...(captureContext ?? {}),  // spread the context bag
});
```

```typescript
// app/page.tsx — build captureContext inline before JSX
const captureContext: CaptureContext = {
  sessionId: getSession().id,
  pokerHandId: isContinuous
    ? handState.pokerHandId
    : manualPokerHandIdRef.current,  // fresh UUID per manual capture
  tableTemperature: tableProfile?.temperature ?? null,
  tableReads: tableProfile?.reads ?? null,
  heroPositionCode: handState.heroPosition,
  personaSelected: selectedPersona ? {
    personaId: selectedPersona.persona.id,
    personaName: selectedPersona.persona.name,
    action: selectedPersona.action,
    temperature: tableProfile?.temperature ?? null,
  } : null,
};
```

```typescript
// app/api/analyze/route.ts — extend requestSchema with new optional fields
const requestSchema = z.object({
  image: z.string().min(1).max(10_000_000),
  // ... existing fields ...
  sessionId: z.string().optional(),
  pokerHandId: z.string().nullable().optional(),
  tableTemperature: tableTemperatureSchema.nullable().optional(),
  tableReads: z.number().nullable().optional(),
  heroPositionCode: positionSchema.nullable().optional(),
  personaSelected: z.object({ ... }).nullable().optional(),
});

// In writeHandRecord call:
const record: HandRecord = {
  // ...
  sessionId: parsed.data.sessionId ?? null,
  pokerHandId: parsed.data.pokerHandId ?? null,
  tableTemperature: parsed.data.tableTemperature ?? null,
  tableReads: parsed.data.tableReads ?? null,
  heroPositionCode: parsed.data.heroPositionCode ?? null,
  personaSelected: parsed.data.personaSelected ?? null,
};
```

### 4. Manual capture needs its own `pokerHandId`

In continuous mode, `pokerHandId` comes from the state machine. In manual mode, the state machine never transitions (no frame loop), so `handState.pokerHandId` is always `null`. Generate a fresh UUID per manual capture:

```typescript
// app/page.tsx
const manualPokerHandIdRef = useRef<string | null>(null);

// In manual CAPTURE handler:
manualPokerHandIdRef.current = crypto.randomUUID();
setImageBase64(event.data.base64);

// In captureContext:
pokerHandId: isContinuous ? handState.pokerHandId : manualPokerHandIdRef.current,
```

### 5. Upgrade `query-hands.ts` with `--group-by-hand`

```bash
bun run scripts/query-hands.ts --group-by-hand
```

Output:
```
Session abc123… (2026-02-24 18:30, 3 hands)
  Hand def456…
    PREFLOP  BTN  tight_passive     → RAISE 3BB [HIGH]  persona:exploit_hawk
    FLOP     BTN  tight_passive     → BET 2/3pot [HIGH]
    TURN     BTN  tight_passive     → BET pot    [MEDIUM]
  Hand ghi789…
    PREFLOP  SB   unknown           → FOLD [HIGH]
```

Old records (no `sessionId`/`pokerHandId`) degrade gracefully: each shows as `unknown-session`, each record as its own hand.

## Why This Works

The key insight is that context data is **transiently available** in React state at exactly the right moment (analysis trigger), but the existing pipeline only passed `image + opponentHistory + handContext + captureMode` to the API. Adding a `CaptureContext` bag makes the pipeline atomic — all context is captured at the same moment the image is submitted and flows through to disk.

React batching is the ally here: `setSelectedPersona`, `setTableProfile`, and `setImageBase64` all fire in the same render batch (persona effect and analysis trigger effect both fire when `handState` updates). So when `AnalysisResult` renders with the new `imageBase64`, `captureContext` already reflects the updated persona/temperature from the same batch.

## Prevention / Patterns for Future Context Fields

When adding new transient state that should be recorded per hand:

1. **Is it in React state in `page.tsx`?** → Add it to `CaptureContext` interface and the `captureContext` object
2. **Is it in the state machine?** → Expose it via `handState`, then include in `captureContext`
3. **Is it in a different browser context?** → Cannot be captured at analyze time; must be sent via `window.postMessage` first (see gotcha below)
4. **Is it in sessionStorage?** → Read at trigger time via the relevant getter (e.g., `getSession().id`)
5. **Add to `requestSchema`** with `.nullable().optional()` for backward compat
6. **Default to `?? null`** when building `HandRecord` — never assume field is present

## Key Gotcha: Browser Context Boundaries

**VPIP/AF stats are NOT accessible from the assistant page.**

`poker-content.ts` is a content script injected into the **poker table tab** (e.g. GGPoker). The assistant app at `localhost:3006` is a completely separate page. There is no `window.postMessage` bridge carrying VPIP/AF to `localhost:3006`.

The `TableProfile.reads` field (count of opponents Claude has classified by type) is the correct proxy — it's derived from `PokerSession` in sessionStorage and IS accessible from `page.tsx`.

If you ever need raw VPIP/AF in records, you'd need to:
1. Send them from `poker-content.ts` → `content.ts` → `background.ts` → `content.ts` (localhost tab) → `page.tsx` via `window.postMessage`
2. Store them in sessionStorage when received
3. Read from sessionStorage at capture time

## Related Issues

- See also: [continuous-capture-state-machine.md](./continuous-capture-state-machine.md) — WAITING→PREFLOP lifecycle and `pokerHandId` generation
- See also: [continuous-capture-race-conditions.md](../logic-errors/continuous-capture-race-conditions.md) — use `submittedRef` to capture context atomically; avoid stale closures
- See also: [persona-auto-selection-table-temperature.md](./persona-auto-selection-table-temperature.md) — persona/temperature system whose output is now persisted per hand
