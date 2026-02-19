---
title: "feat: DOM-Based Autopilot for Poker"
type: feat
date: 2026-02-19
---

# feat: DOM-Based Autopilot for Poker

## Overview

Build a full autopilot that plays poker hands on Holland Casino's Playtech browser client by reading game state directly from the DOM and clicking action buttons programmatically. Claude maintains a per-hand conversation to decide actions. Play-money tables only, for strategy validation.

## Problem Statement / Motivation

Testing the poker assistant's strategy quality requires manually playing hundreds of hands — slow and tedious. An autopilot on play-money tables would validate strategy at scale, reveal weaknesses in Claude's recommendations, and iterate on the system prompt without human bottleneck.

## Proposed Solution

A new content script (`poker-content.ts`) injects into the Holland Casino poker page, scrapes the full game state from DOM elements, sends it to a Next.js API route that calls Claude, and executes the returned action by clicking the correct DOM button — all with humanization delays.

### Architecture

```
┌─────────────────────┐      ┌──────────────────────┐
│  Holland Casino Tab  │      │    Next.js App        │
│                      │      │   (localhost:3000)    │
│  poker-content.ts    │      │                       │
│  - DOM observer      │◄────►│  /api/autopilot       │
│  - State scraper     │  bg  │  - Claude conversation│
│  - Action executor   │      │  - generateObject()   │
│  - Humanization      │      │                       │
└─────────────────────┘      └──────────────────────┘
         ▲                              ▲
         │ chrome.runtime msgs          │ Anthropic API
         ▼                              ▼
┌─────────────────────┐      ┌──────────────────────┐
│  background.ts       │      │    Claude Sonnet 4    │
│  - Autopilot toggle  │      │    (strategy brain)   │
│  - Fetch to localhost │      │                       │
└─────────────────────┘      └──────────────────────┘
```

### Key Design Decisions (from brainstorm)

1. **DOM scraping, not vision** — Playtech is 100% HTML/CSS, every element is readable
2. **Per-hand conversation** — Claude accumulates context within a hand, resets between hands
3. **`generateObject()` not `streamObject()`** — need complete action before executing, not progressive rendering
4. **Background fetches localhost API directly** — keeps API key server-side, stateless API
5. **Conversation state in content script** — content script builds messages array, sends full history each request
6. **Basic humanization** — random delays (2-8s) before clicking

## Implementation Phases

### Phase 0: DOM Discovery (prerequisite)

Before coding, the user must capture the DOM when it's actually hero's turn (not just pre-action). We currently only have the pre-action DOM (`#FOLD`, `#CALL` checkboxes).

**What to capture:**
- [ ] DOM structure of action buttons when it's hero's turn (Fold, Call, Raise buttons)
- [ ] Raise/bet sizing input field (slider + text input?)
- [ ] Check button structure (separate button or Call €0?)
- [x] The exact Holland Casino poker URL (for content script match pattern) — `*://games.hollandcasino.nl/*`

**How:** Open DevTools, wait for hero's turn, inspect the `.actions-area` element and copy the HTML.

### Phase 1: Poker Content Script + DOM Scraper

Create a new content script that injects into the poker page and reads game state.

**New files:**
- `extension/src/poker-content.ts` — content script for poker pages

**Modified files:**
- `extension/manifest.json` — add poker URL match pattern + new content script entry
- `package.json` — add poker-content.ts to `build:extension` script

**DOM Scraping (all selectors from live Playtech HTML):**

```typescript
// extension/src/poker-content.ts

interface GameState {
  handId: string;                    // .hand-id text
  heroCards: string[];               // .cards-holder-hero .card-rank + .card-suit → ["Qd", "7d"]
  communityCards: string[];          // .cardset-community visible cards
  pot: string;                       // .total-pot-amount text
  players: PlayerState[];            // per-seat info
  heroSeat: number;                  // .my-player → seat number
  dealerSeat: number;                // .game-position-N:not(.pt-visibility-hidden)
  availableActions: ActionOption[];  // from .actions-area buttons
  isHeroTurn: boolean;               // .my-player has .turn-to-act-indicator
  timerSeconds: number | null;       // .countdown-text if present
}

interface PlayerState {
  seat: number;
  name: string;
  stack: string;
  bet: string;
  folded: boolean;
  hasCards: boolean;
}

interface ActionOption {
  type: "FOLD" | "CHECK" | "CALL" | "RAISE" | "BET";
  amount?: string;     // parsed from button text, e.g. "€0.04"
  element: Element;    // reference to the clickable DOM element
}
```

