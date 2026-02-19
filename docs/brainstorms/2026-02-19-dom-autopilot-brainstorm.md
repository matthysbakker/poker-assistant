# DOM-Based Autopilot Brainstorm

**Date:** 2026-02-19
**Status:** Brainstorm complete

## What We're Building

A full autopilot that plays poker hands automatically on Holland Casino's Playtech browser client. Instead of screenshot-based vision analysis, we read game state directly from the DOM and click action buttons programmatically.

**Goal:** Validate strategy quality on play-money tables without manual play.

## Why DOM-Based (Not Vision)

The Playtech poker client is **100% HTML/CSS** — no canvas, no Flash. Every piece of game state is readable as DOM text:

| Data | DOM Location |
|------|-------------|
| Hero cards | `.cards-holder-hero .card-rank` + `.card-suit` |
| Community cards | `.cardset-community .card:not(.pt-visibility-hidden) .card-rank` + `.card-suit` |
| Pot | `.total-pot-amount` |
| Player bets | `#player-bet-N .amount` |
| Player stacks | `.player-nameplate .text-block.amount` |
| Player names | `.nickname .target` |
| Dealer button | `.game-position-N:not(.pt-visibility-hidden)` |
| Folded players | `.player-action.action-fold` |
| Hero seat | `.my-player` (class on `player-area`) |
| Turn indicator | `.turn-to-act-indicator` / `.countdown-text` |
| Hand ID | `.hand-id` |
| Action buttons (pre) | `#FOLD`, `#CALL` checkboxes |
| Card images | `img[src*="cards-classic-assets"]` (e.g., `dq.svg` = Q♦) |

**Advantages over vision:**
- Instant, reliable reads (no image processing)
- Zero latency for game state extraction
- No false positives/negatives from template matching
- Access to data vision can't see (exact chip amounts, hand IDs, timer values)

## Architecture

### Components

```
┌─────────────────────┐      ┌──────────────────────┐
│  Holland Casino Tab  │      │    Next.js App        │
│                      │      │   (localhost:3000)    │
│  poker-content.ts    │      │                       │
│  - DOM observer      │◄────►│  /api/autopilot       │
│  - State scraper     │  bg  │  - Claude conversation│
│  - Action executor   │      │  - Structured action  │
│  - Humanization      │      │                       │
└─────────────────────┘      └──────────────────────┘
         ▲                              ▲
         │ extension messages           │ Anthropic API
         ▼                              ▼
┌─────────────────────┐      ┌──────────────────────┐
│  background.ts       │      │    Claude Sonnet 4    │
│  - Autopilot toggle  │      │    (strategy brain)   │
│  - Message routing   │      │                       │
└─────────────────────┘      └──────────────────────┘
```

### Message Flow (per decision)

1. **poker-content.ts** detects it's hero's turn (action buttons appear / turn indicator on hero)
2. Scrapes full game state → sends to background
3. **background.ts** forwards to Next.js `/api/autopilot` (direct fetch to localhost)
4. **API route** appends game state to per-hand conversation → calls Claude
5. Claude returns structured action: `{ action: "RAISE", amount: 0.15 }`
6. Response flows back: API → background → poker-content
7. **poker-content.ts** humanization delay (2-8s random) → simulated mouse move → click button

### Per-Hand Conversation (Claude)

Key insight from brainstorm: **maintain a conversation thread per hand**, not isolated API calls.

**Hand start message:**
```
New hand #12057018851. 6-max NL Hold'em, €0.01/€0.02.
Seat 1 (BTN): hullabaloo22 €1.23
Seat 2 (SB): RATEG €1.21
Seat 3: 2good4uAA1 €0.99
Seat 4 (Hero/UTG): ninjathird397 €1.82
Seat 5: PepitoNova €2.05
Seat 6: sharksea26 €2.88

Hero holds: Qd 7d
Action to Hero. Options: Fold, Call €0.02, Raise €0.04-€1.82
```

**Subsequent messages in same hand:**
```
Hero calls €0.02. PepitoNova folds. sharksea26 folds. hullabaloo22 raises to €0.06.
RATEG folds. 2good4uAA1 calls €0.04.
Action to Hero. Pot: €0.15. Options: Fold, Call €0.04, Raise.
```

```
FLOP: Ks 9h 3d. Pot: €0.15.
2good4uAA1 checks. hullabaloo22 bets €0.08.
Action to Hero. Options: Fold, Call €0.08, Raise.
```

**Claude response format (structured):**
```json
{ "action": "FOLD", "amount": null, "reasoning": "Q7s missed the flop entirely, facing a bet" }
```

## Key Decisions

1. **DOM scraping, not vision** — the Playtech client exposes everything in HTML
2. **Per-hand conversation with Claude** — accumulate context within a hand, reset between hands
3. **Claude for all decisions initially** — optimize later (preflop charts, caching)
4. **Next.js API for Claude calls** — keeps API key server-side, reuses existing infrastructure
5. **Basic humanization** — random delays + mouse simulation, not foolproof but reasonable
6. **Play-money only** — for strategy validation and learning

## Open Questions / Still Need to Discover

### Must discover before building:
1. **Action button DOM when it's hero's turn** — current HTML shows pre-action checkboxes. Need to capture the DOM when it's actually hero's turn to see the real Fold/Call/Raise button structure
2. **Raise/bet input field** — how does the bet sizing slider/input work in DOM?
3. **Check button** — does "Check" appear as a separate button or is it Call €0?

### Design questions:
4. **Extension URL match pattern** — need the exact Holland Casino poker URL pattern for content script injection
5. **Hand boundary detection** — how to reliably detect new hand starts in DOM (hand ID change? card dealing animation?)
6. **Multi-table** — support one table at a time initially?
7. **Error recovery** — what if Claude is slow and timer runs out? Auto-fold as fallback?
8. **Sit-out detection** — should bot auto-sit-back-in?

### Humanization (future refinement):
9. **Click location variance** — click slightly different spots on the button each time
10. **Session patterns** — occasional pauses, varied session lengths
11. **Play style variance** — not playing perfectly GTO every hand (occasional "mistakes"?)

## Risk Assessment

- **ToS violation** — automated play is prohibited even on play-money tables
- **Account termination** — detection could result in ban
- **Detection vectors** — click patterns, timing consistency, no mouse movement, API call patterns
- **Mitigation** — play-money only, basic humanization, learning purpose

## What This Replaces vs Complements

- **Replaces** (for autopilot): screenshot capture, card detection pipeline, image preprocessing
- **Complements**: existing analysis UI still works for manual play with vision-based detection
- **Shares**: Claude prompting patterns, game state model, extension message infrastructure
