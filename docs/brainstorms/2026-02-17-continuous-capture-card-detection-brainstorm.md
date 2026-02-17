# Continuous Capture + Deterministic Card Detection

**Date:** 2026-02-17
**Status:** Brainstorming

---

## The Problem

Two fundamental issues with the current screenshot-based approach:

1. **Card reading accuracy is poor.** Claude Vision confuses visually similar suits (spades/clubs) and mirrored ranks (6/9). This is the core value of the tool — if it reads the cards wrong, the advice is wrong. Vision models are not designed for pixel-perfect pattern recognition; they're designed for semantic understanding.

2. **A single snapshot misses the action flow.** Poker is a sequence of events: preflop raises, flop action, turn bets, river decisions. A hotkey capture only shows one frozen moment. The user has to keep pressing the hotkey and hope they capture the right moments. Ideal state: the app follows the entire hand automatically and builds a complete hand history.

The poker client is Holland Casino (Playtech/iPoker platform). The table renders in canvas/WebGL, which means DOM parsing is off the table. Everything we need to read lives in rendered pixels.

---

## Direction 1: Deterministic Card Recognition

### The Core Insight

Digital poker cards are **not like physical cards**. They are rendered from assets — the King of Spades looks identical in every screenshot, down to the pixel. This means we don't need AI vision or fuzzy OCR. We need exact template matching.

Claude Vision is the wrong tool for this. It's like using GPT to add two numbers: technically it can do it, but a calculator is 100% accurate and infinitely cheaper.

### How Template Matching Works

1. **Reference images:** User provides (or we capture) a reference image for each of the 52 cards. In practice, we only need 13 ranks x 4 suits. The card corner (rank + suit pip) is probably sufficient — we don't need the full card face.

2. **Known positions:** Cards appear in fixed locations on the table:
   - Hero's hole cards: 2 fixed positions (bottom center of table)
   - Community cards: 5 fixed positions (center of table, revealed progressively)
   - Possibly opponent hole cards at showdown

3. **Crop and compare:** For each card position, crop that region from the screenshot and compare against all 52 reference images. The closest match wins.

4. **Result:** Deterministic, 100% accurate card reading. No AI required. No API cost. Instantaneous.

### Comparison Algorithms

**Option A: Raw pixel comparison (simplest)**
- Convert both images to same dimensions
- Compare RGB values pixel by pixel
- Sum of absolute differences (SAD) or mean squared error (MSE)
- Lowest error = match
- Pro: Dead simple to implement
- Con: Sensitive to any rendering differences, anti-aliasing, or sub-pixel shifts

