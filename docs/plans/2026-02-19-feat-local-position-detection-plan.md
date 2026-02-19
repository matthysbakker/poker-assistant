---
title: "Local Position Detection"
type: feat
date: 2026-02-19
---

# Local Position Detection

## Overview

Detect the dealer button ("D" chip) locally via image processing to determine all player positions (BTN, SB, BB, UTG, MP, CO) without relying on Claude Vision. Claude currently defaults hero to BB ~70% of the time because hero sits at the bottom of the screen. Local detection eliminates this hallucination by providing position as ground truth.

## Problem Statement

Claude Vision struggles to find the small dealer button chip and instead infers position from spatial layout. Since hero is always at the bottom of the screen (which is often where BB sits), Claude defaults to BB regardless of actual position. This was documented as a known issue and partially mitigated with prompt engineering, but the root cause remains: asking an LLM to find a tiny UI element is unreliable.

## Proposed Solution

### Architecture

```
Frame arrives (every 2s)
  -> POST /api/detect
  -> detectCards() runs card detection (existing)
  -> detectDealerButton() runs in parallel (NEW)
     -> Extract table region (exclude bottom action bar)
     -> HSV filter for bright green/yellow pixels
     -> Connected component labeling on filtered mask
     -> Filter by size + circularity
     -> Map blob centroid to nearest seat zone
     -> Compute hero position from dealer seat
  -> DetectionResult includes heroPosition
  -> State machine locks position for the hand
  -> Claude prompt: "Hero position: CO" (ground truth)
```

### Key Design Decisions

1. **HSV color filter primary, not template matching** — the D button is a distinctive bright green/yellow on dark blue felt. Color is more robust across resolutions than pixel-exact template matching. No reference files needed.
2. **Seat zones, not pixel coordinates** — divide the table perimeter into 6 angular zones centered on the table. The D button's position maps to the nearest zone. This handles resolution variance and slight layout shifts.
3. **Position locks within a hand** — dealer button doesn't move during a hand. Once detected, position is stored in `HandState` and not re-evaluated until RESET.
4. **Null = fallback to Claude** — if detection fails (button obscured, between hands, unknown client), return `null` and let Claude attempt visual detection. Never guess.
5. **Runs in parallel** — no dependency on card detection results. Adds ~10-30ms alongside existing card matching.
6. **6-max only for now** — position labels assume 6-max tables (BTN, SB, BB, UTG, MP, CO). The user primarily plays 6-max.

## Technical Approach

### Phase 1: Dealer Button Detector

**New file:** `lib/card-detection/dealer-button.ts`

Detect the dealer button in a poker table screenshot and return the seat number (0-5).

```typescript
export interface DealerButtonResult {
  seat: number;       // 0-5, clockwise from hero (0 = hero)
  confidence: number; // 0-1, how strong the detection is
  x: number;          // relative x position (0-1)
  y: number;          // relative y position (0-1)
}

export async function detectDealerButton(
  imageBuffer: Buffer,
): Promise<DealerButtonResult | null>
```

**Pipeline:**

1. **Get metadata** — `sharp(imageBuffer).metadata()` for width/height
2. **Extract table region** — crop out bottom 15% (action buttons) and top 5% (UI chrome) to reduce false positives. Keep `{ left: 0, top: h*0.05, width: w, height: h*0.80 }`
3. **Downscale** — resize to 480px width (same as card locator) for speed
4. **Extract raw RGB** — `.removeAlpha().raw().toBuffer()`
5. **HSV filter** — for each pixel, compute H/S/V from RGB:
   - Dealer button color (Playtech): bright green-yellow
   - Target hue: 60-160 degrees (green-yellow range)
   - Saturation: > 0.35
   - Value/brightness: > 140
   - Output: binary mask (1 = candidate pixel, 0 = background)
6. **Connected component labeling** — flood fill on binary mask (same algorithm as `locate.ts`)
7. **Filter blobs** by:
   - **Area**: 30-400 pixels at 480px scale (the button is small, ~15-25px diameter)
   - **Aspect ratio**: 0.6-1.6 (near-circular; allow some tolerance for slight oval)
   - **Fill ratio**: > 0.50 (compact, not elongated/stringy)
   - **Position**: exclude horizontal center strip (relX 0.40-0.60, relY 0.35-0.65) where community cards and pot display sit
8. **Select best candidate** — if exactly 1 blob passes filters, use it. If 0 or 2+, return `null`.
9. **Map to seat zone** — see Phase 2.

**HSV tuning notes:** The exact hue range will be calibrated empirically using the existing test captures. The Playtech D button appears bright green (H ~120) in some screenshots and more yellow-green (H ~80) in others, possibly due to JPEG compression or display settings. Start with a wide range and narrow based on false positive analysis.

### Phase 2: Seat Zone Mapping

**Added to:** `lib/card-detection/dealer-button.ts`

The 6 seats on a Playtech 6-max table form a rough oval. Rather than hardcoding pixel coordinates, use angular zones relative to the table center.

