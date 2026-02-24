---
title: "fix: Resolve all pending todos (064–082)"
type: fix
date: 2026-02-24
---

# fix: Resolve All Pending Todos (064–082)

## Overview

19 open todos from code reviews across `feat/local-poker-decision-engine`. Grouped into four phases by risk and logical coupling. All changes are local — no new dependencies, no API changes.

**Todos in scope:** 064, 065, 066, 067, 068, 069, 070, 071, 072, 073, 074, 075, 076, 077, 078, 079, 080, 081, 082

---

## Phase 1 — Critical Safety (Autopilot Correctness)

These todos can cause the autopilot to take wrong poker actions. Fix first.

### todo-064: FOLD→CHECK reads stale `lastState` instead of live DOM

**File:** `extension/src/poker-content.ts` line ~962

**Problem:** `safeExecuteAction()` checks `lastState?.availableActions.some((a) => a.type === "CHECK")` to decide if FOLD→CHECK fallback is safe. `lastState` is 1–2 seconds old. A bet could arrive in that window.

**Fix:** Replace the stale-cache check with a live DOM query using the already-defined `findActionButton()`:

```typescript
// Before
if (action.action === "FOLD" && lastState?.availableActions.some((a) => a.type === "CHECK")) {

// After
if (action.action === "FOLD" && findActionButton("CHECK") !== null) {
```

---

### todo-065: Raise/Bet amount not re-validated after humanisation delay

**File:** `extension/src/poker-content.ts` — `executeAction()`, lines ~920–950

**Problem:** `action.amount` is validated before the humanisation delay. After the delay, the bet input is written without checking whether min/max are still the same.

**Fix:** After the delay and before writing to the input, verify the bet button is still mounted and the input field still exists. If not, abort and log a warning:

```typescript
// After await humanDelay(...)
const betInput = document.querySelector<HTMLInputElement>(".betInput, [data-bet-input]");
if (!betInput) {
  console.warn("[autopilot] bet input gone after delay — aborting raise");
  return;
}
const min = parseFloat(betInput.min);
const max = parseFloat(betInput.max);
if (Number.isFinite(min) && (action.amount < min || action.amount > max)) {
  console.warn("[autopilot] amount out of range after delay — aborting");
  return;
}
```

---

### todo-069: Exploit overrides bypass GTO confidence threshold

**File:** `lib/poker/exploit.ts` — `applyExploitAdjustments()`, lines ~127–203

**Problem:** Hard exploit overrides (AP-1 through AP-4) fire on any base confidence. AP-3 promotes a FOLD with confidence 0.60 to a CALL with confidence 0.68 — bypassing the 0.70 minimum needed for local execution (below which Claude should handle the hand).

**Fix:** Gate all hard overrides behind `input.confidence >= MIN_EXECUTION_CONFIDENCE`. Use the same threshold constant that `rule-tree.ts` / `poker-content.ts` uses for the Claude-fallback boundary (currently 0.70):

```typescript
// exploit.ts
const MIN_EXECUTION_CONFIDENCE = 0.70;  // must match rule-tree threshold

function applyExploitAdjustments(decision: LocalDecision, ...): LocalDecision {
  if (decision.confidence < MIN_EXECUTION_CONFIDENCE) return decision; // let Claude handle
  // AP-1 … AP-4 overrides below
```

---

### todo-076: `lastTableTemperature` null when `localDecide()` called mid-session

**File:** `extension/src/poker-content.ts` — `localDecide()`, lines ~710–759

**Problem:** `localDecide()` runs synchronously when `heroTurn` flips true. `requestPersona()` is async — `lastTableTemperature` may still be `null` for the first several calls. The exploit layer silently runs with `opponentType = undefined`.

**Fix:** Make the null case explicit. Return early (fall through to Claude) if temperature is unavailable, log why:

```typescript
function localDecide(state: GameState): LocalDecision | null {
  if (!lastTableTemperature) {
    console.info("[local] no temperature yet — deferring to Claude");
    return null;  // triggers Claude fallback
  }
  // rest of function unchanged
```

---

## Phase 2 — Architecture Cleanup

Structural changes that affect multiple files. Do in one commit to avoid split-state.

### todo-067: Circular import between `exploit.ts` and `rule-tree.ts`