**Suit mapping:**
```typescript
const SUIT_MAP: Record<string, string> = { "♠": "s", "♥": "h", "♦": "d", "♣": "c" };
```

**Detection approach:**
- `MutationObserver` on `.table-area` watches for subtree changes
- On each mutation batch, scrape full state and compare to previous
- Detect hero's turn by: turn indicator on hero seat OR action buttons appearing
- Detect new hand by: hand ID change in `.hand-id`

**Acceptance criteria:**
- [x] Content script injects into poker page and logs game state to console
- [x] Correctly reads hero cards, community cards, pot, player states
- [x] Detects hero's turn and new hand boundaries
- [x] Scrapes available action buttons with amounts
- [x] Extension builds with `bun run build:extension`

### Phase 2: Autopilot Decision API

New API route for autopilot decisions using `generateObject()` (non-streaming).

**New files:**
- `app/api/autopilot/route.ts` — decision endpoint
- `lib/ai/autopilot-schema.ts` — Zod schema for autopilot action
- `lib/ai/autopilot-prompt.ts` — system prompt (concise, action-focused)

**API contract:**

```typescript
// Request
{
  messages: Array<{ role: "user" | "assistant", content: string }>,
  systemPrompt?: string  // optional override for testing
}

// Response
{
  action: "FOLD" | "CHECK" | "CALL" | "RAISE" | "BET",
  amount: number | null,     // in euros, e.g. 0.15
  reasoning: string          // brief explanation for logging
}
```

**Schema (`lib/ai/autopilot-schema.ts`):**

```typescript
// lib/ai/autopilot-schema.ts
import { z } from "zod";

export const autopilotActionSchema = z.object({
  action: z.enum(["FOLD", "CHECK", "CALL", "RAISE", "BET"])
    .describe("The action to take"),
  amount: z.number().nullable()
    .describe("Bet/raise amount in euros. Null for fold/check/call."),
  reasoning: z.string()
    .describe("Brief reasoning (1-2 sentences)"),
});
```

**System prompt (`lib/ai/autopilot-prompt.ts`):**

Concise strategy prompt focused on action output. Key differences from analysis prompt:
- No image reading instructions (state comes as text)
- No teaching/explaining (just decide)
- Emphasis on exploitative play at micro-stakes
- Instructs to use pot-relative bet sizing

**API route (`app/api/autopilot/route.ts`):**

```typescript
// app/api/autopilot/route.ts
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { autopilotActionSchema } from "@/lib/ai/autopilot-schema";
import { AUTOPILOT_SYSTEM_PROMPT } from "@/lib/ai/autopilot-prompt";

export const maxDuration = 15; // must respond within turn timer

export async function POST(req: Request) {
  const { messages } = await req.json();
  // validate messages array with zod

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: autopilotActionSchema,
    system: AUTOPILOT_SYSTEM_PROMPT,
    messages,
  });

  return Response.json(object);
}
```

**Acceptance criteria:**
- [x] API returns valid action for sample game state
- [x] Response time <5s for typical game states
- [x] Schema validates correctly
- [x] Handles edge cases: all-in (no amount choice), only one option (auto-act)

### Phase 3: Action Executor + Humanization

Execute Claude's decision by clicking the correct DOM button.

**In `poker-content.ts`:**

```typescript
// Action execution
async function executeAction(decision: AutopilotAction, actions: ActionOption[]) {
  // 1. Find matching button
  const target = actions.find(a => a.type === decision.action);
  if (!target) {
    // Fallback: fold or check
    const fallback = actions.find(a => a.type === "FOLD" || a.type === "CHECK");
    if (fallback) fallback.element.click();
    return;
  }

  // 2. Humanization delay (2-8 seconds, gaussian distribution)
  await humanDelay(2000, 8000);

  // 3. For raises: enter amount first, then click
  if (decision.action === "RAISE" || decision.action === "BET") {
    await enterBetAmount(decision.amount);
  }

  // 4. Click with slight position variance
  simulateClick(target.element);
}
```

