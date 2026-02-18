---
title: "feat: Continuous Capture + Hand State Tracking"
type: feat
date: 2026-02-18
---

# Continuous Capture + Hand State Tracking

## Overview

Replace hotkey-triggered single captures with continuous auto-capture mode. The extension captures every 2 seconds, the app runs card detection on each frame, tracks game state via a hand state machine, and triggers Claude analysis only when it's the hero's turn to act. Preflop decisions get instant static chart recommendations with optional Claude follow-up for non-standard spots.

User experience: just play poker. The app on the second monitor stays updated automatically.

## Problem Statement

1. **Manual capture is disruptive.** The user must press a hotkey at the right moment. They often miss key transitions or capture too late.

2. **Single snapshots miss the action flow.** Poker is a sequence: preflop raises, flop bets, turn decisions. A hotkey shows one frozen moment. Claude has no context about previous streets.

3. **Claude is called when it shouldn't be.** Triggering on every street change wastes API calls — the user only needs advice when it's their turn to act, not when opponents are betting.

4. **Preflop decisions are largely solved.** Standard preflop spots (open-raise decisions) have known correct answers from GTO charts. Calling Claude for "should I raise AKo from the button?" is expensive and slow when the answer is always "yes."

## Proposed Solution

### Architecture

```
Extension (background.ts)
  │  setInterval(captureVisibleTab, 2000)
  │  JPEG 85% quality (~200-400KB per frame)
  │
  ▼
Content Script → window.postMessage → React App (page.tsx)
                                           │
                                    POST /api/detect
                                    (cards + action buttons, no Claude)
                                           │
                                    ┌──────┴───────┐
                                    │ State Machine  │
                                    │ tracks street  │
                                    │ + hero's turn  │
                                    └──────┬───────┘
                                           │
                                    Hero's turn detected?
                                    (action buttons visible)
                                           │
                              ┌─────────────┴─────────────┐
                              │                           │
                        PREFLOP                      POSTFLOP
                        (standard spot)              (any street)
                              │                           │
                    Show static persona           POST /api/analyze
                    chart recommendations         (Claude + full hand
                    instantly (zero API cost)       context from all
                              │                    previous streets)
                    Non-standard spot?
                    (facing raise, 3-bet)
                              │
                    POST /api/analyze
                    (Claude for nuanced advice)
```

### Key Design Decisions

**1. Claude triggered by action buttons, not street changes**

The state machine tracks card counts to know which street we're on, but Claude is only called when action buttons are detected (hero's turn to act). This means:
- Cards change silently → game state updated, no API call
- Action buttons appear → hero must decide → Claude called with full hand context
- Result: 1-3 Claude calls per hand (only decision points) instead of 4-5 (every street)

**2. Action button detection**

Holland Casino shows bright pink/magenta Fold/Call/Raise buttons at the bottom-right when it's the hero's turn. Detection approach:
- Define a ROI for the button zone (bottom 15% of image, right 50%)
- Check for high-saturation colored pixels (pink/magenta buttons are very distinct from the dark felt)
- No template matching needed — just "are there bright colored blobs in the button zone?"
- Returns `heroTurn: boolean` alongside the card detection result

**3. Static preflop charts for instant recommendations**

When it's the hero's turn preflop in a standard spot (no prior raises):
- Instantly show what each persona would do (Sharp Eddie raises, Steady Sal folds, etc.)
- Zero API cost, zero latency
- Only call Claude if the spot is non-standard (facing a raise, 3-bet pot, specific opponent reads)

When facing a raise or in a multi-way pot preflop:
- Still show persona baselines as reference
- Call Claude with context: "Hero has AQo in CO, UTG raised 3x, table is playing loose"

**4. Window targeting for `captureVisibleTab()`**

When the user enables continuous mode, the extension records the `windowId` of the current window (assumed to be the poker window). All subsequent captures target that window.

**5. JPEG capture format**

Switch from PNG (~1.6MB) to JPEG 85% (~200-400KB) for continuous frames. Requires validation that detection accuracy holds with JPEG artifacts.

**6. Forward-only state machine with hysteresis**

The state machine only progresses forward within a hand. Transitions require 2 consecutive frames with the new card count. Transition to WAITING requires 3 consecutive frames with 0 hero cards.

**7. Hand saved once, at hand end**

A single localStorage entry per hand, saved when the state machine transitions to WAITING. Contains full hand context with per-street analysis.

## Technical Approach

### Phase 1: Validate JPEG Detection + Action Button Detection