**Files:** `lib/poker/types.ts`, `lib/poker/rule-tree.ts`, `lib/poker/exploit.ts`, `lib/poker/__tests__/exploit.test.ts`, `extension/src/poker-content.ts`

**Problem:** `exploit.ts` does `import type { LocalDecision } from "./rule-tree"`. `rule-tree.ts` does `import { applyExploitAdjustments } from "./exploit"`. Logical cycle, risks bundler issues.

**Fix:** Move `LocalDecision` and `RuleTreeInput` (any types exported from `rule-tree.ts` that `exploit.ts` or `poker-content.ts` import) to `lib/poker/types.ts`. Update all importers:

```typescript
// lib/poker/types.ts — add:
export interface LocalDecision { action: PokerAction; confidence: number; reasoning: string; betFraction?: number; }
export interface RuleTreeInput { ... }

// lib/poker/exploit.ts — change:
// import type { LocalDecision } from "./rule-tree";
import type { LocalDecision } from "./types";

// lib/poker/rule-tree.ts — remove the LocalDecision export, import from types:
import type { LocalDecision, RuleTreeInput } from "./types";

// extension/src/poker-content.ts — update:
import type { LocalDecision } from "../../lib/poker/types";

// lib/poker/__tests__/exploit.test.ts — update:
import type { LocalDecision } from "../types";
```

---

### todo-068: `_rankCounts` / `_suitCounts` duplicated across modules

**Files:** `lib/poker/rule-tree.ts`, `lib/poker/exploit.ts`, and at least one other module

**Problem:** `RANK_MAP` and rank/suit counting logic is copy-pasted in 3+ places. Bugs must be fixed everywhere.

**Fix:** Extract to `lib/poker/equity/card.ts` (already the canonical card-parsing module) as shared helpers:

```typescript
// lib/poker/equity/card.ts — add:
export function rankCounts(cards: Card[]): Map<number, number> { ... }
export function suitCounts(cards: Card[]): Map<string, number> { ... }
```

Then replace all duplicated usages in `rule-tree.ts` and `exploit.ts` with imports from `equity/card.ts`.

---

### todo-071: `totalRawOuts` accepted but never used

**Files:** `lib/poker/equity/dirty-outs.ts`, `lib/poker/rule-tree.ts`

**Problem:** `DirtyOutsInput.totalRawOuts` is destructured but never read. Callers compute and pass it thinking it matters.

**Fix:**
1. Remove `totalRawOuts` from `DirtyOutsInput` interface (`dirty-outs.ts` line ~15)
2. Remove from destructuring at line ~32
3. Remove from call site in `rule-tree.ts` line ~110: delete `totalRawOuts: outs.totalRawOuts,`

---

### todo-072: `boardHasHighCard()` duplicates `analyzeBoard()`

**File:** `lib/poker/rule-tree.ts` lines 71–76, 264

**Problem:** Local `boardHasHighCard()` re-implements what `analyzeBoard()` already returns as `board.highCards`.

**Fix:** Delete the function. At line 264, replace:
```typescript
// Before
const highCardOrWetBoard = boardHasHighCard(communityCards) || board.wetScore >= 2;

// After
const highCardOrWetBoard = board.highCards || board.wetScore >= 2;
```

---

## Phase 3 — Security & Performance

### todo-066: `all_frames: true` injects content script into payment iframes

**File:** `extension/manifest.json`

**Problem:** Content script is injected into every iframe including third-party payment processors (Paysafe, Trustly). Unnecessary attack surface.

**Fix:** Remove `"all_frames": true` (or change to `false`). The poker game is in the top-level frame on `games.hollandcasino.nl`. If the game is inside an iframe, add a URL match for that specific frame origin instead of blanket injection:

```json
// manifest.json — content_scripts entry
{
  "matches": ["*://games.hollandcasino.nl/*"],
  "js": ["dist/poker-content.js"]
  // Remove: "all_frames": true
}
```

---

### todo-075: Concurrent `requestPersona()` calls race

**File:** `extension/src/poker-content.ts` — `requestPersona()`, lines ~659–701

**Problem:** No guard against concurrent invocations. Two detection frames in quick succession spawn two requests; whichever resolves last writes `lastTableTemperature`, regardless of request order.

**Fix:** Add an in-flight boolean ref (consistent with the `detectingRef` pattern already used for `/api/detect`):

