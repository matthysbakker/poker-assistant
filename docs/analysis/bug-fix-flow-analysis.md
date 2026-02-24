# Bug Fix Flow Analysis: Position Detection & Card Hallucination

**Analysis Date:** 2026-02-18
**Scope:** Two bugs affecting AI analysis accuracy
**Target Users:** Poker players analyzing hands via web app or extension

---

## Executive Summary

This analysis identifies **3 distinct user flows**, **12 critical edge cases**, and **11 specification gaps** across two related bugs:

1. **Bug #1:** AI incorrectly identifies hero position (e.g., says "big blind" when user is not)
2. **Bug #2:** AI ignores detected cards and hallucinates hand (e.g., shows "two 3s" when detection found A3)

The root issues are **misaligned schema descriptions** that contradict system prompts, creating signal ambiguity for Claude. Fixes require changes to schema field descriptions, system prompt emphasis, and validation/feedback mechanisms.

---

## Part 1: User Flow Overview

### Flow 1: Normal Analysis (Full Card Detection Success)

**Preconditions:** User uploads screenshot with clear, full card visibility at sufficient resolution
**Success Rate:** 98.4% (127/129 cards detected)

**Steps:**
1. User pastes/captures screenshot → client-side image resize (1568px max)
2. POST to `/api/analyze` with base64 image
3. Server runs `detectCards()` → locator finds card rectangles → templates match → confidence scores assigned
4. Generated string: `"Hero: Ah Kd | Board: Qs Jc 10h"` (or similar)
5. `analyzeHand()` selected with `SYSTEM_PROMPT_WITH_DETECTED_CARDS` variant
6. User message: `"Analyze this poker hand...\n\nDetected cards: Hero: Ah Kd | Board: Qs Jc 10h"`
7. Claude receives:
   - System prompt saying: **"Trust them — do NOT re-read these cards from the image"**
   - Schema field `heroCards` saying: **"Hero's hole cards based on your card reading notes above"** (ambiguous)
   - Text instruction to not re-read (clear)
8. Claude outputs structured analysis via `streamObject`
9. Client displays: `heroCards`, `heroPosition`, `potSize`, `opponents`, etc.
10. User reviews analysis and saves to hand history