**Validate JPEG accuracy:**
- Run test suite with JPEG-encoded inputs at 85% quality
- Confirm all 21 captures maintain HIGH confidence matches

**Action button detection** (add to `lib/card-detection/detect.ts` or new `lib/card-detection/buttons.ts`):

```typescript
interface DetectionResult {
  heroCards: CardMatch[];
  communityCards: CardMatch[];
  detectedText: string;
  heroTurn: boolean;     // NEW: action buttons visible
  timing: number;
}

/** Check if hero action buttons are visible (bright colored blobs in button zone). */
function detectActionButtons(
  imageBuffer: Buffer,
  width: number,
  height: number,
): boolean {
  // ROI: bottom 15%, right 50% of image
  // Check for high-saturation pink/magenta pixels (H ≈ 300-340°)
  // If saturated pixel count exceeds threshold → buttons are visible
}
```

**New `/api/detect` endpoint** (`app/api/detect/route.ts`):
- Accepts `{ image: string }` (base64)
- Runs card detection + action button detection
- Returns `DetectionResult` (cards + heroTurn flag)
- Does NOT invoke Claude, does NOT save to disk

### Phase 2: Hand State Machine

**New module** (`lib/hand-tracking/state-machine.ts`):

```typescript
type Street = "WAITING" | "PREFLOP" | "FLOP" | "TURN" | "RIVER";

interface HandState {
  street: Street;
  handId: string | null;
  heroCards: string[];
  communityCards: string[];
  heroTurn: boolean;
  streets: StreetSnapshot[];  // accumulated context per street
  frameCount: number;         // consecutive frames at current detection
}

interface StreetSnapshot {
  street: Street;
  heroCards: string[];
  communityCards: string[];
  timestamp: number;
  analysis?: HandAnalysis;    // Claude's response for this street (if called)
}
```

**State transitions (by card count):**

| From | To | Condition |
|------|----|-----------|
| WAITING | PREFLOP | 2 hero cards detected (2 consecutive frames) |
| PREFLOP | FLOP | 3 community cards detected (2 consecutive frames) |
| FLOP | TURN | 4 community cards detected (2 consecutive frames) |
| TURN | RIVER | 5 community cards detected (2 consecutive frames) |
| Any | WAITING | 0 hero cards for 3 consecutive frames |

**Analysis trigger logic:**

```typescript
function shouldCallClaude(state: HandState): boolean {
  if (!state.heroTurn) return false;

  // Preflop: only call Claude for non-standard spots
  if (state.street === "PREFLOP") {
    return isNonStandardPreflopSpot(state);
    // Standard spots get static chart recommendations only
  }

  // Postflop: always call Claude when it's hero's turn
  return true;
}

function isNonStandardPreflopSpot(state: HandState): boolean {
  // For MVP: always call Claude preflop too (can't detect raises yet)
  // Future: detect if there's been a raise by reading bet amounts
  return true;
}
```

**React integration** (`lib/hand-tracking/use-hand-tracker.ts`):

Custom hook using `useReducer` that:
- Accepts detection results from `/api/detect`
- Manages the state machine with hysteresis
- Exposes: current street, cards, heroTurn, accumulated context, shouldAnalyze
- Resets on WAITING transition (new hand)

### Phase 3: Static Preflop Charts

**Data module** (`lib/preflop-charts/`):
- `types.ts` — Action, Position, Persona types
- `personas.ts` — 4 persona definitions (Steady Sal, Sharp Eddie, Wild Maya, Curious Carl)
- `charts.ts` — 24 hand charts (4 personas x 6 positions), each mapping 169 hand combos to RAISE/CALL/FOLD
- `lookup.ts` — `getPersonaActions(heroCards, position)` returns what each persona would do

**Chart display** (`components/preflop-charts/PersonaRecommendations.tsx`):
- Compact widget showing 4 persona recommendations
- Appears instantly when PREFLOP + heroTurn detected
- Displayed alongside or above the Claude analysis (which may still be loading)

**Integration with hand tracker:**
- When `street === "PREFLOP" && heroTurn`:
  1. Immediately show persona chart recommendations (zero latency)
  2. If non-standard spot: also trigger Claude in background
  3. Claude response appears when ready, complementing the static recommendations

### Phase 4: Extension Continuous Capture

**Background script changes** (`extension/src/background.ts`):