```typescript
// module level:
let personaRequesting = false;

async function requestPersona(heroCards: string[], position: string) {
  if (personaRequesting) return;
  personaRequesting = true;
  try {
    // ... existing body ...
  } finally {
    personaRequesting = false;
  }
}
```

---

### todo-073: `findStatValue()` runs `querySelectorAll("*")` per player per tick

**File:** `extension/src/poker-content.ts` — `findStatValue()`, line ~408

**Problem:** `area.querySelectorAll("*")` traverses every DOM node. Called 6× per detection tick (once per seat).

**Fix:** Use a targeted selector. The HUD stats are in predictable child elements — replace the wildcard with the known class/element names observed in the casino DOM:

```typescript
// Before
const all = Array.from(area.querySelectorAll("*"));

// After (use actual HUD stat element selectors)
const all = Array.from(area.querySelectorAll(".player-stat, [data-stat], span, div"));
```

If the element name is truly unknown at compile time, scope to a single level of children first:
```typescript
const all = Array.from(area.children);  // O(1), not O(n)
```

---

### todo-074: `scrapeDealerSeat()` runs 6 queries per tick for stable data

**File:** `extension/src/poker-content.ts` — `scrapeDealerSeat()`, lines ~440–480

**Problem:** Dealer position changes once per hand (~every 30–90 seconds) but is queried on every 1-second tick.

**Fix:** Cache the last known dealer seat and only re-query when the hand resets:

```typescript
// module level:
let cachedDealerSeat: number | null = null;

function scrapeDealerSeat(): number | null {
  if (cachedDealerSeat !== null) return cachedDealerSeat;
  // ... existing query logic ...
  cachedDealerSeat = result;
  return result;
}
```

Reset `cachedDealerSeat = null` in the new-hand reset block alongside `lastTableTemperature` and `lastPersonaRec`.

---

### todo-080: `isAutopilotAction` type guard doesn't exclude `NaN`

**File:** `extension/src/background.ts` lines ~150–158 (and matching guard in `poker-content.ts` line ~136)

**Problem:** `typeof NaN === "number"` is `true`. A malformed API response with `amount: NaN` passes the type guard.

**Fix:** Replace `typeof` check with `Number.isFinite()`:

```typescript
// Before
(action.amount !== null && typeof action.amount !== "number")

// After
(action.amount !== null && !Number.isFinite(action.amount))
```

Apply to both guard sites.

---

## Phase 4 — Simplicity & Type Safety

Low-risk, high-readability improvements.

### todo-070: `lastTableTemperature` never reset on new hand

**File:** `extension/src/poker-content.ts` — new-hand reset block, lines ~1173–1184

**Fix:** Add to the existing reset block:
```typescript
lastTableTemperature = null;
cachedDealerSeat = null;  // also reset dealer cache (todo 074)
```

---

### todo-077: `isCallDownLine()` used once — inline it

**File:** `lib/poker/exploit.ts`

**Fix:** Delete `function isCallDownLine(action)` and replace the single call site with the literal expression `action === "CALL"`.

---

### todo-078: `opponentTypeFromTemperature()` used once — inline it

**File:** `extension/src/poker-content.ts` — `localDecide()` and the function definition

**Fix:** Delete `opponentTypeFromTemperature()` and replace the single call site with an inline const map:

```typescript
const OPPONENT_TYPE_MAP: Record<string, PlayerExploitType> = {
  TIGHT_PASSIVE: "TIGHT_PASSIVE",
  LOOSE_AGGRESSIVE: "LOOSE_AGGRESSIVE",
  // ...
};
const opponentType = OPPONENT_TYPE_MAP[lastTableTemperature.dominantType];
```

---

### todo-079: Magic numbers in `exploit.ts`

**File:** `lib/poker/exploit.ts` lines ~127–203

**Fix:** Extract all numeric literals to named constants at file top:

```typescript
// Confidence ceilings for hard overrides
const AP1_CONFIDENCE = 0.85;   // Bluff-catcher confidence
const AP2_CONFIDENCE = 0.72;   // Probe-bet confidence
const AP3_CONFIDENCE = 0.68;   // Pot-odds call confidence
const AP4_CONFIDENCE = 0.78;   // Value-bet confidence

// Guard thresholds
const AP3_POT_ODDS_THRESHOLD = 0.32;  // 32% break-even equity
const AP2_BET_FRACTION = 0.40;        // 40% probe-bet sizing

// Sizing multipliers for LOOSE_PASSIVE / TIGHT_PASSIVE
const LOOSE_PASSIVE_SIZE_MULT = 1.30;
const TIGHT_PASSIVE_SIZE_MULT = 0.85;
```