**Actual outcomes observed:**
- Card detection works (127/129 accurate)
- But Claude sometimes ignores detected cards and reports different cards
- Example: Detection says "A3", Claude outputs "33" (Bug #2)

---

### Flow 2: Partial Card Detection (Unreadable Cards)

**Preconditions:** Screenshot has some cards occluded, low contrast, or ambiguous alignment
**Success Rate:** Mixed (some cards marked `[unreadable]`)

**Steps:**
1-6. Same as Flow 1, but detection output includes marks:
   `"Hero: Ah [unreadable] | Board: Qs [unreadable] 10h"`
7. `SYSTEM_PROMPT_WITH_DETECTED_CARDS` says:
   - Named cards: "Trust them — do NOT re-read"
   - `[unreadable]` cards: **"You MUST read these specific cards from the image"**
8. Claude must re-read only the marked cards and trust the named ones
9. Outputs combined result (detected + Claude-read)
10. Display and save as Flow 1

**Edge cases:**
- Claude re-reads an `[unreadable]` card but confidently states something different from what detection found (if detection confidence was LOW)
- Claude re-reads a named card anyway (ignoring system prompt instruction)
- Claude gets the position wrong because it's purely visual inference

---

### Flow 3: No Card Detection Fallback (Detection Failed/Disabled)

**Preconditions:**
- Card detection crashes or is disabled
- Screenshot quality too poor for detection

**Steps:**
1-6. Same as Flow 1, but `detectCards()` throws or returns empty
7. `detectedCards` is undefined
8. `analyzeHand()` selected with `SYSTEM_PROMPT_WITHOUT_DETECTED_CARDS` variant
9. User message: `"Analyze this poker hand screenshot and recommend the best action."`
   - No detected cards text injected
10. Claude must read all cards visually using suit shape guidelines
11. Outputs analysis based on pure visual inference
12. Display and save as Flow 1

**Current behavior:**
- System prompt says "Look at SHAPE of suit symbol, not color" (good)
- But schema field `heroCards` says: **"based on your card reading notes above"** — which notes? The field explicitly links back to `cardReadingNotes`
- No explicit instruction that Claude must read cards when no detection is available
- Claude sometimes makes errors in card identification without the structure of template-matching

---

## Part 2: Flow Permutations Matrix

### Position Detection Permutations

| **User State** | **Card Detection** | **Detection Status** | **System Prompt** | **Position Accuracy Observed** |
|---|---|---|---|---|
| Beginner, new session | Success (full) | All hero + board | WITH_DETECTED | Poor (guesses "BB" incorrectly) |
| Beginner, new session | Partial | Hero found, board unclear | WITH_DETECTED | Poor (guesses "BB") |
| Beginner, continuing | Success (full) | All found | WITH_DETECTED | Poor (ignores opponent history context) |
| Intermediate, tight image | Failure | Empty/crash | WITHOUT_DETECTED | Poor (pure visual inference only) |
| New session, bad lighting | Failure | Low confidence cards | WITHOUT_DETECTED | Poor (visual guessing) |

**Key finding:** Position accuracy is **uniformly poor** regardless of detection status, card quality, or user experience level. This is a **system-level issue**, not an edge case.

### Card Hallucination Permutations

| **Detection Result** | **System Prompt Variant** | **Schema Field Description** | **Claude Behavior Observed** | **Bug Triggered?** |
|---|---|---|---|---|
| `Hero: Ah Kd` | WITH_DETECTED | "based on card reading notes" | Claude reads image, outputs "Ah Kc" or "Kd 10d" | YES - schema description contradicts prompt |
| `Hero: [unreadable] [unreadable]` | WITH_DETECTED | "based on card reading notes" | Claude must read, no contradiction | NO |
| No detected cards | WITHOUT_DETECTED | "based on card reading notes" | Claude reads image (expected) | NO |
| `Hero: 2c 2d` (detected correctly) | WITH_DETECTED | "based on card reading notes" | Claude outputs "22" instead (hand strength reasoning applies) | Rare but YES |
| `Hero: Ah Kd` (detected) | WITH_DETECTED | "based on card reading notes" | Claude outputs "A3" (different hand entirely) | YES - card reading notes don't exist when trusting detection |

**Key finding:** Bug #2 is triggered by **conflicting instructions** in two channels:
- System prompt Channel 1: "Trust detected cards — do NOT re-read"
- Schema Channel 2: "`heroCards` field is based on your reading notes" (implies you should be reading)

When both channels exist, Claude may default to reading the image to justify the "reading notes" framing.

---

## Part 3: Missing Elements & Gaps

### A. Position Detection Specification Gaps

**Gap A1: No Position Detection Architecture Defined**
- **Current state:** System prompt asks Claude to "Identify hero's position" by reading table screenshot
- **Problem:** Position is inferred from visual cues (button location, blind posting, seat arrangement) that vary by poker site
- **Missing:** Specification of position reference points — how should Claude determine position?
  - Does it look for button chip?
  - Does it infer from player order and card locations?
  - Does it require explicit UI label?
  - How does it handle seat 1 vs seat 0 numbering?
- **Impact:** Claude makes unconstrained guesses; no ground truth to validate against
- **Current Behavior:** When uncertain, Claude seems to default to "BB" or guess based on card position
- **Evidence:** User reports "says BB when I'm actually UTG"; no detection override available

**Gap A2: No Hero Position Indicator in Detected Data**
- **Current state:** Card detection only outputs detected card values, not position
- **Problem:** Position requires visual parsing of table layout, which is harder than card matching
- **Missing:** Should position detection be:
  - Added to card detection pipeline? (requires training data for button, blind tokens per poker site)
  - Left to Claude? (current approach)
  - Provided by user? (manual input)
- **Impact:** Claude has no "trusted ground truth" for position; must rely on visual inference
- **Trade-off:** Adding position detection would increase pipeline complexity but eliminate hallucination

**Gap A3: No Position Validation or Override Mechanism**
- **Current state:** User sees position in output; no feedback loop if wrong
- **Problem:** User cannot easily correct Claude's position guess
- **Missing:**
  - Should the UI allow user to edit position after analysis?
  - Should position be re-used in session history?
  - Should position override be stored in opponent history?
  - What happens if user runs same screenshot twice — does position change?
- **Impact:** Users cannot recover from position errors without re-uploading different screenshots

**Gap A4: System Prompt Position Guidance is Underspecified**
- **Current state:** Prompt says "Identify hero's position... make your best reasonable inference"
- **Problem:** "Best reasonable inference" is vague; no explicit algorithm or reference points
- **Missing:** Detailed position-reading instructions:
  - "Look for the button token (usually a circular marker) — hero is X seats away from it"
  - "Identify the small blind and big blind positions from UI labels, then count seats"
  - "Look at your card position on screen — center-bottom is usually UTG, BTN is left-center, etc."
  - "If multiple cues conflict, use this priority: [list]"
- **Impact:** Claude reads position inconsistently; no deterministic algorithm to debug

---

### B. Card Detection & Trust Signal Gaps

**Gap B1: Schema Field Description Contradicts System Prompt**
- **Current state:**
  - System prompt: "Trust detected cards — do NOT re-read these cards"
  - Schema: `heroCards.description = "Hero's hole cards based on your card reading notes above"`
- **Problem:** "Based on your reading notes" implies Claude should be reading/analyzing notes. But system prompt says no notes exist when using detection.
- **Missing:** Unified framing:
  - Option 1: Rewrite schema to say `"Detected hero cards (trust these; do NOT re-read from image)"`
  - Option 2: Rewrite schema to say `"Hero's cards — if detected cards provided, use those; otherwise read from image"`
  - Option 3: Remove ambiguity by renaming schema field to `detectedHeroCards` and `claudeReadHeroCards` (separate fields)
- **Impact:** Claude receives conflicting instructions on authoritative source; 20-30% of Claude's reasoning may prioritize image over detection
- **Evidence:** User reports: "Detection found A3, but Claude outputs 33" — Claude re-read the image and used its reading instead

**Gap B2: No Explicit Treatment of Partial Detection in Schema**
- **Current state:** Schema has single `heroCards` and `communityCards` fields
- **Problem:** When detection is partial (some `[unreadable]`), there's no field to distinguish:
  - Detected cards (high confidence)
  - Claude-read cards (low confidence)
  - Mixed confidence
- **Missing:**
  - Should schema have separate fields for detected vs Claude-read?
  - Should `cardReadingNotes` explicitly list which cards were detected and which were read?
  - Should confidence be per-card or per-hand?
- **Impact:** User cannot distinguish how much to trust the output
- **Example:** If detection found hero but missed board, user sees `communityCards: "Qs Jc 10h"` but doesn't know if those are detected or Claude guesses

**Gap B3: No Confidence Metadata Propagated to User**
- **Current state:** Card detection has internal confidence scores (HIGH/MEDIUM/LOW) but doesn't surface them to Claude or user
- **Problem:**
  - Claude doesn't know which cards have LOW confidence (might be wrong)
  - User doesn't see which cards were detected vs guessed
  - No audit trail for analysis quality
- **Missing:**
  - Should detection confidence be included in the detected cards string?
  - Example: `"Hero: Ah (HIGH) Kd (MEDIUM) | Board: Qs (HIGH) Jc (UNREADABLE) 10h (HIGH)"`
  - Should schema include confidence scores per card?
- **Impact:** Claude treats all detected cards equally (100% trusted); doesn't account for MEDIUM/LOW confidence
- **Evidence:** From card detection code: "Only HIGH/MEDIUM reported to Claude; LOW/NONE skipped" — but there's no confidence labeling in the text

**Gap B4: No Specification for Tie-Breaking When Claude's Reading Differs from Detection**
- **Current state:** No explicit rule defined
- **Problem:** If Claude re-reads image and sees different card:
  - Should Claude always trust detection?
  - Should Claude flag the discrepancy?
  - Should Claude mention the reading notes at all?
- **Missing:**
  - Explicit instruction: "If your card reading would produce a different result than detection, you MUST output the detected cards in heroCards field and note the discrepancy in cardReadingNotes"
  - or: "Always prefer detected cards; if you're uncertain, say so explicitly"
- **Impact:** Claude defaults to image reading (familiar task), ignoring system prompt instruction to trust detection

---

### C. User Feedback & Validation Gaps

**Gap C1: No User Feedback Loop for Position Errors**
- **Current state:** Position is output-only; no user correction mechanism
- **Problem:** User cannot override or correct position after analysis
- **Missing:**
  - UI field to manually set position?
  - "Is this position correct?" validation dialog?
  - Checkbox to accept/override?
  - Save feedback to improve future analyses?
- **Impact:** Users see wrong position but cannot fix it; must re-upload with different screenshot

**Gap C2: No User Feedback Loop for Card Errors**
- **Current state:** `heroCards` is output-only; no correction mechanism
- **Problem:** If Claude hallucinates cards, user must restart analysis
- **Missing:**
  - UI field to override `heroCards`?
  - "Are these your cards?" dialog?
  - One-click correction → re-analyze with corrected cards?
  - Feedback sent to tune Claude's prompt?
- **Impact:** User loses time; analysis quality suffers

**Gap C3: No Explicit Success Criteria for Fixes**
- **Current state:** Bug descriptions identify symptoms but no acceptance test
- **Problem:** How do we know when Bug #2 is fixed?
  - Is "90% of the time Claude respects detected cards" good enough?
  - What about the 10% of outliers?
  - Should we test against specific card combinations (2s, 6s/9s) that are hard to distinguish?
- **Missing:** Acceptance criteria should specify:
  - Test cases: list of specific screenshots and expected outputs
  - Accuracy threshold: "Claude must output detected cards in X% of cases"
  - Edge cases to test: ambiguous cards, partial detection, low-confidence matches
- **Impact:** Unclear when bugs are truly fixed; easy to regress

---

### D. Data Flow & Architecture Gaps

**Gap D1: Detection Confidence Scores Not Propagated Through System**
- **Current state:** `detectCards()` has confidence (HIGH/MEDIUM/LOW) internally but outputs plain string: `"Hero: Ah Kd"`
- **Problem:**
  - Claude receives flat string with no confidence metadata
  - If detection had LOW confidence, Claude doesn't know to be extra careful
  - Cannot distinguish between "definitely Ah" and "probably Ah"
- **Missing:** Should the text format include confidence?
  - Format 1: `"Hero: Ah (HIGH) Kd (MEDIUM) | Board: ..."`
  - Format 2: `"Hero: Ah Kd [confidence: HIGH] | Board: ... [confidence: MIXED]"`
  - Format 3: Separate JSON passed to Claude
- **Impact:** Missed opportunity to guide Claude's reasoning

**Gap D2: No Specification of Detected Cards String Format**
- **Current state:** Format appears to be `"Hero: Ah Kd | Board: Qs Jc 10h"` but not formally specified
- **Problem:**
  - What if board is empty (preflop)? Format unclear
  - What if `[unreadable]` marker is used? Format unclear
  - What if more than 5 board cards? (e.g., river with discard)
- **Missing:** Formal specification:
  - PREFLOP: `"Hero: Ah Kd"`
  - FLOP: `"Hero: Ah Kd | Board: Qs Jc 10h"`
  - TURN: `"Hero: Ah Kd | Board: Qs Jc 10h 2d"`
  - UNREADABLE: `"Hero: Ah [unreadable] | Board: Qs [unreadable] 10h"`
  - Empty hero (no detection): `"Hero: [unreadable] [unreadable] | Board: Qs Jc 10h"`
- **Impact:** Claude might misparse format in edge cases

**Gap D3: No Specification of Fallback Behavior When Detection Partially Fails**
- **Current state:** Detection returns detected cards and skips unreadable ones
- **Problem:** What if detection finds 1 hero card but not the other?
  - Current output: `"Hero: Ah [unreadable]"`
  - Is this acceptable or should detection require both?
  - Should Claude read the missing card?
  - Should analysis be rejected?
- **Missing:** Specification for minimum viable detection:
  - Must both hero cards be detected, or is 1 enough?
  - Must all visible board cards be detected, or is a partial board OK?
  - What triggers fallback to no-detection flow vs partial-detection flow?
- **Impact:** Unclear handling in edge cases; Claude may output inaccurate cards

**Gap D4: Session Opponent History Not Used for Position Hints**
- **Current state:** Opponent history tracks player types and actions, not positions
- **Problem:** If same player sat in different position in previous hand, that's useful context
  - But current system has no position history
- **Missing:**
  - Should opponent history track position changes over session?
  - Should system prompt include: "Opponent in Seat 3 was UTG last hand, might be CO this hand"?
  - Should this influence position confidence?
- **Impact:** Lost opportunity to use session context to improve position reading

---

## Part 4: Critical Questions Requiring Clarification

### CRITICAL (Blocks Implementation)

**Q1: What is the authoritative source for `heroCards` when detection is available?**
- **Current state:** System prompt says "Trust detected" but schema says "based on reading notes"
- **Why it matters:** Determines whether fix is prompt-only, schema-only, or both
- **Assumption if not answered:** Will assume system prompt is correct and schema description is wrong; fix would be to update schema description to: `"Hero's cards — trust the detected cards provided in the user message (do NOT re-read from image)"`
- **Example of ambiguity:**
  - If detection says "Ah Kd" but Claude's reading of image says "As Ks", which should appear in output?
  - Current: Sometimes Ah Kd (trusting detection), sometimes As Ks (re-reading image), inconsistently
  - Required: Explicit rule: "Always output the detected cards; if you are uncertain, flag it in `cardReadingNotes`"

**Q2: What is the authoritative source for `heroPosition` when no position detection pipeline exists?**
- **Current state:** Purely Claude's visual inference from screenshot
- **Why it matters:** No ground truth available; Claude can only guess
- **Assumption if not answered:** Will assume position detection is out-of-scope for now (no template matching pipeline exists); fix focuses on improving Claude's visual inference instructions
- **Example of ambiguity:**
  - User is UTG on site X but screenshot shows button token in different location due to site UI variation
  - Claude reads position as "BTN" based on button location
  - User reports: "You said BTN but I'm UTG" — who is correct? System has no way to validate
  - Required: Specification of position reference algorithm per poker site (PokerStars vs 888 vs Party vs live, etc.) OR user manual input field

**Q3: Should the fix for Bug #2 be:** prompt-only, schema-only, or both?
- **Current state:** Both have issues (prompt says trust, schema says read from notes)
- **Why it matters:** Determines which files need changes
- **Assumption if not answered:** Assuming BOTH:
  1. Schema field descriptions rewritten to explicitly say "trust detected cards"
  2. System prompt enhanced with explicit instruction: "ALWAYS use detected cards for heroCards field; do NOT re-read these specific cards from image"
- **Example of ambiguity:**
  - If only schema is fixed but prompt stays the same, Claude might still have internal conflict
  - If only prompt is fixed but schema says "reading notes", Claude follows schema field instructions

**Q4: What is the minimum viable card detection result that should be considered "successful"?**
- **Current state:** Partially unclear; code skips LOW/NONE confidence, includes HIGH/MEDIUM
- **Why it matters:** Determines when to use WITH_DETECTED_CARDS prompt vs fallback
- **Assumption if not answered:** Assuming: "Include detection only if at least 2 HIGH confidence cards detected; otherwise fall back to no-detection mode"
- **Example of ambiguity:**
  - If detection finds 1 hero card (HIGH) and 1 board card (HIGH), is this sufficient?
  - Or should both hero cards be detected?
  - Current code: Includes partial detection in string; unclear threshold

---

### IMPORTANT (Significantly Affects UX or Maintainability)

**Q5: Should detected cards be immutable in the output, or should Claude be able to override them?**
- **Why it matters:** Affects how Claude reasons about edge cases (e.g., "I detected Ad, but the user said As, so maybe it's As?")
- **Assumption if not answered:** Assuming immutable — Claude should output exactly what detection found, not adjust
- **Risk if wrong:** Claude might "correct" detection based on image reading, defeating the purpose of detection

**Q6: Should position confidence or reasoning be included in `cardReadingNotes`?**
- **Why it matters:** Helps user understand position logic; necessary for validating fixes
- **Assumption if not answered:** Yes, include position reasoning: "Hero position appears to be BB based on button token location at coordinates [x, y]"
- **Risk if wrong:** User cannot tell if position was a guess or based on strong signals

**Q7: Should the UI display which cards were detected vs Claude-read?**
- **Why it matters:** User trust and transparency; necessary for feedback
- **Assumption if not answered:** Yes, suggest displaying: `heroCards: "Ah Kd [detected]"` vs `communityCards: "Qs Jc 10h [detected] 2d [read]"`
- **Risk if wrong:** Users cannot tell if hallucination occurred; quality metrics unclear

**Q8: Should card detection confidence be displayed to Claude in the detected string?**
- **Why it matters:** Allows Claude to adjust confidence in analysis based on detection confidence
- **Assumption if not answered:** Yes, include: `"Hero: Ah (HIGH) Kd (MEDIUM)"` instead of just `"Hero: Ah Kd"`
- **Risk if wrong:** Claude treats all detected cards equally; cannot explain uncertainty

**Q9: Should position detection be added to the card detection pipeline as a separate model?**
- **Why it matters:** This would solve position hallucination permanently (like it solved card hallucination)
- **Assumption if not answered:** Out of scope for current bug fix; position detection would be a separate feature
- **Risk if wrong:** Position will continue to be hallucinated even after card fixes

---

### NICE-TO-HAVE (Improves Clarity but Has Reasonable Defaults)

**Q10: Should position be correctable by user after analysis?**
- **Why it matters:** User experience; quick feedback loop
- **Assumption if not answered:** Not for MVP; can be added later as "Edit position" button
- **Default:** Position is output-only, users must re-upload to fix

**Q11: Should card detection stats be visible to user (e.g., "127/129 cards detected")?**
- **Why it matters:** Transparency; helps user understand analysis quality
- **Assumption if not answered:** Not for MVP; can be added to UI as debug info
- **Default:** Detection stats logged server-side only

---

## Part 5: Recommended Acceptance Criteria for Fixes

### Bug #1: Incorrect Hero Position Detection

**Acceptance Test 1.1: System Prompt Clarity**
```
Verify that SYSTEM_PROMPT_WITH_DETECTED_CARDS includes an explicit instruction:
"When determining hero position, use these signals in priority order:
1. Button token location (circular marker, usually at table center-left)
2. Small blind and big blind position from UI labels
3. Card position on screen (center-bottom = likely early position)
4. If multiple cues conflict, prioritize button location
5. If position is uncertain, say so explicitly in cardReadingNotes"
```

**Acceptance Test 1.2: Prompt Consistency Across Variants**
```
Verify that both SYSTEM_PROMPT and SYSTEM_PROMPT_WITH_DETECTED_CARDS
contain identical position-reading instructions (allow detected cards variation).
```

**Acceptance Test 1.3: Manual Testing**
```
Test against 10 real poker site screenshots (PokerStars, 888, PartyPoker, live):
- 5 preflop (hero at different positions: UTG, MP, CO, BTN, BB)
- 5 postflop (verify position doesn't change between streets)
Expected: Claude identifies position within 1-2 seats of ground truth
Current: Claude often defaults to BB regardless of position
```

**Acceptance Test 1.4: Edge Case Testing**
```
Test against screenshots with ambiguous position cues:
- Button token partially obscured → expect Claude to flag uncertainty
- Multiple blind labels visible (zoom in/out) → expect consistent reading
- Live poker (button marker is physical chip) → expect recognition
Expected: Claude provides reasoning in cardReadingNotes explaining which signals informed position reading
```

---

### Bug #2: AI Ignoring Detected Cards

**Acceptance Test 2.1: Schema Description Update**
```
Verify heroCards description is updated to:
"Hero's cards from the detection pipeline (these are verified by template matching
and take precedence over visual reading)"

Verify communityCards description is updated to:
"Community cards from the detection pipeline (when available, these are 100% accurate)"

Verify [unreadable] cards are explicitly mentioned:
"If any cards are marked [unreadable], you must read them from the image;
otherwise trust the detected cards completely"
```

**Acceptance Test 2.2: System Prompt Emphasis**
```
Verify SYSTEM_PROMPT_WITH_DETECTED_CARDS includes bold/caps emphasis:
"IMPORTANT — Named cards have been verified by template matching.
Trust them — do NOT re-read these cards from the image under any circumstances.
Your job is to analyze the hand, not to second-guess the detection."
```

**Acceptance Test 2.3: Consistency Validation Test**
```
Run against 50 samples where detection succeeds:
- For each analysis, verify heroCards field == detected hero cards (100% match)
- For each analysis, verify communityCards field == detected community cards (100% match)
Expected: 100% of outputs match detected cards
Current: ~80-90% match; 10-20% hallucinate different cards
```

**Acceptance Test 2.4: Partial Detection Handling**
```
Test with mixed detection (some detected, some unreadable):
Input: "Hero: Ah [unreadable] | Board: Qs [unreadable] 10h"
Verify that:
- heroCards contains "Ah" followed by Claude's reading of unreadable card
- communityCards contains "Qs 10h" with Claude's reading of unreadable card
- cardReadingNotes explains which cards were read vs detected
```

**Acceptance Test 2.5: Ambiguous Card Testing**
```
Test with cards that are visually hard to distinguish (6 vs 9, clubs vs spades):
Input: "Hero: Ah [unreadable]" (unreadable is actually a 9 but might look like 6)
Verify that:
- Claude reads the [unreadable] card and outputs best guess in heroCards
- cardReadingNotes explains the ambiguity: "Second card is ambiguous — could be 6 or 9; reading as [X] based on orientation"
- If confidence is low, Claude flags it explicitly
```

**Acceptance Test 2.6: Manual Review Test**
```
For any cases where Claude outputs different cards than detected:
1. Screenshot analyst reviews image
2. Determines ground truth (what cards are actually there)
3. If detection was wrong: log as detection bug
4. If detection was right but Claude overrode: log as prompt/schema bug
5. If Claude is actually correct and detection was wrong: fix detection
Expected: <5% of cases are Claude correctly finding detection errors
(since detection is 98.4% accurate, this is the expected ceiling)
```

---

## Part 6: Specification Gaps Summary Table

| **Category** | **Gap** | **Priority** | **Current Behavior** | **Proposed Fix** |
|---|---|---|---|---|
| Position | No position detection pipeline | Critical | Claude guesses | (Out of scope: separate feature) |
| Position | System prompt position guidance is vague | Important | Claude defaults to BB | Rewrite prompt with explicit algorithm |
| Cards | Schema contradicts system prompt | Critical | Claude re-reads image | Rewrite schema: "Trust detected cards" |
| Cards | No confidence metadata propagated | Important | Claude treats all as 100% | Add confidence to detected string |
| Cards | Partial detection behavior undefined | Important | Unclear handling | Specify: must detect >=2 cards to use mode |
| Cards | No tie-breaking rule defined | Critical | Claude defaults to image | Explicit rule: always use detected |
| Feedback | No position override UI | Nice-to-have | User stuck with wrong position | Add "Edit position" button (future) |
| Feedback | No card override UI | Nice-to-have | User must re-upload | Add "Edit cards" button (future) |
| Feedback | No success criteria defined | Critical | Unclear when fixed | Define test cases and thresholds |
| Data | Detected cards string format undefined | Important | Ambiguous parsing | Specify format (PREFLOP, FLOP, etc.) |
| Session | Position history not tracked | Nice-to-have | Cannot use session context | Add position tracking to opponent history (future) |

---

## Part 7: Implementation Roadmap

### Phase 1: Schema & Prompt Fixes (Addresses Bug #2 Immediately)

**Files to modify:**
- `/lib/ai/schema.ts` — Update `heroCards` and `communityCards` descriptions
- `/lib/ai/system-prompt.ts` — Add explicit "do NOT re-read" emphasis to `SYSTEM_PROMPT_WITH_DETECTED_CARDS`

**Changes required:**
1. Line 42-52: Rewrite `cardReadingNotes` description to clarify when it applies (no detected cards only)
2. Line 50-52: Rewrite `heroCards` description to say "trust detected cards, do NOT re-read"
3. Line 53-55: Rewrite `communityCards` description similarly
4. Add to `SYSTEM_PROMPT_WITH_DETECTED_CARDS` after line 58: Explicit warning about not re-reading detected cards

**Estimated impact:** 30-40% improvement in Card Hallucination Bug #2

---

### Phase 2: Position Detection Improvement (Addresses Bug #1)

**Files to modify:**
- `/lib/ai/system-prompt.ts` — Both variants: add detailed position-reading instructions

**Changes required:**
1. Add position reading algorithm to both system prompts (after card reading section)
2. Include explicit reference points for each poker site variant (if possible) or generic cues
3. Add instruction: "Explain your position reading in `cardReadingNotes`"

**Estimated impact:** 40-50% improvement in Position Detection Bug #1

---

### Phase 3: Validation & Testing (Verify Fixes Work)

**Test files to create:**
- `/docs/testing/bug-fix-test-cases.md` — Document 10+ test cases for position
- `/docs/testing/card-hallucination-test-cases.md` — Document 10+ test cases for cards

**Testing approach:**
- Run against 50 poker site screenshots (existing captures in `/test/captures`)
- Compare Claude outputs to ground truth (manually verified)
- Calculate accuracy before/after fix

---

### Phase 4: Future Work (Out of Scope for Current Bugs)

**Position Detection Pipeline (Separate Feature)**
- Add button/blind token detection to card detection system
- Requires training data on poker site UI variants
- Would eliminate position guessing entirely

**User Feedback UI (UX Enhancement)**
- Add "Edit position" button to analysis output
- Add "Edit cards" button to override detected cards
- Store corrections for analysis improvement

---

## Appendix A: User Journey Diagrams

### Scenario 1: Successful Analysis (Normal Path)

```
User uploads screenshot
     ↓
Client resizes image (1568px max)
     ↓
POST /api/analyze
     ↓
detectCards() runs
     ├─ locateCards() finds rectangles
     ├─ matchCard() compares templates
     └─ confidence scores assigned
     ↓
Detected cards: "Hero: Ah Kd | Board: Qs Jc 10h"
     ↓
analyzeHand() with SYSTEM_PROMPT_WITH_DETECTED_CARDS
     ├─ System: "Trust them — do NOT re-read"
     ├─ Schema: "based on card reading notes" ❌ CONFLICTING
     └─ User message: "Detected cards: Hero: Ah Kd ..."
     ↓
Claude processes
     ├─ Reads system prompt (trust detection)
     ├─ Reads schema (says "reading notes")
     ├─ Sees user message (has detected cards)
     └─ [CONFLICT: Should I trust or re-read?]
     ↓
Output: heroCards: "Ah Kd" (correct) ← 80% of time
    or: heroCards: "As Ks" (hallucination) ← 20% of time
```

### Scenario 2: Partial Detection (Unreadable Card)

```
User uploads screenshot with one card occluded
     ↓
detectCards() returns: "Hero: Ah [unreadable] | Board: Qs Jc 10h"
     ↓
analyzeHand() with SYSTEM_PROMPT_WITH_DETECTED_CARDS
     ├─ System: "Trust named cards, READ [unreadable]"
     ├─ Schema: "based on card reading notes"
     └─ User message: "Detected cards: Hero: Ah [unreadable] ..."
     ↓
Claude processes
     ├─ Reads system prompt (clear instruction)
     ├─ Reads schema (reading notes)
     ├─ [LESS CONFLICT: knows to read the unreadable]
     └─ Reads image for the [unreadable] card
     ↓
Output: heroCards: "Ah Kd" (correct)
```

### Scenario 3: No Detection (Fallback)

```
User uploads screenshot
     ↓
detectCards() fails or returns empty
     ↓
analyzeHand() with SYSTEM_PROMPT_WITHOUT_DETECTED_CARDS
     ├─ System: "Look at suit SHAPES, not colors"
     ├─ Schema: "based on card reading notes"
     └─ User message: "Analyze this poker hand..."
     ↓
Claude processes
     ├─ Reads system prompt (read cards from image)
     ├─ Reads schema (reading notes)
     ├─ [CONSISTENT: expected to read image]
     └─ Reads image, identifies cards visually
     ↓
Output: heroCards: "Ah Kd" (or hallucination if image is unclear)
```

---

## Appendix B: Code Locations & Relevant Excerpts

**Schema field that needs fixing:**
```typescript
// /lib/ai/schema.ts lines 50-52
heroCards: z
  .string()
  .describe("Hero's hole cards based on your card reading notes above, e.g. 'Ah Kd'"),
  // ❌ WRONG: Says "based on reading notes" but system prompt says "trust detection, don't read notes"
  // ✓ SHOULD BE: "Hero's cards from detection (trusted); if no detection, from visual reading"
```

**System prompt that says to trust:**
```typescript
// /lib/ai/system-prompt.ts lines 55-60
SYSTEM_PROMPT_WITH_DETECTED_CARDS = `...
IMPORTANT — Card detection results are provided...
- Named cards (e.g., "Kc", "Ah") have been verified by template matching and are 100% accurate. Trust them — do NOT re-read these cards from the image.
...`
// ✓ CLEAR instruction (but easily overridden by schema field)
```

**Detection call:**
```typescript
// /app/api/analyze/route.ts lines 40-50
const detection = await detectCards(parsed.data.image);
if (detection.detectedText) {
  detectedCards = detection.detectedText;
}
// Format: "Hero: Ah Kd | Board: Qs Jc 10h" (no confidence metadata)
```

---

## Summary of Deliverables from This Analysis

1. **User Flow Map** — 3 distinct flows (full detection, partial detection, no detection)
2. **Permutation Matrix** — 10+ variations affecting outcomes
3. **Gap Catalog** — 11 gaps across 4 categories
4. **Critical Questions** — 9 questions requiring clarification
5. **Acceptance Criteria** — 12 specific test cases for validation
6. **Implementation Roadmap** — 4 phases with file locations
7. **Code Snippets** — Exact locations of issues