**Humanization (`humanize` functions within poker-content.ts):**

```typescript
function humanDelay(minMs: number, maxMs: number): Promise<void> {
  // Gaussian-ish distribution centered between min and max
  const mean = (minMs + maxMs) / 2;
  const stddev = (maxMs - minMs) / 6;
  const delay = Math.max(minMs, Math.min(maxMs, gaussianRandom(mean, stddev)));
  return new Promise(r => setTimeout(r, delay));
}

function simulateClick(element: Element) {
  // Dispatch mousedown, mouseup, click events at slightly varied coordinates
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width * (0.3 + Math.random() * 0.4);
  const y = rect.top + rect.height * (0.3 + Math.random() * 0.4);

  for (const type of ["mousedown", "mouseup", "click"]) {
    element.dispatchEvent(new MouseEvent(type, {
      bubbles: true, clientX: x, clientY: y, button: 0
    }));
  }
}
```

**Safety guards:**
- `executingRef` boolean prevents double-execution per street
- Reset on new hand (hand ID change)
- Fallback to fold/check if Claude response missing or malformed
- Auto-fold if no response within 12 seconds (buffer before 15s timer)

**Acceptance criteria:**
- [x] Clicks correct action button based on Claude's decision
- [ ] Enters raise amounts correctly (blocked on Phase 0 — raise input DOM unknown)
- [x] Random delays feel human-ish (2-8s, varied)
- [x] Never double-acts on same street
- [x] Falls back to fold/check on error

### Phase 4: Extension Integration + Popup

Wire up message passing and add autopilot toggle to popup.

**Modified files:**
- `extension/src/background.ts` — autopilot message routing + direct fetch to localhost
- `extension/src/popup.ts` — autopilot toggle button
- `extension/popup.html` — UI for autopilot toggle

**New message types:**

```typescript
// Poker content ↔ Background
AUTOPILOT_DECIDE    poker-content → bg    Request decision (includes messages array)
AUTOPILOT_ACTION    bg → poker-content    Decision result (action object)
AUTOPILOT_LOG       poker-content → bg    Log entry for debugging

// Popup ↔ Background
AUTOPILOT_START     popup → bg            Enable autopilot
AUTOPILOT_STOP      popup → bg            Disable autopilot
GET_STATUS          popup → bg            (extend existing — add autopilot field)
```

**Background script changes:**

```typescript
// In background.ts — add autopilot state
let autopilotActive = false;
let pokerContentTabId: number | null = null;

// Handle AUTOPILOT_DECIDE from poker-content
if (message.type === "AUTOPILOT_DECIDE") {
  if (!autopilotActive) return;

  fetch("http://localhost:3000/api/autopilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: message.messages }),
  })
    .then(r => r.json())
    .then(action => {
      chrome.tabs.sendMessage(sender.tab.id, {
        type: "AUTOPILOT_ACTION",
        action,
      });
    })
    .catch(err => {
      // Send fallback fold
      chrome.tabs.sendMessage(sender.tab.id, {
        type: "AUTOPILOT_ACTION",
        action: { action: "FOLD", amount: null, reasoning: "API error" },
        error: true,
      });
    });
}
```

**Popup additions:**
- Second toggle button: "Start Autopilot" / "Stop Autopilot"
- Red/amber/green status indicator for autopilot state
- Requires localhost connection (same as continuous capture)

**Acceptance criteria:**
- [x] Popup shows autopilot toggle (separate from continuous capture)
- [x] Background routes messages between poker-content and localhost API
- [x] Status correctly reflects autopilot state
- [x] Graceful error handling (API down → fold, tab closed → stop)

### Phase 5: Per-Hand Conversation Management

Build the conversation messages array in the content script.

**In `poker-content.ts`:**

