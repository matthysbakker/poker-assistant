---
title: "Robust Card Detection with Binary Preprocessing and Rank-Suit Separation"
type: refactor
date: 2026-02-17
---

# Robust Card Detection with Binary Preprocessing and Rank-Suit Separation

## Overview

Replace the current raw pixel comparison (Mean Absolute Difference on RGB) with a preprocessing pipeline that binarizes card corners and matches rank and suit independently. This addresses three validated failure modes: cross-resolution mismatch, hero-vs-community size difference, and positional offset sensitivity.

## Problem Statement

Live testing of the current template matching system (27/52 references, raw RGB comparison at 80x120) revealed:

1. **Same-resolution, same-position: perfect** (diff=0, HIGH confidence)
2. **Cross-resolution fails:** A reference captured at 3024px doesn't match a 1920px crop because resampling interpolation produces different anti-aliasing patterns
3. **Cross-position fails:** Hero card references don't match community card crops because the Playtech client renders hero cards ~20% larger than community cards
4. **Positional offset:** Even comm1 vs comm3 at the same resolution can fail because 1-2px crop alignment differences cause high pixel diffs

The root cause is that raw RGB comparison is too sensitive to rendering artifacts that don't affect the actual card identity. A King of Clubs looks identical to the human eye at any resolution or position — the matching algorithm should agree.

## Proposed Solution

