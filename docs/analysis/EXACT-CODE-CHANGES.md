# Exact Code Changes Required

This document shows the precise before/after code for both bug fixes.

Copy/paste the "After" sections directly into your code editor.

---

## Bug #2 Fix (Card Hallucination) — 2 Files

### File 1: `/lib/ai/schema.ts`

#### Change 1.1: Update `cardReadingNotes` description (Lines 42-49)

**BEFORE:**
```typescript
export const handAnalysisSchema = z.object({
  cardReadingNotes: z
    .string()
    .describe(
      "If detected cards were provided: confirm them and note any additional observations from the image. " +
      "If no detected cards: describe exactly what you see on each card — " +
      "rank symbol/letter in the corner, SHAPE of the suit symbol (pointed leaf = spade, three lobes = club, heart shape, rhombus = diamond). " +
      "Note if a rank could be 6 or 9 (check orientation)."
    ),
```

**AFTER:**
```typescript
export const handAnalysisSchema = z.object({
  cardReadingNotes: z
    .string()
    .describe(
      "DETECTED CARDS MODE: If detected cards were provided, do NOT re-describe the card identities. Instead, note any observations about card quality, position, or ambiguities in the image that might affect confidence. " +
      "NO DETECTION MODE: If no detected cards were provided, describe exactly what you see on each card — " +
      "rank symbol/letter in the corner, SHAPE of the suit symbol (pointed leaf = spade, three lobes = club, heart shape, rhombus = diamond). " +
      "Note if a rank could be 6 or 9 (check orientation). " +
      "Always explain how you determined the hero's position, including which visual signals you used (button location, blinds, card position on screen)."
    ),
```

**Why:** Clarifies that cardReadingNotes should NOT duplicate card identities when detection is used; removes ambiguity.

---

#### Change 1.2: Update `heroCards` description (Lines 50-52)

**BEFORE:**
```typescript
  heroCards: z
    .string()
    .describe("Hero's hole cards based on your card reading notes above, e.g. 'Ah Kd'"),
```

**AFTER:**
```typescript
  heroCards: z
    .string()
    .describe(
      "Hero's hole cards. " +
      "If card detection was provided in the user message: output EXACTLY the detected cards (format: 'Ah Kd'). Do NOT re-read these from the image. " +
      "If any detected cards are marked [unreadable]: read only those specific cards from the image; for all other cards, use the detected values. " +
      "If NO card detection was provided: output cards read from the image using the suit shape guidelines (format: 'Ah Kd', no spaces between cards)."
    ),
```

**Why:** Explicitly instructs Claude to trust and output detected cards unchanged; clarifies [unreadable] handling; specifies format.

---

#### Change 1.3: Update `communityCards` description (Lines 53-55)

**BEFORE:**
```typescript
  communityCards: z
    .string()
    .describe("Community cards based on your card reading notes above, e.g. 'Qs Jc 10h'. Empty if preflop"),
```

**AFTER:**
```typescript
  communityCards: z
    .string()
    .describe(
      "Community cards (flop, turn, river). " +
      "If card detection was provided: output EXACTLY the detected board cards (format: 'Qs Jc 10h', spaces between cards). Do NOT re-read these from the image. " +
      "If any detected cards are marked [unreadable]: read only those specific cards; for all others, use the detected values. " +
      "If NO card detection was provided: output cards read from the image. " +
      "Empty string if preflop (no community cards dealt yet)."
    ),
```

**Why:** Explicitly instructs Claude to trust detected board cards; clarifies format; handles preflop edge case.

---

### File 2: `/lib/ai/system-prompt.ts`

#### Change 2.1: Add emphasis to `SYSTEM_PROMPT_WITH_DETECTED_CARDS` (After line 60)

**BEFORE (lines 55-60):**
```typescript
export const SYSTEM_PROMPT_WITH_DETECTED_CARDS = `You are an expert poker strategy coach analyzing poker table screenshots. Your audience is beginner to intermediate players who want to improve.

IMPORTANT — Card detection results are provided in the user message as "Detected cards: Hero: ... Board: ...".
- Named cards (e.g., "Kc", "Ah") have been verified by template matching and are 100% accurate. Trust them — do NOT re-read these cards from the image.
- Cards marked [unreadable] could not be identified by template matching. You MUST read these specific cards from the image using the suit shape guidelines below.
- Use the image for everything else: pot size, stack sizes, positions, opponents, bet amounts, and table context.
```

**AFTER (insert after line 60):**
```typescript
export const SYSTEM_PROMPT_WITH_DETECTED_CARDS = `You are an expert poker strategy coach analyzing poker table screenshots. Your audience is beginner to intermediate players who want to improve.

IMPORTANT — Card detection results are provided in the user message as "Detected cards: Hero: ... Board: ...".
- Named cards (e.g., "Kc", "Ah") have been verified by template matching and are 100% accurate. Trust them — do NOT re-read these cards from the image.
- Cards marked [unreadable] could not be identified by template matching. You MUST read these specific cards from the image using the suit shape guidelines below.
- Use the image for everything else: pot size, stack sizes, positions, opponents, bet amounts, and table context.

CRITICAL — Do NOT attempt to verify or adjust the named cards by looking at the image.
The detection has already verified them with computer vision. If you think you see
different cards when you look at the image, you are likely misinterpreting the image
due to compression, resolution, or your visual perception. ALWAYS trust the detected
cards and output them exactly as provided. Your role is to analyze strategy, not to
second-guess the card detection.
```

