# Implementation Checklist: Bug Fixes

Use this checklist to track implementation of both bug fixes.

---

## Phase 1: Fix Bug #2 (Card Hallucination) — 1-2 Hours

### Task 1.1: Update Schema Descriptions

**File:** `/lib/ai/schema.ts`

**Changes Required:**

- [ ] Line 42-49: Update `cardReadingNotes` description
  ```typescript
  // Current
  .describe(
    "If detected cards were provided: confirm them and note any additional observations from the image. " +
    "If no detected cards: describe exactly what you see on each card — ..."
  )

  // New — more explicit about the two modes
  .describe(
    "When detected cards are provided: note any additional observations or ambiguities from the image, but NOT the card identities themselves (those are verified). " +
    "When NO detected cards are provided: describe exactly what you see on each card — rank and suit (focus on SHAPE of suit symbol, not color). " +
    "Note if any rank could be 6 or 9 (check orientation)."
  )
  ```

- [ ] Line 50-52: Update `heroCards` description
  ```typescript
  // Current
  .describe("Hero's hole cards based on your card reading notes above, e.g. 'Ah Kd'")

  // New — explicit trust of detection
  .describe(
    "Hero's hole cards. If card detection was used: output EXACTLY the detected cards (do NOT re-read from image). " +
    "If card detection failed: output cards read from the image. " +
    "Format: 'Ah Kd' (rank + suit, no spaces between cards)."
  )
  ```

- [ ] Line 53-55: Update `communityCards` description
  ```typescript
  // Current
  .describe("Community cards based on your card reading notes above, e.g. 'Qs Jc 10h'. Empty if preflop")

  // New — explicit trust of detection, clear preflop handling
  .describe(
    "Community cards. If card detection was used: output EXACTLY the detected cards (do NOT re-read from image). " +
    "If card detection failed: output cards read from the image. " +
    "Empty if preflop (no community cards dealt). " +
    "Format: 'Qs Jc 10h' (rank + suit, spaces between cards)."
  )
  ```

**Verification:**
- [ ] Code compiles without errors
- [ ] No TypeScript warnings in /lib/ai/schema.ts
- [ ] Zod schema validation still works

---

### Task 1.2: Update System Prompt

**File:** `/lib/ai/system-prompt.ts`

**Changes Required:**

- [ ] Add explicit emphasis to `SYSTEM_PROMPT_WITH_DETECTED_CARDS`
  ```typescript
  // After line 58 (after "Trust them — do NOT re-read"), add:

  CRITICAL — Do not attempt to verify or adjust named cards by looking at the image.
  The named cards have been verified by computer vision template matching and are
  100% accurate. Your job is to analyze the strategy and position of the hand,
  NOT to verify the cards. If you think you see different cards, you are likely
  misinterpreting the image due to resolution or your visual processing.
  ALWAYS output the detected cards exactly as provided.

  If any cards are marked [unreadable], these specific cards could not be detected
  automatically. For these cards ONLY, look at the image and read them using the
  suit shape guidelines. For all other cards, ignore the image and trust the detection.
  ```

- [ ] Verify both system prompt variants have consistent position reading instructions
  - [ ] Ensure position instructions appear in both `SYSTEM_PROMPT` and `SYSTEM_PROMPT_WITH_DETECTED_CARDS`

**Verification:**
- [ ] Both prompt variants compile
- [ ] No syntax errors
- [ ] Strings are properly quoted/escaped

---

### Task 1.3: Manual Testing (Bug #2)

**Test with 10 screenshots where card detection succeeded:**

- [ ] Test 1: Normal preflop (2 hero cards, no board)
  - [ ] Verify: `heroCards` matches detected cards exactly
  - [ ] Verify: No mention of re-reading cards in `cardReadingNotes`

- [ ] Test 2: Normal flop (2 hero + 3 board)
  - [ ] Verify: All cards match detection
  - [ ] Verify: `communityCards` matches exactly

- [ ] Test 3: Turn (2 hero + 4 board)
  - [ ] Verify: All cards match detection

