---
status: resolved
priority: p2
issue_id: "007"
tags: [code-review, performance]
---

# Redundant sharp JPEG decodes + sequential card processing

## Problem Statement
The detection pipeline decodes the same JPEG 4+N times per frame (N = number of cards). Cards are processed sequentially when they could be parallelized.

## Findings
- `lib/card-detection/detect.ts`: `locateCards` decodes 3x, each `cropCorner` decodes 1x, `detectActionButtons` decodes 2x
- Total: ~11 decodes for 7 cards at 5-15ms each = 55-165ms of redundant work
- Card crop+preprocess loop is sequential but each card is independent

## Proposed Fix
1. Decode image once, pass raw buffer or `sharp.clone()` downstream
2. Parallelize card processing with `Promise.all(cards.map(...))`
3. Skip button detection when no hero cards found
4. Run button detection in parallel with card processing