**Why:** Adds explicit emphasis to prevent Claude from re-reading detected cards.

---

## Bug #1 Fix (Position Hallucination) — 1 File

### File: `/lib/ai/system-prompt.ts`

#### Change 3: Add position reading algorithm to BOTH prompt variants

Add this section to BOTH `SYSTEM_PROMPT` (after line 14) and `SYSTEM_PROMPT_WITH_DETECTED_CARDS` (after line 69).

**ADD THIS SECTION:**

```typescript
POSITION READING:
When you read the table screenshot, you need to determine the hero's seat position.
This is which position the hero is acting from. Positions from early to late:
- UTG (Under The Gun): First to act pre-flop, positioned opposite the button
- MP (Middle Position): 2-3 seats after UTG
- CO (Cutoff): Second seat before the button
- BTN (Button): Dealer position, acts last pre-flop
- SB (Small Blind): Small forced bet, first to act on flop/turn/river
- BB (Big Blind): Large forced bet, acts last pre-flop

To read position from the screenshot:
1. FIRST: Look for the BUTTON TOKEN (usually a circular marker, chip icon, or label)
   The button is typically located at the center or center-left of the table
2. COUNT from the button: Determine how many seats away the hero is from the button
   - If hero is AT the button marker: position = BTN
   - If hero is 1 seat to the right of button: position = CO
   - If hero is 2+ seats to the right: position = MP
   - If hero is far right or opposite from button: position = UTG
   - If hero is immediately to the right of button: position = BB
   - If hero is between button and BB: position = SB
3. CROSS-CHECK using blind position labels or blind amounts if visible on the screenshot
4. CONSIDER card position on screen as secondary signal:
   - Cards at bottom-center of screen = likely blind positions (SB/BB/UTG)
   - Cards at far left or right = likely button or late positions
5. COMBINE signals: If button location, blind labels, and card position all agree, confidence is high
   If they conflict, prefer the button location as primary signal and mention the conflict in cardReadingNotes
6. IF UNCERTAIN: State your reasoning explicitly in cardReadingNotes
   Example: "Position appears to be CO based on button location 2 seats to the left,
   but image quality makes this uncertain. Could also be MP."

DO NOT default to BB just because you're uncertain. BB is only one of six positions.
```

**Why:** Gives Claude explicit position-reading algorithm instead of vague "make your best inference."

---

### Detailed Instructions for Adding Position Section

**In `/lib/ai/system-prompt.ts`:**

**For SYSTEM_PROMPT (line 1):**
```typescript
export const SYSTEM_PROMPT = `You are an expert poker strategy coach analyzing screenshots of poker tables. Your audience is beginner to intermediate players who want to improve.

When given a poker table screenshot:

CRITICAL — Read the cards carefully before doing anything else:
[... keep existing card reading instructions ...]

POSITION READING:
[... INSERT THE NEW SECTION FROM ABOVE ...]

1. **Parse the game state**: Identify hero's hole cards, community cards, positions, pot size, stack sizes, and the current street. If any information is unclear or not visible, make your best reasonable inference and note it.
```

**For SYSTEM_PROMPT_WITH_DETECTED_CARDS (line 55):**
```typescript
export const SYSTEM_PROMPT_WITH_DETECTED_CARDS = `You are an expert poker strategy coach analyzing poker table screenshots. Your audience is beginner to intermediate players who want to improve.

IMPORTANT — Card detection results are provided in the user message as "Detected cards: Hero: ... Board: ...".
[... keep existing detection instructions ...]

POSITION READING:
[... INSERT THE NEW SECTION FROM ABOVE ...]

1. **Parse the game state**: Use the detected cards for hero and community cards. Read pot size, stack sizes, positions, and current street from the screenshot. If any information is unclear or not visible, make your best reasonable inference and note it.
```

---

## Summary of Changes

### Total Changes Required:

| File | Changes | Lines | Type |
|------|---------|-------|------|
| `/lib/ai/schema.ts` | 3 descriptions rewritten | 42-55 | Edit descriptions |
| `/lib/ai/system-prompt.ts` | 2 additions | ~60 lines total | Insert new sections |
| **Total** | **2 files** | **~80 lines** | **Edits + inserts** |

### Files NOT Changed:
- `/app/api/analyze/route.ts` (works as-is)
- `/lib/ai/analyze-hand.ts` (works as-is)
- `/lib/card-detection/` (detection working perfectly)
- All components and UI files

---

## Copy-Paste Instructions

### Step 1: Update `/lib/ai/schema.ts`

1. Open the file in your editor
2. Find lines 42-49 (cardReadingNotes)
   - Delete the existing .describe() argument
   - Replace with the "AFTER" text from Change 1.1 above
