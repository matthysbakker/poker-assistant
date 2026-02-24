# Auto-Learning Card References

**Date:** 2026-02-19
**Status:** Brainstorm
**Goal:** Eliminate manual reference population friction

## Problem

Card detection uses greyscale template matching against pre-populated `.bin` reference files. This works great (100% accuracy, 252/252 cards) but has friction:

1. **Per-resolution variants needed** — evening session (3024x1674) had 0% hero accuracy because refs only existed for daytime resolution (1920x1003). Required manual re-population.
2. **Manual labeling** — `populate-refs.ts` requires hand-annotated ground truth per capture.
3. **New poker sites** — different card designs need entirely new reference sets.
4. **No self-healing** — if a card can't be matched, it stays unmatched forever.

## What We're Building

An auto-learning system where Claude Vision identifies unknown cards, and the system automatically saves them as references for future local matching.

### Flow

1. Detection pipeline runs as normal (locate → crop corner → preprocess → match)
2. When a card has LOW/NONE confidence, flag it as "unknown"
3. Send the corner crop (or full screenshot + bounding box) to Claude: "What card is this?"
4. Claude returns the card code (e.g., "Kh")
5. System saves the preprocessed crop as a new reference variant
6. Next time that card appears at that resolution, it matches locally

### When to trigger

- Only during active hands (hero cards visible, action buttons present)
- Only for LOW/NONE confidence — HIGH/MEDIUM cards are already handled
- Rate-limit: max 1 Claude call per detection cycle to avoid cost spikes
- Skip if the same card position was already queried this hand

### Warm-up period

A new site/resolution needs ~5-10 hands to build enough references for reliable local matching. During warm-up:
- Claude handles identification (slower, costs API calls)
- Each confirmed card adds a reference
- After warm-up, detection runs fully local

## Why This Approach

### Considered alternatives

| Approach | Verdict |
|----------|---------|
| **OpenCV (SIFT/ORB)** | Handles scale variance but still needs per-site refs. Adds painful native dependency. Doesn't solve the core friction. |
| **OCR (Tesseract)** | Zero-shot but uncertain accuracy on small suit symbols and stylized fonts. Higher implementation risk. |
| **Auto-learning hybrid** | Minimal code change, leverages existing 100% accuracy, eliminates manual friction. Best effort/reward ratio. |

### Why not OpenCV?

Our custom `sharp`-based pipeline already achieves 100% accuracy. OpenCV would add scale-invariant matching (SIFT/ORB) which helps with resolution variance, but:
- `opencv4nodejs` is notoriously hard to build in Node.js
- WASM alternatives are large and slow
- The resolution problem is better solved by having multi-resolution refs (which auto-learning provides naturally)
- OpenCV doesn't eliminate per-site reference population

### Why not OCR?

OCR could be a future zero-shot solution but:
- Suit symbol recognition is unreliable at small crop sizes
- Tesseract needs training data for decorative card fonts
- Implementation risk is higher than auto-learning
- Could revisit later if auto-learning proves insufficient

## Key Decisions

1. **Use Claude Vision for identification** — already integrated, high accuracy on card images
2. **Save refs automatically** — no manual labeling step
3. **One-time cost per environment** — first ~5-10 hands use Claude, then fully local
4. **Keep existing matching unchanged** — auto-learning adds to it, doesn't replace it

## Open Questions

1. **Crop or full screenshot?** Sending just the 32x48 corner crop is tiny but lacks context. Sending the full screenshot costs more tokens but Claude can see the card clearly. Maybe send the corner region at a larger crop (e.g., 200x300px) for context without full screenshot cost.
2. **Confidence in Claude's answer?** Claude could misidentify a card, saving a bad reference. Should we require confirmation across multiple frames before saving?
3. **Dedup with existing refs?** If a card already has 10+ variants, should we still add more? Cap at N variants per card to prevent ref bloat.
4. **Cost budget?** At ~$0.003 per mini Claude call with a small image, warm-up for a new site costs ~$0.10-0.30. Acceptable?
5. **Resolution pinning?** If the poker client can be forced to a fixed window size, resolution variance disappears entirely. Worth exploring as a simpler workaround before building auto-learning.