```typescript
// Table center is approximately at (0.50, 0.42) relative to image dimensions
// (slightly above center because the bottom is hero's area + action buttons)
const TABLE_CENTER = { x: 0.50, y: 0.42 };

// Seat angles (degrees, 0 = right, counterclockwise)
// Measured from Playtech screenshots:
//   Seat 0 (hero):     bottom center    → ~270° (6 o'clock)
//   Seat 1:            bottom-right     → ~320° (5 o'clock)
//   Seat 2:            top-right        → ~30°  (2 o'clock)
//   Seat 3:            top-center       → ~90°  (12 o'clock)
//   Seat 4:            top-left         → ~150° (10 o'clock)
//   Seat 5:            bottom-left      → ~220° (8 o'clock)
const SEAT_ANGLES = [270, 320, 30, 90, 150, 220];
```

**Algorithm:**
1. Compute angle from TABLE_CENTER to the blob centroid: `atan2(cy - TABLE_CENTER.y, cx - TABLE_CENTER.x)` → convert to degrees
2. Find the nearest SEAT_ANGLE using circular distance
3. If the angular distance to the nearest seat > 30°, reject (blob is between seats, likely a false positive)
4. Return the matched seat number

**Calibration:** The SEAT_ANGLES and TABLE_CENTER will be measured empirically from 3-5 captures across resolutions. Since we use relative coordinates, these should be resolution-independent.

### Phase 3: Position Calculation

**New file:** `lib/card-detection/position.ts`

Given the dealer seat number and total players, compute hero's position.

```typescript
export type Position = "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB";

/**
 * Compute hero's position given the dealer seat number.
 * Assumes 6-max, hero is always seat 0.
 *
 * Seats are numbered 0-5 clockwise from hero.
 * Positions assigned clockwise from dealer: BTN, SB, BB, UTG, MP, CO.
 */
export function heroPosition(dealerSeat: number, playerCount: number = 6): Position
```

**6-max position assignment (clockwise from dealer):**

| Offset from dealer | Position |
|---|---|
| 0 | BTN |
| 1 | SB |
| 2 | BB |
| 3 | UTG |
| 4 | MP |
| 5 | CO |

Hero position = offset of seat 0 from the dealer seat.

Example: dealer at seat 3 → hero (seat 0) is 3 seats after dealer → offset 3 → UTG.

**Reduced player counts (deferred):** For <6 players, positions shift (e.g., 5-handed has no UTG). This is a V2 concern — for now assume 6 players. Return the 6-max position label regardless; it's still directionally correct and better than Claude guessing BB.

### Phase 4: Integration into Detection Pipeline

**Modified files:** `lib/card-detection/detect.ts`, `lib/card-detection/types.ts`

**`types.ts`** — add `heroPosition` to `DetectionResult`:

```typescript
export interface DetectionResult {
  heroCards: CardMatch[];
  communityCards: CardMatch[];
  detectedText: string;
  heroTurn: boolean;
  heroPosition: "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB" | null;  // NEW
  timing: number;
}
```

**`detect.ts`** — add `detectDealerButton()` to the parallel Promise.all:

```typescript
const [cardResults, heroTurn, dealerResult] = await Promise.all([
  Promise.all(cards.map(async (card) => { ... })),
  hasHeroBlobs ? detectActionButtons(imageBuffer) : Promise.resolve(false),
  detectDealerButton(imageBuffer),  // NEW
]);

const position = dealerResult ? heroPosition(dealerResult.seat) : null;

return {
  heroCards,
  communityCards,
  detectedText: formatDetectedCards(heroCards, communityCards),
  heroTurn,
  heroPosition: position,  // NEW
  timing,
};
```

**`detect.ts`** — update `formatDetectedCards()` to include position in the text sent to Claude:

```typescript
function formatDetectedCards(hero, community, position) {
  // ... existing card formatting ...
  if (position) {
    parts.push(`Hero position: ${position}`);
  }
  return parts.join(", ");
}
```

### Phase 5: State Machine Integration

**Modified files:** `lib/hand-tracking/types.ts`, `lib/hand-tracking/state-machine.ts`

**`types.ts`** — add `heroPosition` to `HandState`:

```typescript
export interface HandState {
  // ... existing fields ...
  heroPosition: "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB" | null;  // NEW
}
```

**`state-machine.ts`** — lock position on first detection, carry through hand:

```typescript
// In handleDetection():
// Lock position: use first non-null detection, don't overwrite within a hand
const heroPosition = state.heroPosition ?? detection.heroPosition;

// In RESET: clear position back to null
```

**`use-hand-tracker.ts`** — include position in `buildHandContext()`:

```typescript
// Prefix context with position if available:
// "Hero position: CO. PREFLOP: Hero holds Ah Kd. FLOP: Board is Qs Jh 7c."
```

### Phase 6: Claude Prompt Update

**Modified files:** `lib/ai/system-prompt.ts`, `lib/ai/schema.ts`

**`system-prompt.ts`** — update `SYSTEM_PROMPT_WITH_DETECTED_CARDS`:

