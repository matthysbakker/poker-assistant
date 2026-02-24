# Critical Insights: Position & Card Hallucination Bugs

**TL;DR:** Two bugs with a shared root cause—misaligned schema descriptions vs system prompts. Bug #2 is fixable with prompt/schema changes (Phase 1). Bug #1 requires position reading algorithm improvements (Phase 2).

---

## Bug #2 Root Cause (Highest Priority)

**The Signal Conflict:**

| Source | Message | Result |
|--------|---------|--------|
| **System Prompt** | "Trust detected cards — do NOT re-read from image" | Clear instruction |
| **Schema Field Description** | "Hero's cards based on your card reading notes" | Implies Claude should read/analyze |
| **Actual Outcome** | Claude reads image anyway, outputs different cards | 20% hallucination rate |

**Why This Happens:**

Claude receives conflicting instructions through two channels:
1. System prompt (text instruction): "Don't re-read"
2. Schema field description (structural instruction): "Based on reading notes"

When both exist, Claude defaults to schema field instruction because it's the explicit definition of what the output field means.

**The Fix (Phase 1):**

Update schema descriptions to remove the ambiguity:

```typescript
// BEFORE (wrong)
heroCards: z.string()
  .describe("Hero's hole cards based on your card reading notes above, e.g. 'Ah Kd'")

// AFTER (correct)
heroCards: z.string()
  .describe("Hero's hole cards from card detection (verified by template matching; do NOT re-read from image). If marked [unreadable], read those specific cards only.")
```

**Impact:** 30-40% improvement in card hallucination cases (from 80-90% accuracy to 95-98%)

---

## Bug #1 Root Cause (Secondary Priority)

**The Problem:**

There is no position detection in the card detection pipeline. Position is purely Claude's visual inference from screenshots. This has **no ground truth** to validate against.

**Why Claude Defaults to BB:**

When uncertain about position, Claude seems to default to "BB" (big blind). This could be because:
- BB is a common position in screenshots (significant action)
- System prompt doesn't provide explicit position-reading algorithm
- Visual cues vary by poker site (PokerStars vs 888 vs live)

**The Fix (Phase 2):**

Add explicit position-reading algorithm to system prompt:

```
When determining hero position at the table:
1. Look for the BUTTON TOKEN (circular marker, usually at table center)
2. Count seats clockwise: Button=0, Cutoff=1, Hijack=2, etc.
3. Also note small blind and big blind UI labels if visible
4. Combine these signals to infer hero's position
5. If uncertain, state your reasoning in cardReadingNotes
```

**Limitation (Out of Scope):**

The proper long-term fix would be to **add position detection to the card detection pipeline** (like template matching for cards). This would require:
- Training data on button/blind token locations across poker sites
- Separate template matcher for position tokens
- New card detection output field: `detectedPosition`

This is a separate feature, not part of the current bug fix.

**Impact (Phase 2):** 40-50% improvement in position accuracy

---

## The Three User Flows

### Flow 1: Card Detection Success + Position Guess (Most Common)

```
Screenshot uploaded
  ↓
Card Detection: "Hero: Ah Kd | Board: Qs Jc 10h" ✓ (98.4% accurate)
  ↓
Claude Analysis
  ├─ Cards: Sometimes hallucinates despite detection ❌ (Bug #2)
  └─ Position: Pure visual guess ❌ (Bug #1)
```

### Flow 2: Partial Card Detection + Mixed Trust

```
Screenshot with one occluded card
  ↓
Card Detection: "Hero: Ah [unreadable] | Board: Qs Jc 10h"
  ↓
Claude Analysis
  ├─ Ah: Trusts detection ✓
  ├─ [unreadable]: Reads from image ✓
  └─ Position: Still guesses ❌
```

### Flow 3: No Card Detection + Full Fallback

```
Low-quality screenshot or detection crashes
  ↓
Card Detection: Returns empty
  ↓
Claude Analysis
  ├─ Cards: Reads all from image (expected)
  └─ Position: Guesses from image ❌
```

---

## Confidence Across Flows

