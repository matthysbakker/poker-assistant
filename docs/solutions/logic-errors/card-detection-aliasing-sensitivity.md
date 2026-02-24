---
title: Card Detection Fails Across Sessions Due to Binary Aliasing Sensitivity
date: 2026-02-18
category: logic-errors
tags: [card-detection, image-processing, template-matching, greyscale, aliasing]
module: lib/card-detection
symptoms:
  - All cards return NONE confidence on new session captures
  - Detection works perfectly on original session captures
  - Match scores drop from 100% to 54-74% on same-resolution images
  - Horizontal banding artifacts visible in preprocessed binary patterns
---

# Card Detection Fails Across Sessions Due to Binary Aliasing Sensitivity

## Problem

Card detection worked perfectly (100% accuracy) on captures from the original poker session but returned **zero detections** on 26 new captures from a different session — even at the same screen resolution.

**Symptoms:**
- `detectCards()` returns empty hero and community arrays
- `matchCard()` returns `NONE` confidence (scores of 54-74%)
- Same card at same resolution produces visually different binary patterns
- Debug visualization reveals horizontal banding artifacts in preprocessed crops

## Investigation Steps

1. **Locator check** — Confirmed `locateCards()` correctly finds card rectangles (blob detection works fine)
2. **Pipeline trace** — `matchCard()` scores dropped from 100% to 54-74%, all below confidence thresholds
3. **Corner crop comparison** — Card blob height varies ±4px between sessions (100px vs 104px) due to shadow/reflection rendering differences
4. **Binary pattern visualization** — Revealed the root cause: horizontal banding artifacts

## Root Cause

Two compounding issues:

### 1. Binary thresholding creates aliasing artifacts

The preprocessing pipeline was: `resize(80x120) → greyscale → threshold(180) → tightBBox → resize(32x48)`.

The `threshold(180)` step converts greyscale to pure black/white. When this binary image is resized to 32x48, the resampling creates **horizontal banding patterns** that are hypersensitive to even 1-2px input differences. A ±4px change in corner crop height produces completely different binary patterns.

### 2. Corner height derived from unstable blob height

Corner crop height was computed as `height * CORNER_HEIGHT_FRAC` where `height` is the detected blob height. Blob height varies ±4px between sessions due to different shadow/reflection rendering at the card edges, changing the crop dimensions and cascading into different binary patterns.

## Solution

### Fix 1: Greyscale comparison instead of binary

Store greyscale pixel values (not binary) and compare using similarity scoring:

```typescript
// preprocess.ts — Before (binary)
const { data } = await sharp(cropPng)
  .resize(WORK_W, WORK_H)
  .greyscale()
  .threshold(180)  // <-- creates aliasing
  .raw()
  .toBuffer({ resolveWithObject: true });

// preprocess.ts — After (greyscale)
const { data: greyData } = await sharp(cropPng)
  .resize(WORK_W, WORK_H)
  .greyscale()
  // threshold used ONLY for finding tight bbox, not stored
  .raw()
  .toBuffer({ resolveWithObject: true });

const bbox = tightBBox(greyData, info.width, info.height, 180);
// Crop greyscale (not binary) to bbox, then resize
```

```typescript
// compareBinary — Before (exact pixel match)
if (a[i] === b[i]) matching++;
return matching / len;

// compareBinary — After (greyscale similarity)
similarity += 1 - Math.abs(a[i] - b[i]) / 255;
return similarity / len;
```

### Fix 2: Derive corner height from card width

Card width is stable across sessions; blob height varies ±4px.

```typescript
// locate.ts — Before (unstable)
const cornerH = Math.round(height * CORNER_HEIGHT_FRAC);

// locate.ts — After (stable)
const expectedHeight = Math.round(width / SINGLE_CARD_ASPECT);
const cornerH = Math.round(expectedHeight * CORNER_HEIGHT_FRAC);
```

### Fix 3: Lower confidence gap thresholds

Greyscale comparison naturally produces smaller gaps between best and second-best matches (3-7% vs 10-20% for binary). Thresholds must be adjusted:

```typescript
// match.ts — Before (tuned for binary)
if (bestScore > 0.90 && gap > 0.10) confidence = "HIGH";
else if (bestScore > 0.85 && gap > 0.05) confidence = "MEDIUM";

// match.ts — After (tuned for greyscale)
if (bestScore > 0.90 && gap > 0.07) confidence = "HIGH";
else if (bestScore > 0.85 && gap > 0.03) confidence = "MEDIUM";
```

## Results

| Metric | Before | After |
|--------|--------|-------|
| New session captures | 0/26 detected | 25/26 correct |
| Total accuracy | 61/61 (old only) | 127/129 (all sessions) |
| Match scores | 54-74% on new | 94-100% on all |

2 remaining misses are locator issues (blob not splitting), not matching issues.

## Prevention

- **Never use binary thresholding on data that gets resized** — aliasing artifacts make the output unstable. Use thresholds only for structural analysis (bounding boxes), store continuous values for comparison.
- **Derive measurements from stable dimensions** — if width is stable but height varies, compute height-dependent values from width using known aspect ratios.
- **Test across sessions, not just captures** — same-session captures share rendering artifacts. Cross-session testing reveals fragility.

## Related

- `docs/brainstorms/2026-02-17-continuous-capture-card-detection-brainstorm.md` — foundational analysis of card detection approaches
- `docs/plans/2026-02-17-refactor-robust-card-detection-plan.md` — planned rank/suit separation approach (superseded by this greyscale fix)
- `lib/card-detection/preprocess.ts` — greyscale pipeline implementation
- `lib/card-detection/locate.ts` — stable corner height derivation
- `lib/card-detection/match.ts` — adjusted confidence thresholds
