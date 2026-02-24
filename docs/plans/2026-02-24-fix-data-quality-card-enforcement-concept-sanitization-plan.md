---
title: "fix: Data Quality — Card Enforcement, Concept Coverage, Outlier Sanitization, Temperature Seeding"
type: fix
date: 2026-02-24
---

# fix: Data Quality — Card Enforcement, Concept Coverage, Outlier Sanitization, Temperature Seeding

## Overview

Four targeted fixes to clean up the hand record data quality issues surfaced by `scripts/analyze-hands.ts`. All four are server-side or schema-level changes — no UI work required.

| Issue | Root Cause | Current Impact |
|---|---|---|
| Claude adds undetected hero cards | Schema says "use them exactly" but Claude interprets it as "use detected AND fill rest from vision" | 89.5% of records have < 2 detected hero cards; second card is a Claude guess |
| `concept` empty 65% of records | `analyze-hand.ts:47` explicitly tells Claude "skip the concept and tip" in continuous mode (91.8% of captures) | Teaching value lost for every live-game capture |
| Stack/pot outliers (€4627 stack, €125 pot) | Pure Claude Vision OCR with no validation or clamping | Corrupts any future EV or stake-level analysis |
| Table temperature `unknown` 53% | `MIN_READS=3` — needs 3 non-UNKNOWN classified opponents before temperature activates; early-session state is cold | Persona selection defaults to GTO Grinder when exploitation may be profitable |

---

## Fix 1 — Enforce Detected Cards Post-Stream

### Problem

When detection finds only 1 hero card (e.g., `"Hero: Qc"`), Claude receives that as ground truth but still sees the full image. It outputs `heroCards: "Qc 5s"` — correct on the detected card, but adds a second card from its own vision read.

The schema describe currently says:
> "If detected cards were provided, use them exactly."

Claude reads this as: use the detected ones exactly **and** fill the rest from the image. There is no post-stream enforcement; `route.ts:129` stores `analysis` as-is from the stream.

### Fix

**A) Post-stream overwrite in `route.ts`** — after `result.object` resolves, overwrite `heroCards` and `communityCards` with only what detection confirmed (HIGH or MEDIUM confidence). This is deterministic and cannot be overridden by Claude.

```ts
// app/api/analyze/route.ts — inside result.object.then(async (analysis) => { ... })

// Enforce detected cards as ground truth in the stored record
if (detection) {
  const enforceCards = (matches: CardMatch[]) =>
    matches
      .filter(m => m.confidence === "HIGH" || m.confidence === "MEDIUM")
      .map(m => m.card)
      .filter(Boolean)
      .join(" ");

  const detectedHero = enforceCards(detection.heroCards);
  const detectedCommunity = enforceCards(detection.communityCards);

  if (detectedHero) analysis = { ...analysis, heroCards: detectedHero };
  if (detectedCommunity) analysis = { ...analysis, communityCards: detectedCommunity };
}
```

**B) Strengthen schema describe for `heroCards` and `communityCards`** in `lib/ai/schema.ts`:

Before:
```ts
heroCards: z.string().describe(
  "Hero's hole cards. If detected cards were provided, use them exactly. " +
  "Only read from the image if no detection was provided."
)
```

After:
```ts
heroCards: z.string().describe(
  "Hero's hole cards. If 'Detected cards: ...' was provided: copy ONLY those detected cards exactly — " +
  "do NOT add cards you see in the image that were not in the detection. " +
  "If a card is missing from detection, write '??' as placeholder, e.g. 'Qc ??'. " +
  "Only read fully from the image if no detection was provided at all."
)
```

Same pattern for `communityCards`.

**Files to change:**
- `app/api/analyze/route.ts` — add post-stream enforcement block
- `lib/ai/schema.ts` — update `heroCards` and `communityCards` describe strings

**Expected result:** `analysis.heroCards` in stored records will always reflect ground truth detection. Records with 1 detected card will store `"Qc ??"` instead of a hallucinated second card.

---

## Fix 2 — Enable `concept` in Continuous Mode

### Problem

`lib/ai/analyze-hand.ts:47`:
```ts
if (captureMode === "continuous") {
  userText += "\n\nThis is a live game. Be concise — skip the concept and tip.";
}
```

Continuous mode is 91.8% of all captures. `concept` is empty in 65% of all records because we explicitly tell Claude to skip it. The schema also says `"Omit in continuous/fast mode."` in its describe string — so both the user message and the schema description reinforce omission.

`concept` is a 2-3 word string (e.g., `"Button Steal"`, `"Value Betting"`). Being concise does not require skipping it.

### Fix

**A) Change the continuous mode instruction** in `lib/ai/analyze-hand.ts`:

Before:
```ts
userText += "\n\nThis is a live game. Be concise — skip the concept and tip.";
```

After:
```ts
userText += "\n\nThis is a live game. Be concise — skip the tip only. Keep concept short (2-4 words).";
```

**B) Update schema describe strings** in `lib/ai/schema.ts`:

`concept` before:
```ts
.describe("The key poker concept at play, e.g. 'Pot Odds', 'Position Advantage', 'Semi-Bluff'. Omit in continuous/fast mode.")
```

After:
```ts
.describe("The key poker concept at play, e.g. 'Pot Odds', 'Position Advantage', 'Semi-Bluff'. Keep to 2-4 words. Always include.")
```

`tip` stays as-is (skip in continuous mode is correct — tips are verbose and not needed in live play).

**Files to change:**
- `lib/ai/analyze-hand.ts` — update continuous mode instruction string
- `lib/ai/schema.ts` — update `concept` describe string

**Expected result:** `concept` populated in ~95%+ of records (vs 35% today).

---

## Fix 3 — Sanitize Stack and Pot Outliers

