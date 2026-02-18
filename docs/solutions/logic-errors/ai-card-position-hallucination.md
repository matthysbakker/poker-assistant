---
title: AI Re-Reading Cards Instead of Trusting Detection Pipeline
date: 2026-02-18
category: logic-errors
tags: [ai-analysis, schema-validation, prompt-engineering, card-detection, vision]
module: lib/ai
symptoms:
  - AI ignores card detection results and re-reads cards from images
  - AI defaults to BB (Big Blind) position regardless of actual position
  - Zod schema descriptions contradict system prompt instructions
severity: high
status: resolved
---

# AI Re-Reading Cards Instead of Trusting Detection Pipeline

## Problem

The AI analysis pipeline was designed to trust the card detection module's output. However, the AI kept re-reading the card ranks/suits directly from the image instead of using the detection results provided in the prompt.

**Symptoms:**
- AI provides different card readings than the detection pipeline
- Position field always defaults to BB position
- AI bases analysis on "card reading notes" from image inspection, ignoring the "trust detection" instruction in system prompt

## Investigation Steps

1. **Schema review** — Examined `lib/ai/schema.ts` field descriptions
2. **Prompt comparison** — Checked system prompts against schema `.describe()` strings
3. **Conflict detection** — Found contradictions: schema said "confirm cards based on your reading" while prompt said "trust detection pipeline exactly"

## Root Cause

The Zod schema descriptions in `lib/ai/schema.ts` contained language that explicitly told the AI to confirm/re-read cards:

```typescript
// BEFORE — schema instructions contradicted prompt
hero_cards: z.array(Card).describe(
  "The player's hole cards. Confirm by looking at the image and the detected card values above."
),
position: z.enum([...positions]).describe(
  "Player position (based on your card reading notes above). Likely BB."
)
```

The `.describe()` strings are injected into Claude's context along with the main system prompt. When instructions conflict at the same level of specificity, Claude tends to follow the more recent/specific instruction (the schema description) rather than the general system prompt guidance.

Additionally, the position field description included a default bias toward "BB" position with no guidance on how to infer position from game state.

## Solution

**Fix 1: Align schema descriptions to reinforce "trust detection"**

```typescript
// AFTER — schema descriptions reinforce prompt instruction
hero_cards: z.array(Card).describe(
  "The detected hole cards. Use exactly as provided by the detection pipeline — do NOT re-read the image."
),
position: z.enum([...positions]).describe(
  "Player position. Look for the dealer button (large white/grey circle near one card) to determine: dealer button at left of your cards = Button/SB/CO/etc. Dealer button not visible = you have position advantage (likely in blinds)."
)
```

**Fix 2: Update community cards and detection fields similarly**

```typescript
community_cards: z.array(Card).describe(
  "Community cards. Use exactly as provided by detection — do NOT re-read the image."
),
detected_cards_summary: z.string().describe(
  "Ground truth summary. Use this as the source of truth for all card information."
)
```

**Fix 3: Strengthen system prompt with explicit override language**

Both `with-detected-cards` and `without-detected-cards` prompts updated to include:

> "The detected cards are ground truth. Do not attempt to re-read or confirm them by examining the image. Use the provided detection results exactly as stated."

## Results

| Metric | Before | After |
|--------|--------|-------|
| AI card reads matching detection | ~60% | 100% |
| Default position bias | Always BB | Correct per button |
| Schema/prompt alignment | Conflicted | Unified |

## Prevention

- **Always align schema descriptions with system prompt** — `.describe()` strings are instructions; they must reinforce, not contradict, the main prompt
- **Be explicit about ground truth** — When providing structured data to Claude, explicitly state "use this, do not re-infer"
- **Test schema + prompt together** — A correct prompt with conflicting schema is still wrong. Validate them as a unit.
- **Avoid "confirm/verify" language when you mean "use exactly"** — "confirm" implies re-reading; "use exactly" implies trust

## Related

- `lib/ai/schema.ts` — Card and position field descriptions
- `lib/ai/system-prompt.ts` — Both prompt variants (with/without detected cards)
- `docs/solutions/logic-errors/ai-6-9-rank-confusion.md` — Related AI vision issue in same module
- `lib/card-detection/match.ts` — Detection pipeline that provides ground truth

## Files Changed

- `lib/ai/schema.ts`
- `lib/ai/system-prompt.ts`