```typescript
let captureInterval: number | null = null;
let pokerWindowId: number | null = null;

function startContinuousCapture() {
  chrome.windows.getCurrent((win) => {
    pokerWindowId = win.id;
  });

  captureInterval = setInterval(() => {
    if (!webAppTabId || !pokerWindowId) return;

    chrome.tabs.captureVisibleTab(
      pokerWindowId,
      { format: "jpeg", quality: 85 },
      (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) return;
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
        chrome.tabs.sendMessage(webAppTabId, {
          type: "CAPTURE_FRAME",
          base64,
        });
      }
    );
  }, 2000);
}

function stopContinuousCapture() {
  if (captureInterval) clearInterval(captureInterval);
  captureInterval = null;
  pokerWindowId = null;
}
```

**New message types:**
- `CAPTURE_FRAME` — continuous frame (processed by state machine)
- `CAPTURE_HAND` — existing manual hotkey (triggers immediate full analysis)
- `CONTINUOUS_START` / `CONTINUOUS_STOP` — toggle from popup

**Popup UI** (`extension/popup.html` + `extension/src/popup.ts`):
- Toggle button: "Start Continuous" / "Stop Continuous"
- Badge text on extension icon: "ON" when active

### Phase 5: Web App Integration

**Page component changes** (`app/page.tsx`):
- Dual capture modes: continuous frames go through state machine, manual hotkey triggers immediate analysis
- `useHandTracker()` hook manages game state
- On `CAPTURE_FRAME`: send to `/api/detect`, feed result to state machine
- When `heroTurn` + preflop: show persona charts instantly
- When `shouldAnalyze`: trigger Claude with accumulated hand context

**UI additions:**
- Street indicator badge: PREFLOP / FLOP / TURN / RIVER
- Detected cards display: real-time between Claude calls
- Persona chart widget: instant preflop recommendations
- Status: "Watching..." / "Your turn — analyzing..." / "Waiting for hand..."

**AnalysisResult changes:**
- Accept optional `handContext` prop with accumulated street data
- Save to localStorage once per hand (on WAITING transition)
- Update `sessionHandCount` only on hand completion

**System prompt changes** (`lib/ai/system-prompt.ts`):
- Include accumulated hand context: "PREFLOP: Hero (BTN) has Kh Qs. FLOP (Ah 7d 2c): ..."
- Claude gets full hand history, not just a snapshot

**API route guard** (`app/api/analyze/route.ts`):
- Gate `writeFile` behind `process.env.SAVE_CAPTURES === "true"`

## Files

| File | Action | Description |
|------|--------|-------------|
| `app/api/detect/route.ts` | CREATE | Lightweight detection-only endpoint |
| `lib/card-detection/buttons.ts` | CREATE | Action button detection (color blob check) |
| `lib/card-detection/detect.ts` | MODIFY | Add heroTurn to DetectionResult |
| `lib/hand-tracking/state-machine.ts` | CREATE | Hand state machine logic |
| `lib/hand-tracking/use-hand-tracker.ts` | CREATE | React hook for state machine |
| `lib/hand-tracking/types.ts` | CREATE | HandState, StreetSnapshot types |
| `lib/preflop-charts/types.ts` | CREATE | Action, Position, Persona types |
| `lib/preflop-charts/personas.ts` | CREATE | 4 persona definitions |
| `lib/preflop-charts/charts.ts` | CREATE | 24 hand charts (169 combos x 6 positions x 4 personas) |
| `lib/preflop-charts/lookup.ts` | CREATE | getPersonaActions() lookup function |
| `components/preflop-charts/PersonaRecommendations.tsx` | CREATE | Compact persona widget |
| `extension/src/background.ts` | MODIFY | Add interval capture + window targeting |
| `extension/src/content.ts` | MODIFY | Handle CAPTURE_FRAME message type |
| `extension/src/popup.ts` | MODIFY | Toggle button for continuous mode |
| `extension/popup.html` | MODIFY | Toggle UI |
| `extension/manifest.json` | MODIFY | Add optional toggle hotkey |
| `app/page.tsx` | MODIFY | Integrate hand tracker, dual capture modes |
| `components/analyzer/AnalysisResult.tsx` | MODIFY | Accept hand context, save once per hand |
| `app/api/analyze/route.ts` | MODIFY | Gate file writes, accept hand context |
| `lib/ai/system-prompt.ts` | MODIFY | Include hand context in prompt |
| `lib/card-detection/types.ts` | MODIFY | Add heroTurn to DetectionResult |

## Acceptance Criteria