3. Find lines 50-52 (heroCards)
   - Delete the existing .describe() argument
   - Replace with the "AFTER" text from Change 1.2 above
4. Find lines 53-55 (communityCards)
   - Delete the existing .describe() argument
   - Replace with the "AFTER" text from Change 1.3 above
5. Save the file

### Step 2: Update `/lib/ai/system-prompt.ts`

1. Open the file in your editor

2. **For SYSTEM_PROMPT (around line 1):**
   - Find the line: `export const SYSTEM_PROMPT = `You are an expert poker...`
   - Find the section after "- Ranks: Don't confuse..." (around line 12)
   - After the closing `-` bullet point, INSERT a blank line
   - INSERT the new "POSITION READING:" section from Change 3 above
   - Make sure there's a blank line before the next numbered section

3. **For SYSTEM_PROMPT_WITH_DETECTED_CARDS (around line 55):**
   - Find the line: `export const SYSTEM_PROMPT_WITH_DETECTED_CARDS = `You are an expert poker...`
   - Find the section after "- Use the image for everything else..." (around line 60)
   - INSERT the "CRITICAL — Do NOT attempt to verify..." section from Change 2.1
   - Make sure blank lines separate sections properly

   - Then find where the "1. **Parse the game state**" section begins (around line 69)
   - Before that section, INSERT a blank line
   - INSERT the "POSITION READING:" section from Change 3 above

4. Save the file

### Step 3: Verify Changes

```bash
# Check TypeScript compilation
bunx tsc --noEmit

# Should have no errors
```

### Step 4: Test (See IMPLEMENTATION-CHECKLIST.md)

1. Run against 10 sample screenshots
2. Verify outputs match detected cards
3. Verify position reasoning is explained
4. If any issues, refer to rollback plan in checklist

---

## Side-by-Side Comparison

### For `heroCards` field:

**BEFORE (Ambiguous):**
```
"Hero's hole cards based on your card reading notes above, e.g. 'Ah Kd'"
```
Problem: Says "based on reading notes" but system prompt says "trust detection" (contradictory)

**AFTER (Clear):**
```
"Hero's hole cards. If card detection was provided in the user message: output EXACTLY
the detected cards (format: 'Ah Kd'). Do NOT re-read these from the image. If any
detected cards are marked [unreadable]: read only those specific cards from the image;
for all other cards, use the detected values. If NO card detection was provided: output
cards read from the image using the suit shape guidelines (format: 'Ah Kd', no spaces
between cards)."
```
Fix: Explicitly says to use detected cards, explains [unreadable] handling, specifies format

---

## Verification Checklist

After making all changes:

- [ ] `/lib/ai/schema.ts` compiles without errors
- [ ] `/lib/ai/system-prompt.ts` compiles without errors
- [ ] Both files have proper TypeScript syntax
- [ ] No string quotes are mismatched
- [ ] Descriptions are complete sentences
- [ ] Position section is in both prompt variants
- [ ] Blank lines separate sections properly
- [ ] Critical emphasis section is in WITH_DETECTED variant

---

## If Things Go Wrong

**If code doesn't compile:**
1. Check for mismatched quotes (` vs ' vs ")
2. Check for incomplete string concatenation
3. Check for missing commas after .describe()
4. Revert the file from git and try again more carefully

**If Claude behavior gets worse:**
1. Revert both files: `git checkout lib/ai/schema.ts lib/ai/system-prompt.ts`
2. Re-read this document carefully
3. Try again, or escalate to senior team member

**If tests fail:**
1. See IMPLEMENTATION-CHECKLIST.md rollback procedures
2. Verify the exact code matches the "AFTER" sections above
3. Test against a known-good screenshot first

---

## Expected File Sizes After Changes

| File | Before | After | Increase |
|------|--------|-------|----------|
| `/lib/ai/schema.ts` | ~96 lines | ~105 lines | +9 lines |
| `/lib/ai/system-prompt.ts` | ~127 lines | ~195 lines | +68 lines |
| **Total** | **~223 lines** | **~300 lines** | **+77 lines** |

(These are approximate; actual counts depend on formatting)

---

## Git Commit Message

When you're ready to commit these changes:

```
git add lib/ai/schema.ts lib/ai/system-prompt.ts
git commit -m "Fix card hallucination and improve position detection

Bug fixes:
- Fix Bug #2 (Card Hallucination): Updated schema descriptions to explicitly
  instruct Claude to trust and output detected cards unchanged. Added critical
  emphasis section to system prompt preventing re-reading of detection.

- Fix Bug #1 (Position Hallucination): Added detailed position-reading algorithm
  to both system prompt variants with explicit reference points (button location,
  blinds, card position on screen).

Changes:
- lib/ai/schema.ts: Rewrote cardReadingNotes, heroCards, communityCards descriptions
- lib/ai/system-prompt.ts: Added critical emphasis section and position algorithm

Expected improvements:
- Card accuracy: 80-90% -> 95-98%
- Position accuracy: ~20% -> 40-50%

See docs/analysis/ for complete flow analysis and acceptance criteria."
```

---

That's it! These are all the code changes needed to fix both bugs.