Add to the detection instructions:
```
- If "Hero position: BTN" (or similar) is provided, it is GROUND TRUTH from local dealer button detection.
  Use it exactly — do NOT re-determine position from the image.
- If no position is provided, determine position visually using the dealer button guidelines below.
```

**`schema.ts`** — update `heroPosition` `.describe()`:

```typescript
heroPosition: z
  .enum(["UTG", "MP", "CO", "BTN", "SB", "BB"])
  .describe(
    "Hero's position at the table. If a detected position was provided (e.g., 'Hero position: CO'), " +
    "use it exactly as ground truth. Only determine position visually if no detection was provided."
  ),
```

### Phase 7: Testing Infrastructure

**New files:** `scripts/debug-dealer-button.ts`, extended `test/ground-truth.ts`

**Ground truth** — add `dealerSeat` field to the ground truth type:

```typescript
// In test/ground-truth.ts:
{ hero: ["Kc", "Jd"], community: [], dealerSeat: 5 }
//                                      ↑ seat 5 = bottom-left
```

Annotate 20-30 existing captures with dealer seat positions. This provides validation data without needing new captures.

**Debug script** — `scripts/debug-dealer-button.ts`:
- Run detection on a single capture
- Save visual output: original image with seat zones overlaid, HSV mask, detected blob highlighted
- Print: detected seat, confidence, centroid position

**Test script** — extend `scripts/test-detection.ts` or create `scripts/test-position.ts`:
- Run dealer button detection on all annotated captures
- Report accuracy: correct seat / total captures with ground truth
- Target: >90% accuracy on Playtech captures

## Acceptance Criteria

- [ ] `detectDealerButton()` returns seat number for Playtech dealer button
- [ ] Position calculation maps dealer seat → hero position correctly for 6-max
- [ ] `DetectionResult` includes `heroPosition` field (nullable)
- [ ] `HandState` stores and locks position within a hand
- [ ] Position resets between hands (on WAITING transition)
- [ ] Claude prompt includes "Hero position: X" when detected
- [ ] Claude schema `.describe()` treats detected position as ground truth
- [ ] `buildHandContext()` includes position in context string
- [ ] Detection returns `null` when button not found (no false guesses)
- [ ] Runs in parallel with card matching — <50ms added latency
- [ ] >90% accuracy on existing Playtech captures with annotated ground truth
- [ ] Debug script outputs visual overlay of seat zones and detected button
- [ ] Existing card detection accuracy unaffected (252/252)

## Scope Constraints

- **Playtech (Holland Casino) only** — HSV thresholds tuned for this client's green D button
- **6-max only** — position labels assume 6 players; <6 players get approximate labels
- **No player count detection** — assume full table for position naming
- **No UI changes** — position shown only in Claude's output (UI badge is V2)
- **No multi-client support** — other clients fall back to Claude Vision (null return)

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| HSV thresholds too narrow → misses button | Start wide, narrow based on false positive data; null = safe fallback |
| False positive from chip stacks / UI elements | Size + circularity + position filters; require exactly 1 candidate |
| Seat zone mapping inaccurate at edges | 30° tolerance per zone; calibrate from multiple captures |
| Different Playtech themes change button color | Gate behind a simple color config; rare on Holland Casino |
| <6 players shift position names | V2 concern; 6-max labels still directionally useful |
| Resolution changes shift table center | Use relative coordinates; TABLE_CENTER is resolution-independent |

## File Summary

| File | Change |
|------|--------|
| `lib/card-detection/dealer-button.ts` | **New** — HSV filter, blob detection, seat mapping |
| `lib/card-detection/position.ts` | **New** — dealer seat → hero position calculation |
| `lib/card-detection/detect.ts` | Add `detectDealerButton()` to parallel pipeline |
| `lib/card-detection/types.ts` | Add `heroPosition` to `DetectionResult` |
| `lib/card-detection/index.ts` | Export new modules |
| `lib/hand-tracking/types.ts` | Add `heroPosition` to `HandState` |
| `lib/hand-tracking/state-machine.ts` | Lock position on first detection, clear on reset |
| `lib/hand-tracking/use-hand-tracker.ts` | Include position in `buildHandContext()` |
| `lib/ai/system-prompt.ts` | Add position ground truth instructions |
| `lib/ai/schema.ts` | Update `heroPosition` `.describe()` |
| `test/ground-truth.ts` | Add `dealerSeat` field to captures |
| `scripts/debug-dealer-button.ts` | **New** — visual debugging for detection |

## References

- Existing button detection: `lib/card-detection/buttons.ts` (HSV pattern)
- Existing blob detection: `lib/card-detection/locate.ts` (connected components)
- Position prompt fix: commit `f4336d4` (system-prompt.ts, schema.ts)
- Auto-learning plan: `docs/plans/2026-02-19-feat-auto-learning-card-references-plan.md`
- Aliasing sensitivity solution: `docs/solutions/logic-errors/card-detection-aliasing-sensitivity.md`
