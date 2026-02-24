---
title: "Preflop raise sizing: compute from BB instead of reading DOM slider"
date: 2026-02-24
module: poker-assistant
problem_type: logic_error
component: browser_extension
symptoms:
  - "Overlay shows RAISE without a euro amount"
  - "Overlay shows user-selected slider value rather than a strategic recommendation"
  - "scrapeAvailableActions() returns RAISE button with null/zero amount at fast-path time"
root_cause: "Two compounding causes: (1) scrapeAvailableActions() stopped at first leaf span 'Raise To' — amount sibling span was ignored; (2) action buttons do not render until ~300ms after hero turn indicator rises, so fast-path fires before DOM contains strategic amounts"
severity: high
tags: [preflop, raise-sizing, dom-scraping, timing, fast-path, big-blind, position-aware, open-raise]
---

# Preflop raise sizing: compute from BB instead of reading DOM slider

## Problem Statement

The preflop fast-path needs to show a recommended raise amount (e.g. "RAISE €1.50").

**Attempt 1 — Read from DOM raise button:**
```typescript
// WRONG — does not work
const raiseBtn = state.availableActions.find((a) => a.type === "RAISE");
const amount = raiseBtn?.amount ? parseFloat(raiseBtn.amount.replace(/[€$£,]/g, "")) : null;
```

This fails for two independent reasons:

### Root cause A — split leaf spans

Playtech renders the raise button label as two sibling `<span>` elements:
```html
<span>Raise To</span>
<span>€1.25</span>
```

The original scraper stopped at the first leaf span → `text = "Raise To"`, no amount
matched by the `€\d+` regex.

**Fix:** Join ALL leaf spans and deduplicate consecutive identical entries (Playtech
duplicates them for aria: "Fold","Fold"):
```typescript
const leafTexts: string[] = [];
for (const s of spans) {
  if (s.querySelector("span") === null) {
    const t = s.textContent?.trim() ?? "";
    if (t) leafTexts.push(t);
  }
}
const deduped = leafTexts.filter((t, i) => i === 0 || t !== leafTexts[i - 1]);
let text = deduped.join(" ") || btn.textContent?.trim() ?? "";
// → "Raise To €1.25" — amount regex now matches
```

### Root cause B — timing race (deeper issue)

Even after fixing the leaf span joining, the amount shown is the user's current
slider position — not a strategic recommendation. More fundamentally:

**The fast-path fires when the hero turn indicator appears. Action buttons render
~300ms later.** So `state.availableActions` is empty when the fast-path runs and
`raiseBtn` is always `null`.

**Even if buttons were present**, reading the DOM raise amount reflects *where the
user last positioned the slider*, not what the system recommends.

## Solution

Compute the raise size from pot math:

```typescript
// In an unraised pot: pot = SB + BB = 1.5 × BB → BB ≈ pot / 1.5
let preflopAmount: number | null = null;
if (personaAction === "RAISE" || personaAction === "BET") {
  const pot = parseCurrency(state.pot);
  if (pot > 0) {
    const bb = pot / 1.5;
    const activePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);
    const rawPos = getPosition(state.heroSeat, state.dealerSeat, activePlayers.length);
    const pos = rawPos === "BTN/SB" ? "BTN" : rawPos;
    // Late position (BTN/CO): open 2.5×BB; early/mid/SB: open 3×BB
    const multiplier = ["BTN", "CO"].includes(pos) ? 2.5 : 3.0;
    preflopAmount = Math.round(bb * multiplier * 100) / 100;
  }
}

// Add a BB tag to the log and reasoning for observability
const bbTag = preflopAmount != null && parseCurrency(state.pot) > 0
  ? ` (${(preflopAmount / (parseCurrency(state.pot) / 1.5)).toFixed(1)}BB)`
  : "";
```

**Why pot / 1.5 for BB?**
In an unraised preflop pot: pot = SB (0.5BB) + BB (1BB) = 1.5BB → BB = pot / 1.5.
When there are limpers the pot is larger (2.5BB, 3.5BB, …) and the computed raise
automatically scales up — which is exactly correct poker (open + 1BB per limper).

**Position multipliers (6-max NL):**
| Position | Multiplier | Rationale |
|----------|-----------|-----------|
| BTN, CO  | 2.5×BB    | Late position — steal range, smaller open |
| UTG, MP, HJ, SB | 3.0×BB | Earlier position — tighter, more value-weighted |

## Related Issues

- Leaf span joining fix is in `scrapeAvailableActions()` in `poker-content.ts`
- Post-flop raise sizing uses `betSize(pot, fraction)` from `lib/poker/rule-tree.ts`
- See `docs/solutions/implementation-patterns/gto-postflop-rule-engine.md` for
  post-flop bet sizing fractions

## Prevention

- Never read bet/raise amounts from the DOM in a fast-path triggered by the turn
  indicator — action buttons render late.
- Pot-math derivations (BB from pot, SPR, pot odds) are always available immediately
  and give strategically correct values.
- For any position-aware computation, always normalize `BTN/SB` → `BTN` first.
