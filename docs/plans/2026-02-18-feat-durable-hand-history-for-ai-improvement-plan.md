---
title: "feat: Durable hand history storage for AI improvement"
type: feat
date: 2026-02-18
---

# Durable Hand History Storage for AI Improvement

## Overview

Store every analyzed hand as structured JSON + screenshot on disk so we can review AI advice quality, opponent reads, and detection accuracy — then use those insights to improve the system prompt and card detection pipeline.

## Problem Statement

Currently hands are stored in `localStorage` only — ephemeral, browser-bound, and missing key diagnostic data (detection confidence scores, which system prompt variant was used, what opponent history was passed to Claude). We need a durable, structured record of **everything the AI saw and everything it produced** to identify patterns in bad advice or misreads.

## Proposed Solution

**Server-side save inside `/api/analyze`** after the stream completes. The server already has all the data: raw image buffer, `DetectionResult` with per-card confidence, `handContext`, `opponentHistory`, and — once the stream resolves — the full `HandAnalysis`. No second HTTP round-trip needed.

### Why server-side (not a separate `/api/hands` POST)?

- `/api/analyze` already holds the `DetectionResult` (confidence, matchScore, gap per card) — the client never sees this
- Avoids sending the full image base64 back to the server a second time
- Simpler architecture: one save point, no coordination between endpoints
- The AI SDK's `result.object` promise resolves when streaming completes — we can fire the save as a non-blocking side effect

## Technical Approach

### Storage Layout

```
data/
└── hands/                          # gitignored
    └── 2026-02-18/                 # UTC date partition
        ├── a1b2c3d4.json           # full hand record (metadata + AI output)
        └── a1b2c3d4.jpg            # raw screenshot as received
```

### HandRecord Schema

```typescript
// lib/storage/hand-records.ts

interface DetectionDetail {
  card: string;          // e.g. "Kc"
  group: "hero" | "community";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  matchScore: number;    // 0-1
  gap: number;           // score difference to 2nd-best match
}

interface HandRecord {
  id: string;                        // crypto.randomUUID()
  timestamp: string;                 // ISO 8601
  captureMode: "manual" | "continuous";

  // What the AI saw (inputs)
  screenshotFile: string;            // relative path: "2026-02-18/a1b2c3d4.jpg"
  detectedText: string | null;       // "Hero: Kc Jd, Board: Ah 4h Jc" — the string sent to Claude
  detectionDetails: DetectionDetail[];  // per-card confidence for pipeline analysis
  handContext: string | null;        // accumulated street history from state machine
  opponentHistory: OpponentProfile[] | null;  // what Claude was given about opponents
  systemPromptVariant: "standard" | "with-detected-cards";

  // What the AI produced (outputs)
  analysis: HandAnalysis;            // full Zod schema output
}
```

### Save Flow

```
POST /api/analyze
  → parse request (image, opponentHistory, handContext, captureMode)
  → detectCards(image) → DetectionResult
  → analyzeHand(...) → result (StreamObjectResult)
  → return result.toTextStreamResponse()      ← stream starts immediately
  → result.object.then(analysis => {          ← non-blocking side effect
      if (SAVE_HANDS !== "true") return
      if (!analysis.action) return            ← skip partial/failed analyses
      writeHandRecord({ id, image, detection, analysis, ... })
    }).catch(err => console.warn("[hands] save failed:", err))
```

The stream starts immediately — the client sees no latency. The disk write happens in the background after the stream completes.

### Implementation Phases

#### Phase 1: Core Storage (`lib/storage/hand-records.ts` + `/api/analyze` changes)

**Files to create:**
- `lib/storage/hand-records.ts` — `HandRecord` type + `writeHandRecord()` function

**Files to modify:**
- `app/api/analyze/route.ts` — add `captureMode` to request schema, add server-side save after stream
- `.gitignore` — add `data/hands/`
- `.env.local` — add `SAVE_HANDS=true`

**`writeHandRecord()` implementation:**
```typescript
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export async function writeHandRecord(record: HandRecord, imageBuffer: Buffer): Promise<void> {
  const date = record.timestamp.slice(0, 10);  // UTC date
  const dir = join(process.cwd(), "data/hands", date);
  await mkdir(dir, { recursive: true });

  // Write JSON (no image data — kept separate)
  await writeFile(
    join(dir, `${record.id}.json`),
    JSON.stringify(record, null, 2)
  );

  // Write screenshot
  await writeFile(join(dir, `${record.id}.jpg`), imageBuffer);
}
```