### Problem

`potSize` and `heroStack` are required `z.string()` fields read entirely by Claude Vision OCR. No validation or clamping exists. This produces garbage values (€4627 stack, €125 pot on a NL10/NL20 table).

### Fix

Add `sanitizeAmount()` helper and call it in the API route's post-processing block before saving the record.

**New helper in `app/api/analyze/route.ts`** (or extract to `lib/ai/sanitize.ts` if preferred):

```ts
/** Replace obvious OCR outliers with "[misread]" */
function sanitizeAmount(value: string, maxReasonable: number): string {
  const num = parseFloat(value.replace(/[€$£, ]/g, ""));
  if (!isNaN(num) && num > maxReasonable) return "[misread]";
  return value;
}
```

Call it in the post-stream block:
```ts
analysis = {
  ...analysis,
  potSize: sanitizeAmount(analysis.potSize, 500),    // > €500 = misread
  heroStack: sanitizeAmount(analysis.heroStack, 2000), // > €2000 = misread
};
```

Bounds rationale:
- €500 pot: reasonable upper bound for NL50/NL100; a €125 pot at NL10 is 25 buy-ins — impossible
- €2000 stack: covers up to NL200 200BB deep; €4627 is clearly a misread at any micro/small stake

**Files to change:**
- `app/api/analyze/route.ts` — add `sanitizeAmount()` and apply to `potSize` and `heroStack` in post-processing block

**Note:** The live streaming analysis shown to the user is unaffected. Sanitization only applies to the stored `HandRecord`. If the AI displayed a wrong stack, that's a separate (acceptable) issue — the stored data accuracy is the goal here.

---

## Fix 4 — Seed Table Temperature from AI Opponent Classifications

### Problem

`deriveTableTemperature()` requires `MIN_READS = 3` non-UNKNOWN classified opponents. Opponent profiles in `sessionStorage` are updated by `updateOpponentProfiles(analysis.opponents)` after each hand — but temperature is derived at PREFLOP start, before the current hand's analysis completes. At the start of a session, most opponents are still `UNKNOWN` because only a few hands have been played.

The result: `tableTemperature` is `"unknown"` in 35.9% of records even when opponents are present, and `null` in another ~17% (manual captures or first-of-session captures without a `captureContext`).

### Fix

**Lower `MIN_READS` from 3 to 2** in `lib/poker/table-temperature.ts`:

```ts
const MIN_READS = 2; // Was 3 — 2 classified opponents is enough for a useful signal
```

Rationale: With 5-6 players at the table and Claude classifying all opponents per hand, we reach 2 classified opponents very quickly (often within the first hand if 2+ players show action). A temperature from 2 reads is a useful prior — it will self-correct as more data accumulates. We already store `tableReads` in the record so downstream analysis can weight low-read temperatures accordingly.

**Additionally — persist session to localStorage, not sessionStorage** in `lib/storage/sessions.ts`:

```ts
const SESSION_KEY = "poker-session";

// Change: sessionStorage → localStorage
// Reason: sessionStorage is cleared when the browser tab closes.
// If the user reloads the page mid-session (e.g., after extension reconnects),
// all accumulated opponent classifications are lost, resetting temperature to unknown.
```

Change all `sessionStorage` references to `localStorage` in `sessions.ts`. Add a TTL check so stale sessions (> 8 hours old) are discarded:

```ts
function getSession(): PokerSession {
  const raw = localStorage.getItem(SESSION_KEY);
  if (raw) {
    const session = JSON.parse(raw) as PokerSession;
    const ageHours = (Date.now() - session.startedAt) / 3_600_000;
    if (ageHours < 8) return session; // Still valid
  }
  // Stale or missing — start fresh
  const session = createSession();
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}
```

**Files to change:**
- `lib/poker/table-temperature.ts` — change `MIN_READS` from 3 to 2
- `lib/storage/sessions.ts` — change `sessionStorage` → `localStorage` with 8-hour TTL guard

---

## Implementation Order

All four fixes are independent and can be done in sequence or parallel. Suggested order (easiest → most impactful):

1. **Fix 2** (concept) — 2-line change, immediate data quality win
2. **Fix 3** (sanitize outliers) — small helper, prevents corrupted data
3. **Fix 1** (card enforcement) — most impactful, requires understanding CardMatch types
4. **Fix 4** (temperature seeding) — touches session storage persistence logic

---

## Acceptance Criteria

- [ ] `scripts/analyze-hands.ts` run on new captures shows `concept` empty < 10% of records (was 65%)
- [ ] No `heroCards` entries with 3+ tokens where first token was a detected card (Claude no longer adds undetected cards)
- [ ] No `potSize` or `heroStack` values exceeding `€500` / `€2000` respectively in stored records
- [ ] `tableTemperature` `"unknown"` rate drops below 20% (was 35.9%) in sessions with 2+ hands played
- [ ] `tableTemperature` `null` rate drops (sessions survive page reload)
- [ ] All existing tests pass (`bun test lib/poker/__tests__/`)

---

## References

- Root cause analysis: `lib/ai/analyze-hand.ts:47` (skip concept instruction)
- Schema definitions: `lib/ai/schema.ts:51-62` (heroCards, communityCards describe)
- Post-stream save: `app/api/analyze/route.ts:107-134` (where enforcement goes)
- Temperature logic: `lib/poker/table-temperature.ts` (MIN_READS constant)
- Session storage: `lib/storage/sessions.ts` (sessionStorage → localStorage migration)
- Institutional learnings:
  - `docs/solutions/logic-errors/ai-card-position-hallucination.md` (schema describe overrides system prompt)
  - `docs/solutions/implementation-patterns/persona-auto-selection-table-temperature.md` (MIN_READS rationale)