### Card Detection & Buttons
- [ ] JPEG detection accuracy validated (21/21 captures at HIGH confidence)
- [ ] `/api/detect` endpoint returns detection results in <250ms
- [ ] Action button detection correctly identifies hero's turn on test captures
- [ ] Action button detection returns false when it's not hero's turn

### State Machine
- [ ] Correctly tracks WAITING → PREFLOP → FLOP → TURN → RIVER on test captures
- [ ] Forward-only: animation artifacts don't cause backwards transitions
- [ ] 2-frame hysteresis prevents premature street transitions
- [ ] 3-frame hysteresis prevents false WAITING transitions
- [ ] Hand context accumulates across streets

### Analysis Trigger
- [ ] Claude called only when `heroTurn === true` (not on every street change)
- [ ] Claude receives accumulated hand context from all previous streets
- [ ] Preflop standard spots: persona charts shown instantly, Claude optional
- [ ] Postflop: Claude called when hero's turn detected
- [ ] In-flight Claude request completes before new one starts

### Preflop Charts
- [ ] 4 personas x 6 positions x 169 hands = 4,056 data points curated
- [ ] Lookup returns correct action for any hero cards + position combo
- [ ] Widget displays instantly when PREFLOP + heroTurn detected

### Extension
- [ ] Popup toggles continuous mode on/off
- [ ] Badge indicates active continuous capture
- [ ] `captureVisibleTab(windowId)` targets the poker window correctly
- [ ] Manual hotkey still works during continuous mode

### Integration
- [ ] Hand saved to localStorage once on completion (not per street)
- [ ] No file writes to `test/captures/` during continuous mode
- [ ] Memory stable during 30+ minute session
- [ ] Session hand count increments once per actual hand

## Dependencies & Risks

**Risk: JPEG compression degrades detection accuracy.**
Mitigation: validate before building. Fallback: PNG with 3-second intervals.

**Risk: Action button detection unreliable (false positives/negatives).**
Mitigation: the pink/magenta buttons are very high-saturation against dark felt. Conservative threshold + require 2 consecutive frames. Fallback: trigger on street change instead.

**Risk: Can't detect if preflop spot is "standard" (no raise) vs "non-standard" (facing raise).**
Mitigation: for MVP, call Claude on all preflop spots where hero has turn. Show persona charts alongside. Future: detect bet amounts to distinguish open vs facing raise.

**Risk: Firefox throttles rapid `captureVisibleTab()` calls.**
Mitigation: 2-second interval is conservative. Fall back to 3 seconds if needed.

**Risk: `captureVisibleTab(windowId)` requires poker tab to be focused within its window.**
Mitigation: test Firefox behavior. Note to user: "keep the poker tab in the foreground."

## Implementation Order

1. ~~Validate JPEG detection accuracy (quick script)~~ — deferred, using JPEG 85% by default
2. [x] Build action button detection + add to detect pipeline
3. [x] Create `/api/detect` endpoint
4. [x] Build state machine module with hysteresis
5. [x] Extension: continuous capture in background.ts + popup toggle
6. [x] Web app: integrate hand tracker + dual capture modes
7. ~~Curate preflop chart data (4 personas x 6 positions)~~ — deferred
8. ~~Build persona chart lookup + display widget~~ — deferred
9. [x] Wire Claude trigger (heroTurn-based) with hand context
10. [x] Web app: street indicator + status UI
11. [ ] End-to-end testing with live poker session

## Future Enhancements (Not in Scope)

- **Bet amount OCR**: Read pot/stack/bet numbers to detect raise amounts, enabling "standard vs non-standard" preflop classification
- **Adaptive capture rate**: 1s when hero's turn, 3s during opponent turns
- **Opponent showdown tracking**: Detect revealed opponent cards for opponent profiling
- **Within-street re-analysis**: If pot changes significantly between Claude calls, re-trigger
- **Facing-raise preflop charts**: Separate chart set for calling/3-betting vs opening ranges

## References

- Brainstorm (continuous capture): `docs/brainstorms/2026-02-17-continuous-capture-card-detection-brainstorm.md`
- Brainstorm (preflop charts): `docs/brainstorms/2026-02-18-static-persona-hand-charts-brainstorm.md`
- Extension architecture: `extension/src/background.ts`, `extension/src/content.ts`
- Card detection: `lib/card-detection/detect.ts` (100% accuracy, 87-224ms)
- Current capture flow: `app/page.tsx:30-47`
- Analysis trigger: `components/analyzer/AnalysisResult.tsx:38-44`