**`/api/analyze` changes (pseudocode):**
```typescript
// Add to requestSchema
captureMode: z.enum(["manual", "continuous"]).optional().default("manual"),

// After existing streamObject call
const result = analyzeHand(image, opponentHistory, detectedText, handContext);

// Non-blocking save side effect
if (process.env.SAVE_HANDS === "true") {
  result.object.then(async (analysis) => {
    if (!analysis.action) return;  // skip partial

    const record: HandRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      captureMode: parsed.data.captureMode ?? "manual",
      screenshotFile: `${date}/${id}.jpg`,
      detectedText: detectedText ?? null,
      detectionDetails: mapDetectionToDetails(detection),
      handContext: parsed.data.handContext ?? null,
      opponentHistory: parsed.data.opponentHistory
        ? Object.values(parsed.data.opponentHistory)
        : null,
      systemPromptVariant: detectedText ? "with-detected-cards" : "standard",
      analysis,
    };

    await writeHandRecord(record, imageBuffer);
  }).catch((err) => {
    console.warn("[hands] Failed to save hand record:", err);
  });
}

return result.toTextStreamResponse();
```

#### Phase 2: Client-side `captureMode` threading

**Files to modify:**
- `components/analyzer/AnalysisResult.tsx` — pass `captureMode` in `submit()` body
- `app/page.tsx` — thread `captureMode` state to `AnalysisResult`

The `captureMode` is already known on the client (`useContinuousCapture` sets it). Thread it through to the API call so the server can tag records correctly.

#### Phase 3: Query Script (`scripts/query-hands.ts`)

A simple Bun script to validate data and spot patterns:

```bash
bun run scripts/query-hands.ts
```

**Output example:**
```
Hand Records Summary
────────────────────
Total records: 47
Date range: 2026-02-18 → 2026-02-18

By capture mode:
  manual:     12  (25.5%)
  continuous: 35  (74.5%)

By street:
  PREFLOP: 18  FLOP: 15  TURN: 9  RIVER: 5

By recommended action:
  FOLD: 14  CALL: 12  RAISE: 11  CHECK: 6  BET: 4

By confidence:
  HIGH: 28  MEDIUM: 15  LOW: 4

Detection accuracy:
  Cards with HIGH confidence: 89/94 (94.7%)
  Cards with MEDIUM confidence: 31/94 (33.0%)
  Average gap (HIGH): 8.2%
  Average gap (MEDIUM): 3.1%

System prompt variants:
  with-detected-cards: 41 (87.2%)
  standard (vision only): 6 (12.8%)
```

**File to create:**
- `scripts/query-hands.ts`

## Env Var Convention

| Variable | Semantics | Default | Purpose |
|----------|-----------|---------|---------|
| `SAVE_CAPTURES` | Opt-out (`!== "false"`) | enabled | Raw PNGs to `test/captures/` for debugging |
| `SAVE_HANDS` | Opt-in (`=== "true"`) | disabled | Structured JSON + JPG to `data/hands/` for analysis |

Both can coexist. `SAVE_CAPTURES` writes raw PNGs for immediate debugging; `SAVE_HANDS` writes structured records for longitudinal analysis. When `SAVE_HANDS=true`, you can set `SAVE_CAPTURES=false` to avoid duplicate images.

## Edge Cases Handled

- **Partial analysis (stream timeout):** Skipped — only save when `analysis.action` is present
- **Detection failure:** Saved with `detectedText: null`, `detectionDetails: []`, `systemPromptVariant: "standard"`
- **Directory doesn't exist:** `mkdir(dir, { recursive: true })` before write
- **Write failure:** `console.warn` with hand ID, no crash, stream unaffected
- **Multiple streets per hand (continuous):** Each analysis is an independent record. `handContext` implicitly carries prior street data for grouping
- **Image format:** Written as raw buffer (JPEG as received), no re-encoding

## Not In Scope (Future)

- Linking multiple analyses from the same hand (session/hand ID grouping)
- Outcome tracking (win/loss) — too noisy with poker variance
- In-app review UI for hand records — this is a dev/analysis tool
- Cloud storage (Supabase) — overkill for a personal tool
- Export to CSV/notebooks — the JSON files are directly readable by scripts

## Acceptance Criteria

- [ ] Every completed analysis writes a `.json` + `.jpg` to `data/hands/YYYY-MM-DD/` when `SAVE_HANDS=true`
- [ ] HandRecord includes full detection details (per-card confidence, score, gap)
- [ ] HandRecord includes the system prompt variant used
- [ ] HandRecord includes `handContext` and `opponentHistory` as sent to Claude
- [ ] No latency impact on the streaming response (save is non-blocking)
- [ ] Partial/failed analyses are not saved
- [ ] `data/hands/` is gitignored
- [ ] `captureMode` correctly distinguishes manual vs continuous captures
- [ ] `scripts/query-hands.ts` can read and summarize all saved records
- [ ] Write failures are logged but don't crash the API route

## References

- Current storage: `lib/storage/hands.ts` (localStorage CRUD)
- API route: `app/api/analyze/route.ts` (where save hook goes)
- Detection types: `lib/card-detection/types.ts` (`DetectionResult`, `CardMatch`)
- AI schema: `lib/ai/schema.ts` (`HandAnalysis`)
- State machine: `lib/hand-tracking/state-machine.ts`
- Existing file write pattern: `app/api/analyze/route.ts:42-50` (SAVE_CAPTURES)