```typescript
let currentHandId: string | null = null;
let handMessages: Array<{ role: "user" | "assistant", content: string }> = [];

function onGameStateChange(state: GameState) {
  // New hand detected
  if (state.handId !== currentHandId) {
    currentHandId = state.handId;
    handMessages = [];
    // Build initial hand message with full table state
    handMessages.push({ role: "user", content: buildHandStartMessage(state) });
  }

  // Hero's turn detected
  if (state.isHeroTurn && !executingRef) {
    // Append new state info since last message
    handMessages.push({ role: "user", content: buildTurnMessage(state) });
    requestDecision(handMessages);
  }
}

function onDecisionReceived(action: AutopilotAction) {
  // Record Claude's response in conversation
  handMessages.push({
    role: "assistant",
    content: JSON.stringify(action),
  });
  // Execute the action
  executeAction(action, currentActions);
}
```

**Message builders:**

```typescript
function buildHandStartMessage(state: GameState): string {
  // "New hand #12057018851. 6-max NL Hold'em, €0.01/€0.02.
  //  Seat 1 (BTN): hullabaloo22 €1.23
  //  ...
  //  Hero holds: Qd 7d
  //  Action to Hero. Options: Fold, Call €0.02, Raise €0.04-€1.82"
}

function buildTurnMessage(state: GameState): string {
  // Diff from last known state:
  // "hullabaloo22 raises to €0.06. RATEG folds.
  //  FLOP: Ks 9h 3d. Pot: €0.15.
  //  Action to Hero. Options: Fold, Call €0.08, Raise."
}
```

**State diffing:**
- Track last known state per player (bet amount, folded status)
- On hero's turn, compute what changed since last message
- Append only the delta as a new user message

**Acceptance criteria:**
- [x] Conversation accumulates across streets within a hand
- [x] Conversation resets on new hand (hand ID change)
- [x] Claude responses recorded as assistant messages
- [x] State diffs are accurate (new bets, folds, community cards)

## Technical Considerations

### Latency Budget (Dynamic)

```
15s turn timer
 - Scrape: ~0ms
 - API round-trip + Claude: 2-5s
 - Humanization delay: DYNAMIC (adapts to remaining time)
 - Click: ~0ms
```

**Dynamic delay formula:** Read remaining seconds from `.countdown-text`. Humanization delay = `random(1s, min(8s, timeRemaining - 3s))`. The 3s safety buffer ensures we always have time to click. If Claude takes 5s and timer shows 8s remaining, max delay = `min(8, 8-3)` = 5s, so delay is `random(1, 5)`.

Fallback: if timer ≤ 3s when Claude responds, skip delay entirely and click immediately.

### Action Fallback Hierarchy

When Claude recommends an action not available in the DOM:

| Claude Says | Fallback Order |
|-------------|---------------|
| RAISE | BET → CALL → CHECK → FOLD |
| BET | RAISE → CALL → CHECK → FOLD |
| CALL | CHECK → FOLD |
| CHECK | FOLD |
| FOLD | (always available) |

Also handle label variants: "All-In" maps to RAISE, "Call €0" maps to CHECK.

### Pre-Action Checkbox Handling

The autopilot should **never** use pre-action checkboxes and should **actively uncheck** them on each state scrape. Pre-actions commit before seeing opponent actions, which defeats the purpose of Claude's analysis.

```typescript
// Clear any pre-action checkboxes
document.querySelectorAll('.pre-action-toggle:checked').forEach(el => {
  (el as HTMLInputElement).checked = false;
});
```

### Error Handling

| Scenario | Response |
|----------|----------|
| Claude API timeout (>12s) | Auto-fold (or check if available) |
| Claude returns invalid action | Use fallback hierarchy above |
| Action button not found in DOM | Check → Fold fallback |
| Next.js app not running | Stop autopilot, badge "!" |
| Poker page navigates away | Content script unloads, background detects |
| Hand ends before action executes | executingRef prevents stale click |
| Timer ≤ 3s, no response yet | Immediate fold/check |

### DOM Stability Check

Before scraping, wait for DOM to settle (Playtech uses animations):
- Read state, wait 150ms, read again
- Only proceed if both reads match (cards, pot, buttons)
- Prevents scraping mid-animation

### Content Script Isolation

