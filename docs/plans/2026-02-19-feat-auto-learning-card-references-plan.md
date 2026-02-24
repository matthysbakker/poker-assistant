---
title: "Auto-Learning Card References"
type: feat
date: 2026-02-19
---

# Auto-Learning Card References

## Overview

Eliminate manual reference population by having Claude Haiku auto-identify unknown cards during gameplay. When the detection pipeline encounters a LOW/NONE confidence card, it sends the corner crop to Haiku for identification and saves the result as a new reference variant. After ~5-10 hands on a new site/resolution, detection runs fully local.

## Problem Statement

Card detection uses greyscale template matching against `.bin` reference files. Accuracy is 100% when references exist, but:

1. New resolutions need manual re-population (evening session had 0% hero accuracy)
2. `populate-refs.ts` requires hand-annotated ground truth per capture
3. New poker sites need entirely new reference sets
4. No self-healing — unmatched cards stay unmatched

## Proposed Solution

### Architecture

```
Frame arrives (every 2s)
  → POST /api/detect
  → detectCards() returns { heroCards, communityCards, unknownCards }
  → Client receives unknownCards (cards with LOW/NONE confidence)
  → Client fires POST /api/learn (fire-and-forget, deduped)
  → Server: re-crop corner from original image → color PNG
  → Server: generateObject() with Haiku + cardCodeSchema
  → Server: validate response against CardCode union
  → Server: preprocessCrop() → saveReference()
  → Next detection cycle: card matches locally at HIGH confidence
```

### Key Design Decisions

1. **Use `generateObject` (not streaming)** — single small result, Haiku is fast enough
2. **Send color corner crop to Haiku** (not the 32x48 greyscale buffer) — Haiku needs color to distinguish suits
3. **Fire-and-forget from client** — learning doesn't block detection or analysis
4. **Validate against `CardCode` union** — prevents path traversal and garbage refs
5. **Client-side dedup** — track cards being learned to prevent duplicate Haiku calls
6. **Local-dev only** — Vercel has no persistent filesystem; gate behind `AUTO_LEARN=true`
7. **Variant cap** — max 10 variants per card per group to prevent ref bloat

## Technical Approach

### Phase 1: Expose Unknown Cards from Detection

**Files:** `lib/card-detection/detect.ts`, `lib/card-detection/types.ts`

Modify `detectCards()` to return LOW/NONE confidence cards alongside confident ones.

**`types.ts`** — add `UnknownCard` type and extend `DetectionResult`:

```typescript
export interface UnknownCard {
  group: CardGroup;
  corner: { x: number; y: number; width: number; height: number };
  matchScore: number;
  bestGuess: CardCode | null;  // LOW confidence guess, if any
}

export interface DetectionResult {
  heroCards: CardMatch[];
  communityCards: CardMatch[];
  unknownCards: UnknownCard[];  // NEW
  detectedText: string;
  heroTurn: boolean;
  timing: number;
}
```

**`detect.ts`** — collect unknown cards instead of discarding them:

```typescript
// Currently: if (!isConfident(match)) return null;
// Change to: return { match, group, corner } always
// Then partition into confident vs unknown after Promise.all
```

### Phase 2: Learn Endpoint

**Files:** `app/api/learn/route.ts` (new)

```typescript
// POST { image: string, cards: UnknownCard[] }
// For each unknown card:
//   1. sharp(imageBuffer).extract(card.corner) → corner crop PNG
//   2. generateObject({ model: haiku, schema: cardCodeSchema, messages: [crop image] })
//   3. Validate response against CardCode type
//   4. preprocessCrop(cornerCrop) → saveReference(preprocessed, group, cardCode)
// Return { learned: CardCode[] }
```

**Schema for Haiku:**

```typescript
const cardCodeSchema = z.object({
  card: z.enum([/* all 52 CardCode values */])
    .describe("The playing card shown. Use format: Ah, Kd, 10s, 2c etc.")
});
```

