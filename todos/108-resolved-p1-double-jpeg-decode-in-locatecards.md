---
status: pending
priority: p1
issue_id: "108"
tags: [code-review, performance, card-detection]
---

# Double JPEG decompression in locateCards — wastes one full decode per 2s frame

## Problem Statement
`locateCards` decodes the same `imageBuffer` twice in parallel: once to get a blurred greyscale buffer, once to get an unblurred greyscale buffer. Sharp decodes from source bytes each time. Combined with concurrent `detectActionButtons` and `detectDealerButton` calls, there are 4-5 competing Sharp decodes per frame on a 4-thread libuv pool.

## Findings
- `lib/card-detection/locate.ts:66-78` — `Promise.all([sharp(imageBuffer).blur(), sharp(imageBuffer).raw()])` — two separate decodes of the same source
- `lib/card-detection/buttons.ts` — additional Sharp decode for action buttons
- `lib/card-detection/dealer-button.ts:81-85` — 960px RGB decode (heaviest operation, ~1.6MB raw) runs when position not yet known

## Proposed Fix
Perform a single 480px greyscale decode upfront, then derive the blurred variant from the already-decoded raw buffer:
```typescript
const { data: rawData, info } = await sharp(imageBuffer)
  .resize(ANALYSIS_WIDTH)
  .greyscale()
  .raw()
  .toBuffer({ resolveWithObject: true });

const blurredData = await sharp(rawData, { raw: { width: info.width, height: info.height, channels: 1 } })
  .blur(BLUR_SIGMA)
  .raw()
  .toBuffer();
```
This eliminates one full JPEG decompress per frame.

## Files
- `lib/card-detection/locate.ts:66-78`

## Acceptance Criteria
- [ ] Only one JPEG decode for the source buffer in locateCards
- [ ] Blurred and unblurred buffers still produced correctly
- [ ] Card detection accuracy unchanged (run `bun run cards:test` to verify)