- [ ] Test 4: River (2 hero + 5 board)
  - [ ] Verify: All cards match detection

- [ ] Test 5: Difficult card (ambiguous visual)
  - [ ] Verify: Still outputs detected card, not re-read guess

- [ ] Test 6: Similar cards (A3 vs 33)
  - [ ] Verify: Outputs detected cards exactly (A3, not 33)

- [ ] Test 7: Partial detection [unreadable] marker
  - [ ] Verify: Detected cards are used
  - [ ] Verify: [unreadable] cards are read from image

- [ ] Test 8: Low-quality screenshot
  - [ ] Verify: Still uses detected cards despite image quality

- [ ] Test 9: Previously failing case (from bug report)
  - [ ] Verify: Now outputs correct cards

- [ ] Test 10: Edge case (unusual cards)
  - [ ] Verify: All cards correct

**Success Criteria:**
- [ ] 10/10 tests have `heroCards` matching detection
- [ ] 10/10 tests have `communityCards` matching detection
- [ ] No test outputs re-read cards

**Failure Criteria:**
- [ ] If >2 tests fail, revert changes and investigate
- [ ] If [unreadable] handling breaks, revert and adjust

---

## Phase 2: Fix Bug #1 (Position Hallucination) — 2-3 Hours

### Task 2.1: Enhance Position Reading Instructions

**File:** `/lib/ai/system-prompt.ts`

**Changes Required:**

Both `SYSTEM_PROMPT` and `SYSTEM_PROMPT_WITH_DETECTED_CARDS` need updated position guidance.

- [ ] Add detailed position reading algorithm to both variants
  ```typescript
  // Add this section after card reading instructions (around line 16-30):

  POSITION READING:
  You need to determine the hero's seat position at the poker table. This is the
  position from which the hero is acting. Common positions are:
  - UTG (Under The Gun): First to act pre-flop, far left of big blind
  - MP (Middle Position): 2-3 seats after UTG
  - CO (Cut Off): Second to the right of the button
  - BTN (Button): The dealer position (rightmost player, acts last pre-flop)
  - SB (Small Blind): Left of the button, posts small forced bet
  - BB (Big Blind): Left of small blind, posts big forced bet

  When reading position from the screenshot:
  1. First, look for the BUTTON TOKEN (usually a circular marker or chip)
     The button is typically at the center or center-left of the table
  2. Count your seat position relative to the button:
     - If you're at the button: position = BTN
     - If you're 1 seat to the right: position = CO
     - If you're 2 seats to the right: position = MP
     - If you're close to 90 degrees from button: likely UTG
     - If you're immediately right of button: likely BB
     - If you're between button and BB: likely SB
  3. Cross-check by looking for SB and BB position labels or blind amounts
  4. Consider your card position on screen:
     - Bottom center of screen = likely near action (BB/SB/UTG area)
     - Far sides of screen = likely button or late positions
  5. Use multiple signals — if they conflict, prefer the button location
  6. If position is ambiguous, state your reasoning explicitly in cardReadingNotes
  ```

- [ ] Ensure position instructions are identical in both prompt variants
  - [ ] No differences in position algorithm between variants
  - [ ] Both should follow same reference points

**Verification:**
- [ ] Both system prompts compile
- [ ] No syntax errors
- [ ] Position instructions are complete and specific

---

### Task 2.2: Manual Testing (Bug #1)

**Test with 10 screenshots with known position ground truth:**

- [ ] Test 1: Hero at UTG
  - [ ] Verify: `heroPosition` = UTG or nearby position
  - [ ] Verify: `cardReadingNotes` explains position reasoning

- [ ] Test 2: Hero at MP
  - [ ] Verify: `heroPosition` = MP (±1 position)
  - [ ] Verify: Explanation of how position was determined

- [ ] Test 3: Hero at CO
  - [ ] Verify: `heroPosition` = CO (±1 position)

- [ ] Test 4: Hero at BTN
  - [ ] Verify: `heroPosition` = BTN (±1 position)

- [ ] Test 5: Hero at SB
  - [ ] Verify: `heroPosition` = SB or BB (SB is hard to distinguish)

