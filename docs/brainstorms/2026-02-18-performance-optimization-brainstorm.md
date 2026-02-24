---
topic: Performance Optimization — Faster End-to-End Response
date: 2026-02-18
status: decided
---

# Performance Optimization Brainstorm

## Problem

The continuous capture loop is too slow for real-time poker play. Current end-to-end timing:

| Phase | Current Time |
|-------|-------------|
| Frame capture interval | 2s |
| Card detection pipeline | ~200-500ms |
| State machine hysteresis (2 frames) | +4s minimum |
| Claude Sonnet 4 streaming | ~5-15s |
| **Total end-to-end** | **~9-19s** |

Players often have 15-30s to act. By the time advice arrives, the decision window may be half gone.

## What We're Building

A **two-tier response system**: instant local results shown immediately, then Claude streams in a deeper analysis underneath.

### Tier 1 — Instant Local Results (<1s)

Shown as soon as cards + game state are detected:

- **Detected cards + board state** from detection pipeline
- **Preflop persona charts** for preflop hands (already built)
- **Game state summary** (pot, position, street) from detection
- Goal: immediate confirmation the system is working + quick directional recommendation

### Tier 2 — Claude Streaming (~2-6s with optimizations)

Streams in below the instant results:

- Full reasoning, opponent profiling, exploit analysis
- Uses a faster model + reduced schema for continuous mode
- User can act on Tier 1 if time-pressured, or wait for Tier 2

## Key Decisions

### 1. Model: Haiku 4.5 for continuous, Sonnet 4 for manual

- Haiku is ~2-4x faster, good enough for real-time decisions
- Sonnet stays available for manual captures where quality matters more than speed
- Model selection based on `captureMode` field (already threaded through)

### 2. Reduced schema for continuous mode

Skip non-essential fields in continuous mode to reduce output tokens:
- Remove: `concept`, `tip` (coaching — not urgent in real-time)
- Shorten: `reasoning` (cap at 2-3 sentences)
- Keep: `action`, `amount`, `confidence`, `heroCards`, `communityCards`, `street`, `opponents`, `exploitAnalysis`

### 3. Pipeline speed improvements

- **Capture interval**: 2s → 1s (2x faster state detection)
- **Forward hysteresis**: 2 frames → 1 frame (saves 1-2s reaction time)
- **Image size**: 1568px → 1024px for continuous mode (faster Vision processing)
- **Prompt caching**: Cache system prompt with Anthropic's prompt caching (reduces TTFT)

### 4. Speculative analysis

Trigger Claude as soon as hero turn is detected (don't wait for extra confirmation frames). If it was a false positive, the analysis is simply discarded. The cost of a wasted Haiku call is negligible vs. the time saved.

## Target Timing

| Phase | Optimized Time |
|-------|---------------|
| Frame capture interval | 1s |
| Card detection pipeline | ~200-500ms |
| Hysteresis (1 frame) | +1s |
| **Tier 1 appears** | **~2-3s** |
| Haiku 4.5 streaming | ~2-5s |
| **Tier 2 complete** | **~4-8s** |

~2x improvement over current (~9-19s → ~4-8s), with actionable info available at ~2-3s.

## What We're NOT Doing

- **Local postflop heuristics** — Over-engineering. Postflop decisions have more thinking time, and the value of Claude's contextual analysis is highest postflop.
- **WebSocket/SSE for captures** — Current extension messaging is fast enough. The bottleneck is detection + Claude, not frame transport.
- **Client-side ML models** — Too much complexity for marginal gain. Server-side detection works fine.

## Open Questions

- Should we show a "Quick recommendation: RAISE" badge from preflop charts before Claude even starts? Or wait for Tier 1 detection to complete?
- Should we make the model configurable in settings, or just hardcode Haiku for continuous?
- Do we want a "fast mode" toggle in the extension popup alongside continuous capture?

## Implementation Notes

- `captureMode` is already threaded through to `/api/analyze` — use it to select model + schema
- Preflop persona charts are already built and integrated
- Prompt caching requires `anthropic-beta: prompt-caching-2024-07-31` header (check AI SDK support)
- React Compiler may already optimize re-renders during streaming

## References

- Current architecture: `docs/plans/2026-02-18-feat-continuous-capture-hand-tracking-plan.md`
- Preflop charts: `lib/poker/personas.ts`, `components/analyzer/PersonaComparison.tsx`
- Anthropic prompt caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