**Prompt:** "This is the top-left corner of a playing card from an online poker game. Identify the card rank and suit."

**Error handling:**
- `preprocessCrop` returns null → skip, don't save
- Haiku returns invalid code → skip, log warning
- Network/API error → skip, log warning
- No retries — the card will appear again next frame

### Phase 3: Client Integration

**Files:** `lib/hand-tracking/use-continuous-capture.ts`

After a successful `/api/detect` response with `unknownCards.length > 0`:

1. Check dedup registry — skip cards already being learned this hand
2. Check hand state — only learn during PREFLOP/FLOP/TURN/RIVER (not WAITING)
3. Fire `POST /api/learn` (fire-and-forget via `fetch().catch(noop)`)
4. Add card positions to dedup registry
5. Clear dedup registry on hand reset (analyzeGeneration change)

**Dedup key:** `${group}-${Math.round(corner.x/10)}-${Math.round(corner.y/10)}` — approximate position to handle ±pixel jitter between frames.

**Rate limit:** Max 2 unknown cards per `/api/learn` call to limit concurrent Haiku usage.

### Phase 4: Safety Rails

**Variant cap** in `saveReference` (`match.ts`):

```typescript
const MAX_VARIANTS = 10;
const existing = readdirSync(dir).filter(...);
if (existing.length >= MAX_VARIANTS) return;
```

**Write lock** — use a simple boolean flag to prevent concurrent `saveReference` for the same card code:

```typescript
const writeLocks = new Set<string>();
// Check/set before write, delete after write
```

**Logging** — log every learn event for debugging:

```
[learn] hero/Kh identified (score=0.92) from frame at t=1708300800
```

## Acceptance Criteria

- [ ] `/api/detect` returns `unknownCards` for LOW/NONE confidence cards
- [ ] `/api/learn` endpoint accepts image + unknown card positions
- [ ] Haiku correctly identifies cards from corner crop PNGs
- [ ] References are saved and immediately available for next detection cycle
- [ ] Client deduplicates — same card position not queried twice per hand
- [ ] Learning only fires during active hands (not WAITING state)
- [ ] Variant cap prevents unbounded ref growth (max 10 per card)
- [ ] Card code validated against `CardCode` union before saving
- [ ] Feature gated behind `AUTO_LEARN=true` env var
- [ ] Existing detection accuracy maintained (252/252 cards)

## Scope Constraints

- **Local development only** — no Vercel persistence strategy (refs are on-disk)
- **No UI feedback** during warm-up (can add later)
- **No multi-frame verification** — single Haiku call trusted (bad refs are rare, manually deletable)
- **No automatic ref cleanup** — if a bad ref is saved, delete the `.bin` file manually

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| Haiku misidentifies card → bad reference | Validate against CardCode union; bad refs are manually deletable; variant cap limits blast radius |
| Cost spike during warm-up | Rate limit: max 2 cards per learn call; warm-up converges in ~5-10 hands |
| `saveReference` race condition | Write lock set per card code; concurrent writes for same card are serialized |
| Frame image no longer available for learn | Client must preserve original base64 until learn fires |

## Open Questions (Deferred)

1. Production persistence strategy (Supabase Storage? Commit to git?)
2. UI indicator during warm-up ("Learning new cards...")
3. Multi-frame verification before saving (require 2+ Haiku agreements)
4. Resolution pinning as simpler alternative (force poker window size)

## References

- Brainstorm: `docs/brainstorms/2026-02-19-auto-learning-card-references-brainstorm.md`
- Current detection: `lib/card-detection/detect.ts:30` (LOW/NONE discard point)
- Reference save: `lib/card-detection/match.ts:145-164` (`saveReference`)
- Claude Vision pattern: `lib/ai/analyze-hand.ts:54-79` (`streamObject` with image)
- Existing populate script: `scripts/populate-refs.ts` (ground truth → refs)
- Detection types: `lib/card-detection/types.ts:27-55`
