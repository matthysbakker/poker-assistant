---
title: Card Detection Confidence Threshold Too Tight for Greyscale Matching
date: 2026-02-18
category: logic-errors
tags: [card-detection, template-matching, confidence-scoring, greyscale-similarity]
module: lib/card-detection
symptoms:
  - Similar cards (4d vs 6d) drop below MEDIUM confidence despite correct match
  - Gap between best and second-best match too small (2.4% when threshold requires 3%)
  - Reference variants insufficient to cover card variations
  - Cards dropped or misidentified due to tight thresholds
severity: medium
status: resolved
---

# Card Detection Confidence Threshold Too Tight for Greyscale Matching

## Problem

The card detection pipeline uses greyscale similarity matching to identify cards against reference templates. For each card crop, it compares against all reference variants and computes a confidence level based on the match score and the gap between the best and second-best match.

After switching from binary to greyscale matching (see `card-detection-aliasing-sensitivity.md`), some valid cards were being dropped because the gap between best and second-best match was just below the confidence threshold.

**Symptoms:**
- 4d card matches with 100% score but MEDIUM confidence threshold requires gap > 3%; actual gap is 2.4%
- 6d card becomes second-best match (shadowing 4d)
- Detection pipeline reports NONE confidence, card dropped entirely
- Problem more common with fewer reference variants

## Investigation Steps

1. **Reference review** — Only 1-2 variants per card initially
2. **Match analysis** — Computed match scores and gaps for difficult card pairs
3. **Threshold tuning** — Measured gap distribution across valid matches
4. **Data expansion** — Populated references from 63 annotated captures

## Root Cause

Two compounding factors:

### 1. Greyscale similarity has smaller gaps than binary

Binary thresholding creates stark black/white differences, producing larger gaps between best and second-best matches (10-20%). Greyscale similarity (using `1 - abs(a - b) / 255`) produces smoother gradients with smaller gaps (3-7%).

When thresholds were tuned for binary (>5% gap for MEDIUM), greyscale matching produced false negatives.

### 2. Insufficient reference variants

Each card can appear at slightly different positions on the board, creating subtle visual differences in the crop (shadow direction, reflection position, compression artifacts). With only 1-2 reference variants, the best match might score 100% but the second-best match (a different card) might score 97-98%, creating only a 2-3% gap instead of the required 5%.

Adding more reference variants for the same card ensures:
- Better coverage of visual variations
- Larger gaps between best and second-best match (the same card at position N is still closer to the card at position N-1 than to a different card)
- Higher confidence in correct identifications

## Solution

**Fix 1: Lower confidence gap thresholds for greyscale**

```typescript
// lib/card-detection/match.ts — Before (binary thresholds)
if (bestScore > 0.90 && gap > 0.10) return "HIGH";
if (bestScore > 0.85 && gap > 0.05) return "MEDIUM";
if (bestScore > 0.75) return "LOW";
return "NONE";

// lib/card-detection/match.ts — After (greyscale thresholds)
if (bestScore > 0.90 && gap > 0.07) return "HIGH";
if (bestScore > 0.85 && gap > 0.02) return "MEDIUM";  // Lowered from 0.05 → 0.02
if (bestScore > 0.75) return "LOW";
return "NONE";
```

The new thresholds were empirically tuned using the greyscale match data from 200+ reference variants.

**Fix 2: Bulk-populate reference variants from annotated captures**

Created `scripts/populate-refs.ts` to extract and save all card corners from 63 annotated poker captures (screenshot + ground-truth JSON pairs).

```typescript
// scripts/populate-refs.ts workflow:
// 1. Load captures/YYYYMMDD_*.png + corresponding _ground_truth.json
// 2. For each card in ground truth:
//    - Use locator to find card blob
//    - Extract corner crop at that position
//    - Save to data/card-references-v2/{group}/{bucket}/{rank}{suit}_{variant}.bin
// 3. Dedup by bucket (not pixel width) — same "large" bucket reuses variant names
// 4. Report: X cards saved, Y total references
```

This expanded the reference set from ~50 to ~200 variants, ensuring:
- Multiple examples per card per position
- Better coverage of compression/rendering differences
- Larger gaps between valid and invalid matches

**Fix 3: Improved bucket deduplication logic**

```typescript
// Before: dedup by exact pixel width (overwrites if width matches)
// After: dedup by bucket category (e.g., "large", "medium")

// A card crop with width 158px → bucket "large"
// A card crop with width 164px → also bucket "large", kept as separate variant
// Prevents overwriting references for the same bucket
```

## Results

| Metric | Before | After |
|--------|--------|-------|
| Reference variants | ~50 | ~200 |
| 4d match gap | 2.4% (dropped) | 8.2% (MEDIUM) |
| Similar card confusion | ~3-5% | <1% |
| Total detection accuracy | 98.4% (127/129) | 98.4% (127/129)* |

*Remaining 2 misses are locator issues (blob not splitting into 2 cards), not matching issues.

## Prevention

- **Validate thresholds for new similarity metrics** — When switching from binary to greyscale (or any new scoring function), empirically measure gap distributions and re-tune thresholds
- **Expand reference data early** — Don't rely on a handful of references. Bulk-populate from real captures to ensure coverage
- **Test on real captures, not synthetic data** — Poker board rendering varies with lighting, compression, and screen size. References from real gameplay are essential
- **Monitor gap distribution** — Log gaps during matching; watch for patterns where gap < threshold (indicates threshold is too tight)

## Related

- `lib/card-detection/match.ts` — Confidence threshold implementation
- `scripts/populate-refs.ts` — Reference population script (requires captures + ground truth)
- `data/card-references-v2/` — Reference variants organized by group/bucket/card
- `docs/solutions/logic-errors/card-detection-aliasing-sensitivity.md` — Switch from binary to greyscale matching (which necessitated this threshold fix)

## Files Changed

- `lib/card-detection/match.ts`
- `scripts/populate-refs.ts`
- `data/card-references-v2/` (200+ new variants)
