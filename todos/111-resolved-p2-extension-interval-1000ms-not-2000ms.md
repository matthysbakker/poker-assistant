---
status: pending
priority: p2
issue_id: "111"
tags: [code-review, performance, extension]
---

# Extension setInterval fires at 1000ms but architecture documents 2000ms

## Problem Statement
`background.ts` runs the capture interval at 1000ms. The state machine, detection mutex, and all documentation specify 2000ms. At 1s intervals, the `detectingRef` mutex drops ~50% of frames when detection takes 800ms+, doubling IPC traffic and JPEG captures with no effective increase in analyzed frames.

## Findings
- `extension/src/background.ts:113` — `}, 1000)` (should be `2000`)
- `lib/hand-tracking/use-continuous-capture.ts` — `detectingRef` mutex documented as 2s guard
- MEMORY.md: "2s interval" referenced throughout continuous capture architecture
- Net effect: 2x network traffic, 2x CPU load, same analysis output

## Proposed Fix
Change `1000` to `2000` in `background.ts:113`. Rebuild extension.

## Files
- `extension/src/background.ts:113`

## Acceptance Criteria
- [ ] Interval changed to 2000ms
- [ ] Extension rebuilt
- [ ] Continuous capture still triggers correctly during live session
