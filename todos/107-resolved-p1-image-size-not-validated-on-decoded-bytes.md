---
status: pending
priority: p1
issue_id: "107"
tags: [code-review, security, performance, api]
---

# Image size enforced on base64 string length, not decoded byte count — Sharp memory exhaustion

## Problem Statement
Both `/api/analyze` and `/api/detect` limit the image to `max(10_000_000)` characters of base64. This decodes to ~7.5 MB, but a valid PNG with aggressive DEFLATE compression can pack 100+ MB of pixel data into 7 MB. Sharp decompresses the full image into memory before any processing. `/api/detect` is called every 1-2 seconds in continuous mode, making this a realistic memory exhaustion vector.

## Findings
- `app/api/analyze/route.ts:56` — `image: z.string().min(1).max(10_000_000)`
- `app/api/detect/route.ts:7` — same `max(10_000_000)` limit
- No `limitInputPixels` guard in `lib/card-detection/locate.ts`, `match.ts`, `detect.ts`, or `buttons.ts`
- Sharp processes full decompressed pixel data for every detection frame

## Proposed Fix
Two-part fix:
1. After base64 decode, assert decoded byte length: `if (buf.length > 8_000_000) return Response.json({ error: "Image too large." }, { status: 413 })`
2. Pass `{ limitInputPixels: 25_000_000 }` to every `sharp(imageBuffer)` call in the detection pipeline

## Files
- `app/api/analyze/route.ts:56` (and after base64 decode)
- `app/api/detect/route.ts:7` (and after base64 decode)
- `lib/card-detection/locate.ts` — all `sharp(imageBuffer)` calls
- `lib/card-detection/buttons.ts` — sharp calls
- `lib/card-detection/dealer-button.ts` — sharp call

## Acceptance Criteria
- [ ] Crafted oversized PNG rejected with 413 at both endpoints
- [ ] `limitInputPixels` option applied to all Sharp calls in detection pipeline
- [ ] Normal poker screenshots (1920x1080 JPEG) still process correctly