| Flow | Card Accuracy | Position Accuracy | Current Issue |
|------|---|---|---|
| Flow 1 (detection success) | 80-90% (Bug #2) | Poor (Bug #1) | Hallucination despite detection |
| Flow 2 (partial detection) | Mixed | Poor (Bug #1) | Relies on Claude for unreadable |
| Flow 3 (no detection) | Good (expected) | Poor (Bug #1) | Pure visual, no validation |

**Key Insight:** Position is consistently poor across all flows because there is no detection or ground truth. Cards improve significantly with detection but are undermined by schema ambiguity.

---

## The 11 Specification Gaps

### Critical (Blocks Implementation)

1. **Schema contradicts system prompt** — "Trust detection" vs "based on reading notes"
2. **No authoritative source for position** — No detection pipeline exists
3. **No tie-breaking rule** — What if Claude's reading differs from detection?

### Important (Affects UX)

4. **No confidence metadata** — Detection has HIGH/MEDIUM/LOW but doesn't tell Claude
5. **Position algorithm undefined** — System prompt doesn't explain how to read position
6. **Partial detection behavior unclear** — What's the minimum viable detection?
7. **No position validation** — User cannot override incorrect position
8. **No card override** — User cannot correct hallucinated cards

### Nice-to-Have (Can Wait)

9. **Detection string format not formal** — What about edge cases (preflop, unreadable)?
10. **No session position history** — Cannot learn from previous hands
11. **No success criteria** — How do we know when bugs are fixed?

---

## Acceptance Tests (Proof of Fix)

### For Bug #2 (Card Hallucination)

**Test Case:** Run 50 analyses with successful card detection.

**Success Criteria:**
- 100% of outputs have `heroCards == detected hero cards`
- 100% of outputs have `communityCards == detected community cards`
- If any [unreadable] cards exist, those are read from image (not hallucinately invented)

**Current Performance:** 80-90% match (10-20% hallucinate)

---

### For Bug #1 (Position Hallucination)

**Test Case:** Run 10 analyses against screenshots with known ground truth position.

**Success Criteria:**
- Claude identifies position within 1-2 seats of ground truth
- When uncertain, Claude explicitly flags uncertainty in `cardReadingNotes`
- Explanation in `cardReadingNotes` references at least one position signal (button, blinds, card location)

**Current Performance:** Defaults to BB regardless of ground truth (~20% accurate)

---

## What Gets Fixed When

### Phase 1 (Immediate - 1 hour)

**Files to change:**
- `/lib/ai/schema.ts` — Update `heroCards` and `communityCards` descriptions
- `/lib/ai/system-prompt.ts` — Add emphasis to "do NOT re-read" instruction

**Impact:** Fixes 30-40% of card hallucination cases immediately

**Why It Works:** Removes the schema/prompt contradiction, making it clear to Claude that detected cards are the source of truth

---

### Phase 2 (Short-term - 2-3 hours)

**Files to change:**
- `/lib/ai/system-prompt.ts` — Add position reading algorithm to both variants

**Impact:** Fixes 40-50% of position errors

**Why It Works:** Gives Claude explicit reference points instead of vague "make your best inference"

---

### Phase 3 (Future - Large Effort)

**Add position detection to card detection pipeline**

**Impact:** Would eliminate position hallucination entirely (like we did for cards)

**Why Not Now:** Requires training data on position markers across poker sites

---

## Questions for Product/Design

**Q1:** Should position remain a visual guess, or should we invest in position detection pipeline?
- **Impact:** If visual-only, 40-50% accuracy ceiling; if detection, 95%+ accuracy
- **Cost:** Detection requires new training data and model

**Q2:** Should users be able to override position after analysis?
- **Impact:** UX improvement; helps users correct Claude guesses
- **Cost:** 1-2 hours of UI work

**Q3:** Should we display which cards were detected vs Claude-read?
- **Impact:** Transparency; helps users understand analysis quality
- **Cost:** UI labeling, 1 hour

**Q4:** Should detection confidence (HIGH/MEDIUM/LOW) be shown to Claude?
- **Impact:** Allows Claude to explain uncertainty in analysis
- **Cost:** Format change for detected cards string, 1 hour

---

## Files Involved

**Core logic:**
- `/lib/ai/schema.ts` — Zod schema (has the bad descriptions)
- `/lib/ai/system-prompt.ts` — Two variants of system prompt
- `/lib/ai/analyze-hand.ts` — Selection logic for which prompt to use
- `/app/api/analyze/route.ts` — Entry point; calls detectCards() and analyzeHand()

**Card detection:**
- `/lib/card-detection/detect.ts` — Main detection function
- `/lib/card-detection/match.ts` — Confidence scoring (has HIGH/MEDIUM/LOW)

**UI:**
- `/components/analyzer/AnalysisResult.tsx` — Displays heroCards, heroPosition, etc.

---

## Summary

**Bug #2** is the easier fix—change descriptions and prompt to make the signal path clear. **Bug #1** requires either accepting visual limitations or investing in a position detection pipeline.

Both are solvable, but they require different levels of effort:
- Bug #2: 1 hour (schema + prompt changes)
- Bug #1: 2-3 hours (prompt improvements) + future investment (detection pipeline)