A three-part upgrade based on research into the [OpenCV Playing Card Detector](https://github.com/EdjeElectronics/OpenCV-Playing-Card-Detector) approach:

### 1. Binary Preprocessing Pipeline

Before comparison, normalize all card corner crops:

```
crop region → grayscale → normalize contrast → threshold → binary image
```

After binarization, cards become black text/symbols on a white background. Resampling artifacts, brightness variations, and anti-aliasing differences are eliminated. Two crops of the same card from different resolutions converge to the same binary pattern.

### 2. Separate Rank + Suit Matching

Split each binary card corner into two zones:
- **Rank zone** (top ~60%): contains A, 2, 3, ..., K
- **Suit zone** (bottom ~40%): contains the suit symbol

Match each zone independently:
- Rank: compare against 13 rank templates → best match
- Suit: compare against 4 suit templates → best match
- Card identity = best rank + best suit

Benefits:
- **17 references instead of 52** — faster to collect, faster to match
- **Better discrimination** — suit comparison is isolated, not drowned by rank area
- **Scale-invariant** — rank and suit are extracted and normalized independently
- **Position-invariant** — same templates work for hero and community cards

### 3. Per-Card Confidence with Partial Fallback

Instead of all-or-nothing detection per group (hero/community), report confidence per card. Partially detected hands communicate known cards to Claude while requesting help with uncertain ones.

## Technical Approach

### Preprocessing Pipeline (`lib/card-detection/preprocess.ts`)

```
sharp(crop)
  .greyscale()                          // Remove color, work with luminance
  .normalise({ lower: 2, upper: 98 })  // Stretch contrast to full range
  .threshold(128)                       // Binarize to pure black/white
  .resize(width, height)               // Normalize to comparison size
  .raw().toBuffer()                    // Extract pixel data
```

**Order of operations:** Crop at original resolution → resize to standard size → then binarize. Resizing first preserves relative proportions. Binarizing after resize avoids stair-stepping artifacts from scaling binary images.

**Red suit handling:** Red pixels (e.g., heart at RGB 220,0,0) convert to grayscale ~66 via luminance formula (0.299R + 0.587G + 0.114B). This is well below the 128 threshold, so red text/symbols become black in the binary output. Validated approach — sharp's `.greyscale()` uses the standard ITU-R BT.601 luminance formula.

### Zone Splitting

After binarization, split the 80x120 binary image:
- **Rank zone:** top 72 rows (0-71), resize to 60x90
- **Suit zone:** bottom 48 rows (72-119), resize to 60x60

The split ratio (60/40) is approximate. Actual ratio must be validated empirically on Playtech card renders before hardcoding. Key test cases:
- "Q" rank: has a descender tail that might cross into the suit zone
- "10" rank: wider than single-digit ranks, verify it fits the rank zone width
- Small community cards: suit pip might start higher relative to the corner

### Reference Architecture

```
data/card-references/
  ranks/
    A.png    # Binary rank template (60x90)
    2.png
    ...
    K.png
  suits/
    c.png    # Binary suit template (60x60)
    d.png
    h.png
    s.png
```

**Migration from existing 27 full-corner references:**

A one-time script processes each existing reference through the same pipeline (grayscale → normalize → threshold → split) to auto-generate rank and suit templates. Since multiple cards share the same rank (e.g., Kc, Kh, Ks, Kd all produce the same "K" binary pattern), deduplication keeps the best quality template for each rank.

### Comparison Metric

Replace Mean Absolute Difference with **percentage of matching pixels** on binary images:

```typescript
function compareBinary(a: Buffer, b: Buffer): number {
  let matching = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matching++;
  }
  return matching / a.length; // 0.0 to 1.0
}
```

**Confidence thresholds** (need calibration with real data):
- HIGH: match > 95% AND gap to second-best > 10%
- MEDIUM: match > 85% AND gap > 5%
- LOW: everything else

**Card confidence** = minimum of rank and suit confidence.

### Partial Detection in Claude Prompt

Update `formatDetectedCards()` to include per-card results:

```
Current:  "Hero: Kc Jd, Board: Ah 7h 2c"  (all-or-nothing per group)
Proposed: "Hero: Kc [unreadable], Board: Ah 7h [unreadable] [unreadable] 2c"
```

Claude receives partial detections with `[unreadable]` placeholders. The system prompt instructs: "Cards marked [unreadable] could not be detected by template matching. Please read these specific cards from the image. Trust all other card identities."

## Implementation Phases

### Phase 1: Validate Binary Preprocessing (30 min)

Before building anything, validate the core assumption: does binarization make cross-resolution and cross-position matching work?

- [ ] Write a quick validation script that takes existing corner crops, applies greyscale → normalise → threshold, and saves the output
- [ ] Visually inspect binary output for all 4 suit types (verify red suits binarize cleanly)
- [ ] Compare binary images of the same card from different resolutions / positions
- [ ] Measure the rank/suit split point on 5-10 actual Playtech card corners
- [ ] Determine if a single threshold (128) works or if adaptive thresholding is needed

**Go/No-Go:** If binarized images of the same card from different sources look identical (or near-identical), proceed. If not, investigate CLAHE or adaptive thresholding before continuing.

### Phase 2: Build Preprocessing + Rank/Suit Matching (1-2 hours)

- [ ] Create `lib/card-detection/preprocess.ts` with the binarization pipeline
- [ ] Add zone splitting (rank/suit) with configurable split ratio
- [ ] Create `data/card-references/ranks/` and `data/card-references/suits/` directories
- [ ] Write migration script: process existing 27 full-corner references → auto-generate rank + suit templates
- [ ] Implement binary comparison metric (percentage matching pixels)
- [ ] Update `matchCard()` to use rank+suit matching with new confidence thresholds
- [ ] Update `detect.ts` to use the new pipeline
- [ ] Keep the old 52-card matching as fallback when rank/suit references are unavailable

### Phase 3: Update Integration + Tooling (30 min)

- [ ] Update `formatDetectedCards()` for per-card partial detection
- [ ] Update system prompts to handle `[unreadable]` placeholders
- [ ] Update `cards:label` script for rank/suit labeling: `bun run cards:label <image> rank K` or `bun run cards:label <image> suit h`
- [ ] Update `cards:status` to show rank (13) and suit (4) reference status
- [ ] Update `cards:extract` to output binarized zone crops for visual inspection

### Phase 4: Validate + Calibrate (30 min)

- [ ] Create ground-truth test fixture: JSON file mapping each capture to expected cards
- [ ] Run `cards:test` against all 18 captures, compare results to ground truth
- [ ] Calibrate confidence thresholds based on actual binary match scores
- [ ] Verify cross-resolution matching works (3024px refs vs 1920px crops and vice versa)
- [ ] Verify cross-position matching works (hero refs matching community crops)
- [ ] Fix any comm4/comm5 calibration issues uncovered

## Acceptance Criteria

### Functional Requirements

- [ ] Same card from different resolutions (3024px and 1920px) matches with HIGH confidence
- [ ] Same card from hero and community positions matches with HIGH confidence
- [ ] All 4 suits (including red hearts/diamonds) binarize cleanly and match correctly
- [ ] "10" rank matches correctly (two-character width handled)
- [ ] Partial detection communicates known cards to Claude with `[unreadable]` for unknown
- [ ] Existing captures that previously worked still work (no regression)
- [ ] Reference count drops from 52 to 17 (13 ranks + 4 suits)

### Non-Functional Requirements

- [ ] Detection time stays under 200ms for all 7 card positions
- [ ] Preprocessed references cached in memory (processed once at startup, not per-request)
- [ ] Graceful fallback to full-corner matching when rank/suit refs unavailable
- [ ] Graceful fallback to Claude Vision when all detection fails

## Dependencies & Risks

**Dependencies:**
- `sharp` already supports all needed operations (greyscale, normalise, threshold, extract, resize, raw)
- No new npm packages required

**Risks:**
- **Red suit binarization** may not be clean at threshold 128 → mitigated by Phase 1 validation before building
- **Rank/suit split ratio** may vary between card sizes → mitigated by empirical measurement in Phase 1
- **"Q" descender** may cross zone boundary → test explicitly, adjust split ratio if needed
- **Highlighted/selected cards** (glow effects) may affect binarization → test with actual gameplay captures

## Alternative Approaches Considered

| Approach | Verdict | Why |
|----------|---------|-----|
| Perceptual hashing (pHash/dHash) | Rejected | Too coarse — can't discriminate similar suits (hearts vs diamonds) |
| SSIM (Structural Similarity) | Rejected | Marginal gain over binary matching, adds dependency |
| Full OpenCV (WASM build) | Rejected | Heavy dependency, overkill for known-position matching |
| Per-resolution reference sets | Rejected | Doubles reference count, doesn't solve hero/comm mismatch |
| NCC (Normalized Cross-Correlation) | Deferred | Good safety net (~25 LOC), but binary matching should be sufficient. Add later if needed. |
| Glyph bounding box extraction | Deferred | Removes dependence on exact crop positioning. Add in a follow-up if the fixed split ratio proves fragile. |

## Files Changed

| File | Change |
|------|--------|
| `lib/card-detection/preprocess.ts` | **NEW** — binarization pipeline + zone splitting |
| `lib/card-detection/match.ts` | Refactor — rank/suit matching, binary comparison metric, new confidence thresholds |
| `lib/card-detection/detect.ts` | Update — use preprocessed matching, per-card confidence |
| `lib/card-detection/types.ts` | Update — add rank/suit match types |
| `lib/card-detection/index.ts` | Update — export new functions |
| `lib/ai/system-prompt.ts` | Update — handle `[unreadable]` partial detection |
| `scripts/calibrate-regions.ts` | Update — output binarized zone crops for inspection |
| `scripts/label-card.ts` | Update — support `rank` and `suit` labeling modes |
| `scripts/check-references.ts` | Update — show rank (13) and suit (4) status |
| `scripts/test-detection.ts` | Update — compare against ground truth fixture |
| `scripts/migrate-references.ts` | **NEW** — convert existing 27 full-corner refs to rank+suit templates |
| `scripts/validate-binary.ts` | **NEW** — Phase 1 validation script |

## References

- [OpenCV Playing Card Detector](https://github.com/EdjeElectronics/OpenCV-Playing-Card-Detector) — reference implementation of rank+suit separation approach
- [sharp API: threshold](https://sharp.pixelplumbing.com/api-operation/#threshold) — binarization
- [sharp API: normalise](https://sharp.pixelplumbing.com/api-operation/#normalise) — contrast stretching
- [sharp API: greyscale](https://sharp.pixelplumbing.com/api-operation/#greyscale) — grayscale conversion
- [sharp API: convolve](https://sharp.pixelplumbing.com/api-operation/#convolve) — Sobel edge detection (deferred)
- Brainstorm: `docs/brainstorms/2026-02-17-continuous-capture-card-detection-brainstorm.md`