The poker content script runs in the poker page's DOM context. It has access to the full DOM but NOT to the poker app's JavaScript variables (content scripts run in an isolated world). This is fine — we only need DOM access.

### Build Process Change

```json
"build:extension": "bun build extension/src/background.ts --outfile extension/dist/background.js && bun build extension/src/content.ts --outfile extension/dist/content.js && bun build extension/src/popup.ts --outfile extension/dist/popup.js && bun build extension/src/poker-content.ts --outfile extension/dist/poker-content.js"
```

### Manifest Change

```json
"content_scripts": [
  {
    "matches": ["*://localhost/*"],
    "js": ["dist/content.js"],
    "run_at": "document_idle"
  },
  {
    "matches": ["*://*.hollandcasino.nl/*"],
    "js": ["dist/poker-content.js"],
    "run_at": "document_idle"
  }
]
```

Note: exact URL pattern needs confirmation from user.

### Two Content Scripts Coexisting

The extension will have two content scripts with distinct roles:

| Script | Injects Into | Purpose | Message Types |
|--------|-------------|---------|---------------|
| `content.ts` | `*://localhost/*` | Relay captures to web app | REGISTER_WEB_APP, CAPTURE, FRAME |
| `poker-content.ts` | `*://*.hollandcasino.nl/*` | DOM scrape + action execution | REGISTER_POKER_TAB, AUTOPILOT_DECIDE, AUTOPILOT_ACTION |

Background script distinguishes by message type — no overlap between the two protocols. Maintains separate tab IDs: `webAppTabId` (existing) and `pokerTabId` (new).

### Assumptions

- User manually joins a play-money table and enables autopilot from popup
- Single table at a time (v1)
- Blinds are posted automatically (no "Post Blind" button interaction needed)
- No lobby navigation — autopilot only handles in-game decisions
- Extension reload mid-hand = state loss (acceptable for dev/play-money)

## Dependencies & Risks

### Dependencies
- Phase 0 (DOM discovery) blocks Phase 1 and 3
- Phase 1 blocks Phase 3, 4, 5
- Phase 2 is independent (can be built in parallel with Phase 1)

### Risks
- **Hero-turn DOM unknown** — we haven't seen the action button structure during hero's turn. Mitigation: Phase 0 discovery step.
- **ToS violation** — automated play prohibited even on play-money. Mitigation: learning purpose, basic humanization.
- **DOM changes** — Playtech could update their CSS classes/structure. Mitigation: keep selectors in a config object for easy updates.
- **Detection** — platform may detect bot behavior. Mitigation: humanization delays, click variance, play-money only.

## Open Questions (from brainstorm)

Resolved by plan:
- Architecture: content script + background + localhost API ✓
- Conversation management: per-hand messages array in content script ✓
- Error recovery: auto-fold on timeout/error ✓

Still open (resolved during implementation):
- [x] Exact Holland Casino poker URL pattern — `*://games.hollandcasino.nl/*`
- [ ] Hero-turn action button DOM structure (Phase 0)
- [ ] Raise input field DOM structure (Phase 0)
- [ ] Multi-table support (deferred — single table for v1)

## References & Research

### Internal References
- Brainstorm: `docs/brainstorms/2026-02-19-dom-autopilot-brainstorm.md`
- Extension architecture: `extension/src/background.ts:1-22` (message protocol docs)
- Content script pattern: `extension/src/content.ts` (register/relay pattern)
- AI schema pattern: `lib/ai/schema.ts` (Zod structured output)
- State machine pattern: `lib/hand-tracking/state-machine.ts` (hysteresis, forward-only)
- Existing API route: `app/api/analyze/route.ts` (request validation, AI call)

### Institutional Learnings Applied
- Use refs not state for execution guards (`docs/solutions/logic-errors/continuous-capture-race-conditions.md`)
- Forward-only state machines prevent oscillation (`docs/solutions/implementation-patterns/continuous-capture-state-machine.md`)
- `generateObject` for non-streaming structured output (`docs/solutions/implementation-patterns/ai-sdk-v6-streaming-structured-output.md`)
- `window.postMessage` for content↔page communication (not BroadcastChannel)