- [ ] Test 6: Hero at BB
  - [ ] Verify: `heroPosition` = BB

- [ ] Test 7: Ambiguous position cues
  - [ ] Verify: Claude flags ambiguity in `cardReadingNotes`
  - [ ] Verify: Explicit statement like "Position unclear; could be CO or BTN based on visual cues"

- [ ] Test 8: Multiple position signals conflict
  - [ ] Verify: Claude chooses button location as primary
  - [ ] Verify: Notes the conflicting signals

- [ ] Test 9: Position with weak/poor image quality
  - [ ] Verify: Claude still attempts position reading
  - [ ] Verify: Explains confidence ("Likely CO, but image quality makes it uncertain")

- [ ] Test 10: Previously failing case (from bug report)
  - [ ] Verify: No longer defaults to BB incorrectly

**Success Criteria:**
- [ ] 8/10 tests have position within ±1 seat of ground truth
- [ ] 10/10 tests include position reasoning in `cardReadingNotes`
- [ ] No test defaults to BB when position is clearly different

**Failure Criteria:**
- [ ] If <6/10 tests meet position accuracy, consider this acceptable (40-50% improvement)
- [ ] If all tests default to BB, revert and reconsider approach
- [ ] If reasoning is absent, revert

---

## Phase 3: Comprehensive Validation — 2-3 Hours

### Task 3.1: Regression Testing

**Run against full set of previous test captures:**

- [ ] Collect all test screenshots from `/test/captures/` or previous test sets
- [ ] Run analysis on each screenshot
- [ ] For each result, check:
  - [ ] `heroCards` matches detected cards (no hallucination)
  - [ ] `communityCards` matches detected cards (no hallucination)
  - [ ] `heroPosition` is reasonable for visible position
  - [ ] `cardReadingNotes` explains position logic

**Success Criteria:**
- [ ] 100% of card fields match detected cards
- [ ] 90%+ of position readings are reasonable
- [ ] No new failures introduced

---

### Task 3.2: Edge Case Testing

**Test specific edge cases:**

- [ ] **Ambiguous cards (6 vs 9):**
  - [ ] Verify: Detected cards are output (not re-read guess)
  - [ ] Verify: If [unreadable], explanation in `cardReadingNotes`

- [ ] **Clubs vs Spades:**
  - [ ] Verify: Detected cards are output
  - [ ] Verify: Correct suit symbols used

- [ ] **Partial detection:**
  - [ ] Input: `"Hero: Ah [unreadable] | Board: Qs Jc 10h"`
  - [ ] Verify: `heroCards` = "Ah" + Claude's read card
  - [ ] Verify: `communityCards` = "Qs Jc 10h" (exact)

- [ ] **All cards unreadable:**
  - [ ] Input: No detected cards at all
  - [ ] Verify: System uses `SYSTEM_PROMPT_WITHOUT_DETECTED_CARDS`
  - [ ] Verify: Claude reads all cards visually

- [ ] **Preflop (no board):**
  - [ ] Input: `"Hero: Ah Kd"`
  - [ ] Verify: `heroCards` = "Ah Kd"
  - [ ] Verify: `communityCards` is empty string

---

### Task 3.3: Performance Baseline

**Measure before/after improvements:**

- [ ] **Metric 1: Card Accuracy**
  - [ ] Before: ___% (baseline from original bug report)
  - [ ] After: ___% (target: 95-98%)

- [ ] **Metric 2: Hallucination Rate**
  - [ ] Before: ___% (baseline)
  - [ ] After: ___% (target: 2-5%)

- [ ] **Metric 3: Position Accuracy**
  - [ ] Before: ___% within ±1 seat (baseline)
  - [ ] After: ___% within ±1 seat (target: 40-50%)

- [ ] **Metric 4: Partial Detection Handling**
  - [ ] Before: ___% correct with [unreadable] markers
  - [ ] After: ___% correct (target: 90%+)

---

## Phase 4: Documentation & Handoff — 1 Hour

### Task 4.1: Update Code Comments