**Option B: Perceptual hashing (pHash)**
- Compute a perceptual hash for each reference and each cropped card
- Compare Hamming distance between hashes
- Libraries exist for this in JS (e.g., `imghash`, `blockhash-js`)
- Pro: More robust to minor rendering variations, very fast comparison
- Con: Might false-match visually similar cards (exactly the problem we're trying to solve)

**Option C: Normalized cross-correlation (NCC)**
- Standard template matching approach from computer vision
- Slide the template over the image and compute correlation
- OpenCV's `matchTemplate()` is the canonical implementation
- Pro: Handles brightness/contrast variations, robust
- Con: Heavier computation, would need a WASM OpenCV build or server-side processing

**Option D: Canvas-based histogram comparison**
- Extract color histograms from both images
- Compare histogram similarity
- Pro: Rotation/translation invariant
- Con: Loses spatial information — a red-heavy card might match any red-heavy card

**Recommendation:** Start with raw pixel comparison. Digital renders are pixel-perfect, so the simplest approach should work. If it doesn't, step up to perceptual hashing. NCC is overkill for this use case since we already know exactly where cards are positioned.

### Suit Confusion: Why This Solves It

The spades/clubs confusion happens because Claude Vision processes cards at a semantic level — it sees "a black suit symbol" and guesses. Template matching doesn't guess. It compares exact pixel patterns. The spade pip and club pip have completely different pixel arrangements, so they'd never be confused.

Same for 6/9 — the actual rendered glyphs have different pixel patterns even if they're rotationally similar. Template matching compares the exact crop, not a conceptual understanding of the number.

### Setup / Calibration Flow

The user needs to tell the system two things:
1. **Where the cards are** on their screen (card position regions)
2. **What each card looks like** (reference images)

**Calibration approach 1: Manual region selection**
- User opens the extension settings
- Draws rectangles over each card position on the poker table
- Saves these as pixel coordinates (x, y, width, height)
- These coordinates are relative to the captured tab dimensions

**Calibration approach 2: Reference-based auto-detection**
- If we have reference images, we could scan the entire screenshot for matches
- Find all card-sized regions that match any reference card
- This could auto-detect positions without manual calibration
- Problem: computationally expensive to scan the whole image every frame

**Calibration approach 3: Guided setup wizard**
- App shows: "Deal yourself a hand with the Ace of Spades visible"
- User presses capture
- App finds the Ace of Spades in the image and records its position
- Repeat for community cards
- Smart: might only need one calibration if all card positions share the same Y-coordinate and have consistent spacing

**Reference image capture:**
- Option A: User manually screenshots each card and uploads — tedious (52 images)
- Option B: User plays hands and the app progressively collects cards it sees — requires initial AI identification (unreliable for the exact reason we're doing this)
- Option C: User downloads the card assets from the Playtech client files — might be possible, but reverse-engineering proprietary assets is ethically gray
- Option D: User plays a few hands, captures screenshots, and manually crops/labels a few cards. Then the app extrapolates positions for the rest — practical middle ground
- Option E: Capture just the rank and suit pip separately (13 ranks + 4 suits = 17 references instead of 52) — but card corners typically render rank+suit together, making separate matching harder

**Best approach for MVP:** Guided setup wizard (calibration approach 3) combined with progressive reference collection. User calibrates card positions once, then plays a few hands while manually confirming the cards. After ~15-20 unique cards are confirmed, the system probably has enough references to be autonomous.

### Handling Window Resizes and Table Sizes

This is the biggest challenge for template matching. If the user resizes the browser window, the poker table re-renders at a different size. Card positions shift. Card images change size. All reference data becomes invalid.

**Possible solutions:**

- **Fixed window size:** Tell the user to keep the window at a fixed size. Easiest solution but restrictive. The extension could detect size changes and warn.

- **Relative positioning:** Store card positions as percentages of the table dimensions rather than absolute pixels. If we can detect the table boundaries (they have a distinct oval/green shape), we can compute relative positions. Cards at 45% from left, 80% from top would work at any table size.

- **Multi-scale references:** Store references at multiple resolutions. When comparing, find the scale that matches best. Computationally more expensive but handles resize gracefully.

- **Resize detection + re-calibration prompt:** Detect when the capture dimensions change from the calibrated size. Prompt user to re-calibrate. Simple and honest.

- **Scale-invariant matching:** Use a comparison method that handles scaling (like SIFT/SURF features). Overkill and complex.

**Recommendation for MVP:** Fixed window size + resize detection with warning. The user plays on one monitor, the app on another — there's little reason to resize the poker window mid-session. If they do, show a banner: "Window size changed. Please re-calibrate or restore window size."

---

## Direction 2: Continuous Capture + Change Detection

### The Vision

Instead of hotkey-triggered single captures, the extension continuously monitors the poker table and automatically detects when something changes. The app builds a complete hand history in real-time without any user interaction.

User experience: just play poker. The app on the second monitor keeps itself updated. When it's your turn to act, advice is already there.

### Capture Strategies

**Strategy A: Periodic captureVisibleTab() (simplest)**
- Extension calls `browser.tabs.captureVisibleTab()` every N seconds
- Compare each capture against the previous one
- If significant change detected, process the new frame
- Interval: 1-2 seconds seems reasonable (fast enough to catch state changes, slow enough to not kill performance)
- Pro: Uses existing browser API, no special permissions
- Con: Captures the whole visible tab, not just the poker table. If something else overlaps the tab (notification, popup), we capture garbage

**Strategy B: Canvas element capture**
- If we can get a reference to the poker table's canvas element via content script, we can call `canvas.toDataURL()` directly
- Pro: Only captures the game canvas, not browser chrome or overlays
- Con: May be blocked by CORS / security policies. The Playtech canvas might be in a cross-origin iframe. Canvas taint prevention could block `toDataURL()` entirely
- Worth testing but unreliable as primary approach

**Strategy C: getDisplayMedia (screen recording)**
- Use the Screen Capture API to record a portion of the screen
- Can capture individual windows or screens
- Process video frames at intervals
- Pro: Captures exactly what's visible regardless of browser state
- Con: Requires explicit user permission (OS-level prompt), ongoing screen sharing indicator, higher CPU usage, more complex implementation

**Strategy D: Offscreen document + desktopCapture (Manifest V3)**
- Chrome extension API for capturing desktop content
- More capable than captureVisibleTab
- Pro: Can capture specific windows
- Con: More complex, Chrome-specific (we're targeting Firefox)

**Recommendation:** Start with periodic `captureVisibleTab()` (Strategy A). It's the simplest, works in Firefox, and is good enough for MVP. The 1-2 second interval means we'd miss at most 1-2 seconds of action, which is fine for poker (actions take seconds to resolve).

### Change Detection

Not every capture needs processing. We should only trigger analysis when the game state actually changes. Key question: how do we detect meaningful changes cheaply?

**Level 1: Full image hash comparison**
- Hash the entire screenshot
- Compare hash to previous frame's hash
- If different, something changed
- Pro: Extremely fast, catches any change
- Con: Too sensitive — timer ticks, cursor movements, chat messages, and avatar animations all trigger false positives. Would fire on almost every frame.

**Level 2: Region-based comparison**
- Define specific regions of interest (ROIs):
  - Hero's hole cards region
  - Community cards region (center of table)
  - Pot size region
  - Hero's action buttons region
  - Bet amounts around the table
- Only compare these regions between frames
- If a ROI changes, we know what type of change occurred
- Pro: Precise, low false positives, tells us what changed
- Con: Requires calibration of ROI positions (but we need this for card detection anyway)

**Level 3: Semantic change detection**
- Combine region comparison with card detection
- "New card appeared in community cards position 3" = turn card dealt
- "Hero's action buttons are now visible" = hero's turn to act
- "All cards disappeared" = new hand starting
- Pro: Full understanding of game state transitions
- Con: Most complex to implement

**Recommendation:** Level 2 (region-based comparison) is the sweet spot. It reuses the calibration data from card detection, avoids false positives, and provides enough context to understand what changed. We don't need to implement Level 3 immediately — just knowing that the community cards region changed is enough to trigger a re-read.

### State Machine: Tracking Hand Progression

With continuous capture, we can model the poker hand as a state machine:

```
WAITING → PREFLOP → FLOP → TURN → RIVER → SHOWDOWN → WAITING
```

Transitions are detected by changes in specific regions:
- **WAITING -> PREFLOP:** Hero's hole card region goes from empty to showing cards
- **PREFLOP -> FLOP:** Community cards region shows 3 new cards
- **FLOP -> TURN:** Community cards region shows 1 additional card (position 4)
- **TURN -> RIVER:** Community cards region shows 1 additional card (position 5)
- **RIVER -> SHOWDOWN:** Opponent cards become visible / pot awarded
- **SHOWDOWN -> WAITING:** All cards disappear, new hand starts

This state machine would allow us to build a complete hand history automatically:
- Hand #1: Hero has Kh Qs, flop comes Ah 7d 2c, turn 9s, river Jc
- Track betting actions at each street (if we can read bet amounts)

### Capture Rate Considerations

How often should we capture?

| Interval | Captures/min | Use Case |
|----------|-------------|----------|
| 5 sec | 12 | Minimal monitoring, might miss fast actions |
| 2 sec | 30 | Good balance, catches most state changes |
| 1 sec | 60 | Very responsive, catches everything |
| 500 ms | 120 | Near real-time, possibly excessive |
| 200 ms | 300 | Overkill, high CPU cost |

**Poker timing context:** In online poker, each player typically has 15-30 seconds to act. Community cards are dealt with short animations (~1-2 seconds). A 2-second interval captures every meaningful state change. Going faster than 1 second adds CPU cost without meaningful benefit.

**Adaptive rate:** Could start at 2 seconds and increase to 1 second when we detect it's hero's turn to act (action buttons visible). Drop to 5 seconds during opponent turns to save resources.

---

## Direction 3: Hybrid Architecture

### The Key Insight

Different parts of the poker state have different characteristics:

| Data | Nature | Best Tool |
|------|--------|-----------|
| Card identities | Fixed digital renders | Template matching (100% accuracy, free) |
| Bet amounts / pot size | Rendered text on varied backgrounds | Simple OCR or template matching for digits |
| Stack sizes | Rendered text | Simple OCR or template matching for digits |
| Player positions | Fixed table layout | Calibration (known positions) |
| Player actions | UI indicators (fold, all-in, etc.) | Region monitoring + template matching |
| Strategic advice | Complex reasoning | Claude AI (this is where AI shines) |
| Opponent reads | Behavioral patterns over time | Claude AI + accumulated data |

**The hybrid approach:** Use deterministic methods for everything that can be deterministic. Only call Claude for what actually requires intelligence — strategy and opponent modeling.

### Architecture

```
[Continuous Capture]
        |
        v
[Change Detection] ──── no change ──→ skip
        |
        | change detected
        v
[Deterministic Reading]
  ├── Template match: cards
  ├── OCR/template: bet amounts, pot, stacks
  └── Region check: whose turn, player states
        |
        v
[Structured Game State]
  {
    hero_cards: ["Kh", "Qs"],
    community: ["Ah", "7d", "2c"],
    pot: 450,
    hero_stack: 1200,
    hero_position: "BTN",
    street: "flop",
    hero_to_act: true
  }
        |
        v
[Claude AI] ← only called when hero_to_act == true
  ├── Receives structured game state (not an image!)
  ├── Receives opponent history from session
  └── Returns: action recommendation + reasoning
```

### Benefits of This Architecture

1. **100% card accuracy** — No more spade/club confusion. No more 6/9 mix-ups. Deterministic template matching handles this perfectly.

2. **Massively reduced API costs** — Currently, every analysis sends a full screenshot to Claude Vision (expensive multimodal call). With this approach, we send structured text data to Claude (cheap text-only call). Vision is no longer needed at all.

3. **Faster response** — No image encoding/transmission. Text-only Claude calls are faster than vision calls. The deterministic reading is instantaneous.

4. **Smarter AI calls** — Only call Claude when the user actually needs to make a decision (hero's turn to act). During opponent turns, we just silently track the state.

5. **Richer context** — Because we track the entire hand automatically, Claude gets full hand history context: "Villain raised 3x preflop, bet 2/3 pot on flop, now bets 3/4 pot on turn." This is far more useful than a single snapshot.

### The OCR Question

Reading bet amounts and pot sizes from screenshots is a sub-problem. Options:

**Option A: Template matching for digits**
- Poker clients use consistent fonts for numbers
- Create reference images for digits 0-9 and common symbols ($, commas, periods)
- Segment the text region, match individual characters
- Pro: Consistent with the template matching approach, no external deps
- Con: Text segmentation is non-trivial (variable spacing, different number lengths)

**Option B: Tesseract.js (client-side OCR)**
- Mature OCR library available as WASM for browser use
- Feed it cropped regions containing numbers
- Pro: Handles text recognition well, battle-tested
- Con: ~2MB WASM bundle, may be slow for real-time use, overkill for just digits

**Option C: Canvas-based digit recognition**
- Simple neural network trained on the specific font used by Playtech
- Very small model, runs in-browser
- Pro: Fast, accurate for known fonts
- Con: Requires training, more complex to build

**Option D: Skip it — use Claude for numbers only**
- Read cards deterministically, but still send a cropped image to Claude for pot/stack/bet reading
- Pro: Simplest hybrid approach, Claude is good at reading numbers
- Con: Still requires a vision API call (though smaller image = cheaper)
- Could be the pragmatic MVP: solve the biggest pain point (cards) first

**Recommendation for MVP:** Option D. Solve card accuracy with template matching, keep Claude Vision for reading numbers and table context. This captures 80% of the value with 20% of the effort. Later, add digit template matching to eliminate Claude Vision entirely.

---

## Direction 4: Screen Recording vs Periodic Capture

### Periodic captureVisibleTab() (recommended for MVP)

```javascript
// Background script
let captureInterval;

function startCapture() {
  captureInterval = setInterval(async () => {
    const dataUrl = await browser.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 100
    });
    // Send to content script or directly to web app for processing
    processFrame(dataUrl);
  }, 2000); // every 2 seconds
}
```

**Performance impact:**
- `captureVisibleTab()` is relatively lightweight — it captures the compositor output
- PNG encoding adds some CPU cost
- At 2-second intervals, this is negligible on modern hardware
- Estimated: <2% CPU overhead

**Limitations:**
- Only captures the active tab's visible area
- If the poker tab is not active (user switches to another tab), capture fails
- The tab must be in the foreground on its window

### MediaRecorder + getDisplayMedia (future consideration)

```javascript
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: { cursor: 'never' }
});
const recorder = new MediaRecorder(stream);
// Process frames from the stream
```

**Pros:**
- Can capture any window, even when not focused
- Can capture a specific monitor (poker monitor)
- More reliable than tab capture

**Cons:**
- User sees a "sharing your screen" indicator (browser-mandated, cannot be hidden)
- Requires explicit OS-level permission dialog
- Higher CPU usage (continuous video encoding)
- More complex frame extraction (need to pull frames from the MediaStream)
- Privacy concern: capturing entire screen is more invasive than a single tab

**Verdict:** Periodic `captureVisibleTab()` is the right choice for now. Screen recording is a future upgrade if tab capture proves too limiting.

### Canvas Direct Access (unlikely but worth testing)

If the Playtech poker table renders in a `<canvas>` element that we can access from a content script:

```javascript
const canvas = document.querySelector('canvas');
const dataUrl = canvas.toDataURL('image/png');
```

This would be the most efficient approach — direct canvas access, no browser screenshot overhead. But it's likely blocked:
- Canvas may be in a cross-origin iframe
- `toDataURL()` throws SecurityError on tainted canvases
- Playtech may use WebGL contexts that resist reading

**Worth a 5-minute test:** inject a content script, try to access the canvas, see what happens. If it works, it's the best approach. If not, fall back to `captureVisibleTab()`.

---

## Direction 5: Technical Challenges

### Card Position Calibration

**The challenge:** Card positions are in pixel coordinates on the captured image. These depend on:
- Browser window size
- Tab content dimensions
- Zoom level
- Whether the poker table is centered or stretched

**Mitigation strategies:**
- Store positions relative to the table boundary (if detectable) rather than absolute pixels
- Detect the poker table background (green felt oval) and compute positions relative to it
- Lock the window size during a session and warn on resize
- Re-calibrate on window resize

### Multiple Table Support

**Not for MVP**, but worth considering the architecture. If the user plays multiple tables:
- Each table would need its own calibration (unless all tables are identical size)
- Change detection per table region
- Separate hand histories per table
- Claude needs context about which table it's advising on

This is a "nice to have" for advanced users. Single-table focus for now.

### Performance Budget

With continuous capture + template matching, what's the CPU budget?

| Operation | Estimated Time | Frequency |
|-----------|---------------|-----------|
| captureVisibleTab() | 10-50ms | Every 2 sec |
| Region crop (canvas) | <1ms | Every 2 sec |
| Change detection (pixel diff) | 1-5ms | Every 2 sec |
| Template matching (7 cards x 52 refs) | 10-50ms | Only on change |
| Claude API call | 2-5 sec | Only on hero's turn |

Total per-cycle cost: ~15-55ms every 2 seconds. That's <3% of each cycle. Very manageable.

### Rate Limiting Claude API

With continuous capture, we need to be careful not to spam Claude:
- Only call when hero's turn to act is detected
- Debounce: if hero is still deciding (same state), don't re-call
- Queue: if a call is in flight, don't start another
- Budget: track daily API costs, warn the user if approaching a limit

### Privacy Considerations

Continuous screenshots are more sensitive than on-demand captures:
- Screenshots might capture browser notifications, chat messages, or other overlapping content
- Never persist screenshots to disk (process in memory, discard)
- Clear image data after processing
- Only extract game state data, discard the raw image
- Extension should clearly indicate when continuous capture is active (icon badge, popup indicator)
- User should be able to pause/resume capture easily

---

## Direction 6: Implementation Phases

### Phase 0: Validate Template Matching (1-2 hours)

Before building anything, validate the core assumption: can we reliably match cards using pixel comparison?

- User captures a few screenshots with known cards
- Manually crop card regions
- Write a simple Canvas-based pixel comparison script
- Test: does the correct card always have the lowest diff score?
- Test: does resizing the window break it?

If this works, proceed. If not, investigate perceptual hashing or other approaches before continuing.

### Phase 1: Deterministic Card Reading (MVP)

**Goal:** Replace Claude Vision card reading with template matching. Claude still used for strategy.

- Calibration UI: user marks card positions on a reference screenshot
- Reference image collection: guided flow to capture/label card references
- Template matching engine: crop regions + compare against references
- Integration: card identities come from matching, rest of game state still from Claude Vision
- Result: 100% card accuracy, reduced but not eliminated Vision usage

**Value delivered:** Solves Problem 1 (card accuracy). Every analysis now has correct cards.

### Phase 2: Continuous Capture + Change Detection

**Goal:** Auto-capture instead of manual hotkey. Hand tracking across streets.

- Periodic capture in the extension (2-second interval)
- Region-based change detection (community cards, hole cards, action buttons)
- Hand state machine: track preflop -> flop -> turn -> river
- Auto-trigger analysis when hero's turn is detected
- Hand history built automatically from state transitions

**Value delivered:** Solves Problem 2 (missing action flow). User just plays and the app follows along.

### Phase 3: Full Deterministic Reading

**Goal:** Eliminate Claude Vision entirely. Claude only receives structured text.

- Digit template matching for bet amounts, pot size, stack sizes
- Position detection from table layout
- Player state detection (folded, all-in, active)
- Claude receives structured game state as text, not images
- Result: cheaper, faster, more accurate

**Value delivered:** API cost drops significantly. Response time improves. Claude gets richer context.

### Phase 4: Smart Analysis Timing

**Goal:** Only call Claude when it matters, with maximum context.

- Detect hero's turn to act (action buttons visible)
- Send complete hand history up to that point
- Include opponent behavioral history from the session
- Pre-compute pot odds and basic math locally
- Claude focuses purely on strategic advice and opponent reads

---

## Open Questions

1. **Card corner vs full card:** Should we match the full card face or just the rank+suit corner? The corner is smaller (faster matching) but might have less discriminating information.

2. **Reference image portability:** If Holland Casino updates their poker client (new card designs), all references become invalid. How often does this happen? Should we version references?

3. **Obstructed cards:** What happens when a chip stack or animation partially covers a card? Template matching would fail. Do we need a fallback to Claude Vision for low-confidence matches?

4. **Table themes:** Does Playtech/Holland Casino offer different table themes with different card styles? If so, the user would need separate references per theme.

5. **Firefox extension limitations:** Are there any Firefox-specific limitations with `captureVisibleTab()` timing or frequency? Chrome and Firefox extensions have slightly different APIs.

6. **Offscreen processing:** Should template matching happen in the extension's background script, in a web worker, or in the web app after receiving the screenshot? Keeping it in the extension would reduce data transfer. Keeping it in the web app centralizes the logic.

7. **What if the user folds?** After folding, the hand continues for other players. Should we keep tracking the community cards and showdown? This could provide valuable information about opponent play styles (what did they show down with?).

8. **Auto-detection of card positions:** Could we find card positions automatically by looking for rectangular regions with white backgrounds on the green felt? This would eliminate manual calibration entirely.

---

## Summary of Recommended Approach

**Validate first:** Run a quick pixel comparison test with real screenshots before building anything.

**Then build incrementally:**
1. Template matching for cards (solves accuracy)
2. Continuous capture with change detection (solves coverage)
3. Full deterministic reading (eliminates Vision)
4. Smart analysis timing (optimizes Claude usage)

**Key architectural principle:** Use the right tool for each job. Deterministic pattern matching for deterministic data (cards, digits). AI for judgment calls (strategy, opponent modeling). Don't use AI where a calculator would do.

---

## Next Steps

1. Validate template matching with a few real screenshots
2. If validated, run `/workflows:plan` to create implementation plan for Phase 1