---

### todo-081: Local engine decisions not visible to web app (agent-native)

**Files:** `extension/src/background.ts`, `extension/src/poker-content.ts`

**Problem:** When `localDecide()` produces a decision, it goes directly to the poker tab as `AUTOPILOT_ACTION` but never reaches the web app (localhost:3006). The web app cannot log decisions or provide agent oversight.

**Fix:** After local decision, forward a `DECISION_MADE` message to the web app via the background script. Mirror the pattern used by Claude advice (`CLAUDE_ADVICE` → web app):

```typescript
// background.ts — add case:
case "LOCAL_DECISION":
  // Forward to web app for logging/display
  fetch("http://localhost:3006/api/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message.payload),
  }).catch(() => {});  // fire-and-forget
  break;

// poker-content.ts — in localDecide(), after producing decision:
chrome.runtime.sendMessage({
  type: "LOCAL_DECISION",
  payload: { action: decision.action, confidence: decision.confidence, reasoning: decision.reasoning, source: "local" },
});
```

Add `POST /api/decision` route to the Next.js app to receive and store/display the decision (or log to hand history).

---

### todo-082: `betFractionFromWetScore` typed as `number` instead of `BoardTexture["wetScore"]`

**File:** `lib/poker/board-analyzer.ts` line ~48

**Fix:**
```typescript
// Before
export function betFractionFromWetScore(wetScore: number): number {

// After
export function betFractionFromWetScore(wetScore: BoardTexture["wetScore"]): number {
```

No logic change — just narrows the parameter type to the discrete union `0 | 1 | 2 | 3 | 4`.

---

## Acceptance Criteria

- [x] All 19 todos renamed from `pending` to `resolved` in `todos/`
- [x] `bun run build:extension` passes with no TypeScript errors
- [x] `bun test lib/poker` passes (existing test suite unchanged)
- [x] No circular import warnings from ESLint or bundler
- [x] `localDecide()` returns `null` (Claude fallback) when `lastTableTemperature` is null
- [x] FOLD→CHECK fallback verified via live DOM, not cached state
- [x] `betFractionFromWetScore(99)` triggers TypeScript compile error
- [x] `isAutopilotAction` rejects `{ action: "FOLD", amount: NaN }` at runtime

## Implementation Order

1. Phase 2 first (architectural — avoids conflicts from later patches)
2. Phase 1 (safety — small, isolated changes)
3. Phase 3 (security/performance)
4. Phase 4 (cleanup — save for last; lowest risk)

## Files Changed

| File | Todos |
|------|-------|
| `lib/poker/types.ts` | 067 |
| `lib/poker/rule-tree.ts` | 067, 068, 071, 072 |
| `lib/poker/exploit.ts` | 067, 068, 069, 077, 079 |
| `lib/poker/equity/card.ts` | 068 |
| `lib/poker/equity/dirty-outs.ts` | 071 |
| `lib/poker/board-analyzer.ts` | 082 |
| `lib/poker/__tests__/exploit.test.ts` | 067 |
| `extension/src/poker-content.ts` | 064, 065, 070, 073, 074, 075, 076, 078 |
| `extension/src/background.ts` | 080, 081 |
| `extension/manifest.json` | 066 |
| `app/api/decision/route.ts` *(new)* | 081 |

## References

- `extension/src/poker-content.ts:962` — stale FOLD→CHECK
- `lib/poker/exploit.ts:16` — circular import
- `lib/poker/rule-tree.ts:15` — circular import source
- `lib/poker/equity/dirty-outs.ts:14-15` — unused field
- `lib/poker/rule-tree.ts:71-76,264` — boardHasHighCard duplication
- `lib/poker/board-analyzer.ts:48` — type narrowing
- `extension/src/background.ts:153` — NaN type guard
- `extension/manifest.json` — all_frames
- docs/solutions/logic-errors/continuous-capture-race-conditions.md — race condition patterns
- docs/solutions/implementation-patterns/continuous-capture-state-machine.md — mutex/ref patterns