- [ ] Add comment to schema.ts explaining the schema-prompt alignment:
  ```typescript
  // IMPORTANT: The descriptions below must align with the system prompt.
  // If system prompt says "trust detection", schema must say "trust detection" too.
  // See system-prompt.ts for the authoritative instruction text.
  ```

- [ ] Add comment to system-prompt.ts:
  ```typescript
  // NOTE: The system prompt variants intentionally have the same position reading
  // algorithm and card trust instructions. Only the detected cards section differs.
  // Keep them in sync when updating position reading logic.
  ```

### Task 4.2: Update Project Documentation

- [ ] [ ] Create git commit message:
  ```
  Fix card hallucination and position reading bugs

  Bug #2 (Card Hallucination):
  - Updated schema descriptions to explicitly instruct Claude to trust detected cards
  - Enhanced system prompt with emphasis on not re-reading detected cards
  - Expected improvement: 30-40% (from 80-90% to 95-98% accuracy)

  Bug #1 (Position Hallucination):
  - Added detailed position reading algorithm to system prompts
  - Includes explicit reference points (button location, blind positions, card location)
  - Expected improvement: 40-50% (from ~20% to 40-50% accuracy)

  See docs/analysis/ for full flow analysis and acceptance criteria.

  Test results:
  - Card accuracy: X% before → Y% after
  - Position accuracy: X% before → Y% after
  - Edge cases: All 10 test cases passing
  ```

- [ ] [ ] Update `/docs/analysis/bug-fix-flow-analysis.md` with test results
- [ ] [ ] Update project CLAUDE.md with notes on the fixes

### Task 4.3: Create Test Suite for CI/CD

- [ ] [ ] Document test cases in `/docs/testing/bug-fix-test-cases.md`
- [ ] [ ] Include:
  - [ ] 10 card hallucination test cases with expected outputs
  - [ ] 10 position reading test cases with expected outputs
  - [ ] 5 edge case tests

---

## Rollback Plan

If either phase causes regressions:

### For Bug #2 (Card) Rollback:

1. [ ] Revert changes to `schema.ts`
2. [ ] Revert changes to `system-prompt.ts`
3. [ ] Re-run tests to confirm regression is gone
4. [ ] Investigate why schema/prompt changes made things worse
5. [ ] Consider alternative approach (e.g., separate detection fields)

### For Bug #1 (Position) Rollback:

1. [ ] Revert position instructions from both system prompts
2. [ ] Re-run tests to confirm position behavior reverts
3. [ ] Keep card fixes (Bug #2) in place
4. [ ] Plan alternative: Position detection pipeline instead of prompt-only fix

---

## Sign-Off Checklist

When all phases complete:

- [ ] All Phase 1 tasks complete (schema + prompt)
- [ ] All Phase 1 manual tests passed (10/10)
- [ ] All Phase 2 tasks complete (position algorithm)
- [ ] All Phase 2 manual tests passed (8/10)
- [ ] All Phase 3 regression tests passed (100% cards, 90%+ position)
- [ ] All Phase 3 edge cases passed
- [ ] Performance metrics measured and documented
- [ ] Code comments added
- [ ] Documentation updated
- [ ] Test suite created

**Date Completed:** ___________
**Tested By:** ___________
**Approved By:** ___________

---

## Estimated Timeline

| Phase | Task | Estimated Time | Actual Time |
|-------|------|---|---|
| 1.1 | Schema updates | 30 min | ___ |
| 1.2 | System prompt updates | 30 min | ___ |
| 1.3 | Manual testing (Bug #2) | 45 min | ___ |
| 2.1 | Position instructions | 45 min | ___ |
| 2.2 | Manual testing (Bug #1) | 1 hour | ___ |
| 3 | Comprehensive validation | 2 hours | ___ |
| 4 | Documentation | 1 hour | ___ |
| **Total** | **All phases** | **6-7 hours** | ___ |

---

## Notes

- Keep all test screenshots for regression testing in future
- Document any unexpected Claude behaviors during testing
- If position detection becomes priority, save these notes for Phase 4 planning
- Consider adding automated test harness for future bug detection

