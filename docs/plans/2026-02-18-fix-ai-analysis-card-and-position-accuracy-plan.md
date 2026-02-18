---
title: "fix: AI analysis card and position accuracy"
type: fix
date: 2026-02-18
---

# Fix AI Analysis Card and Position Accuracy

Two bugs where Claude's structured output doesn't match reality:
1. **Position hallucination** — AI says hero is in the big blind when they're not
2. **Card hallucination** — Card detection correctly found A3, but AI output "two 3s"

Both are prompt/schema issues. The card detection pipeline and data flow work correctly.

## Root Cause

### Bug 1: Position

`heroPosition` in the schema has no guidance — just `"Hero's position at the table"`. Claude guesses from visual cues and often defaults to BB. The system prompt says "read positions from the screenshot" but doesn't explain HOW to find the dealer button or derive hero position from it.

### Bug 2: Cards

The schema and system prompt send **conflicting signals**:

| Source | Instruction |
|--------|------------|
| System prompt (`system-prompt.ts:58`) | "Trust them — do NOT re-read these cards from the image" |
| Schema `cardReadingNotes` (`schema.ts:45`) | "If detected cards were provided: **confirm** them" |
| Schema `heroCards` (`schema.ts:52`) | "Hero's hole cards **based on your card reading notes above**" |
| Schema `communityCards` (`schema.ts:55`) | "Community cards **based on your card reading notes above**" |

The schema descriptions tell Claude to re-read and confirm, overriding the system prompt's "trust detection" instruction. Since `streamObject` uses schema descriptions as implicit instructions, Claude follows them over the system prompt.

## Acceptance Criteria

- [x] When detected cards say "Hero: Ah 3d", the `heroCards` output MUST be "Ah 3d" — never re-read from image
- [x] When detected cards say "Board: Ks Qh 2c", the `communityCards` output MUST be "Ks Qh 2c"
- [x] `cardReadingNotes` should echo detected cards verbatim (not "confirm")
- [x] Position detection should reference the dealer button (D/BTN chip) explicitly
- [x] Fallback behavior preserved: when no cards are detected, Claude still reads from the image
- [x] When cards are marked `[unreadable]`, Claude still reads those specific cards from the image

## Changes

### `lib/ai/schema.ts`

**`cardReadingNotes`** (line 44-49) — Remove "confirm" language. When detected cards exist, just echo them:

```typescript
cardReadingNotes: z
  .string()
  .describe(
    "If detected cards were provided: repeat the detected cards exactly as given — they are ground truth. " +
    "Only describe what you see for any cards marked [unreadable]. " +
    "If no detected cards were provided: describe exactly what you see on each card — " +
    "rank symbol/letter in the corner, SHAPE of the suit symbol. " +
    "Note if a rank could be 6 or 9 (check orientation)."
  ),
```

**`heroCards`** (line 50-52) — Remove "based on your card reading notes" to stop re-reading:

```typescript
heroCards: z
  .string()
  .describe(
    "Hero's hole cards. If detected cards were provided, use them exactly. " +
    "Only read from the image if no detection was provided. Format: e.g. 'Ah Kd'"
  ),
```

**`communityCards`** (line 53-55) — Same fix:

```typescript
communityCards: z
  .string()
  .describe(
    "Community cards. If detected cards were provided, use them exactly. " +
    "Only read from the image if no detection was provided. Format: e.g. 'Qs Jc Th'. Empty string if preflop"
  ),
```

**`heroPosition`** (line 56-58) — Add guidance on how to determine position:

```typescript
heroPosition: z
  .enum(["UTG", "MP", "CO", "BTN", "SB", "BB"])
  .describe(
    "Hero's position at the table. Find the dealer button (marked 'D' or 'DEALER') on the table, " +
    "then determine hero's seat relative to it. The player ON the button is BTN, " +
    "the next player clockwise is SB, then BB, then UTG, MP, CO."
  ),
```

### `lib/ai/system-prompt.ts`

**`SYSTEM_PROMPT_WITH_DETECTED_CARDS`** (line 57-58) — Strengthen the trust instruction:

```
IMPORTANT — Card detection results are provided in the user message as "Detected cards: Hero: ... Board: ...".
- Named cards (e.g., "Kc", "Ah") are GROUND TRUTH from template matching. Copy them exactly into your output — do NOT re-read or re-interpret these cards from the image.
- Cards marked [unreadable] could not be identified. You MUST read these specific cards from the image using the suit shape guidelines below.
```

**Position guidance** — Add to both system prompts, after the card reading section:

```
POSITION — To determine hero's position:
- Find the dealer button chip (marked "D" or "DEALER") on the table.
- Count seats clockwise from the dealer button: BTN → SB → BB → UTG → MP → CO.
- Hero is typically at the bottom of the screen. Identify which seat they occupy relative to the button.
- If the dealer button is not visible, state your best inference in the reasoning.
```

## References

- `lib/ai/schema.ts:41-93` — Zod schema for structured output
- `lib/ai/system-prompt.ts:55-105` — System prompt with detected cards
- `lib/ai/analyze-hand.ts:13-55` — Where detected cards are injected into user message
- `app/api/analyze/route.ts:40-52` — Where detection results are passed through
