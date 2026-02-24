---
id: "preflop-fast-path-silent-record-omission"
type: "logic-error"
category: "hand-tracking"
module: "autopilot-preflop-fast-path"
severity: "high"
date: "2026-02-24"

tags:
  - "hand-recording"
  - "data-loss"
  - "preflop"
  - "persona-charts"
  - "control-flow"
  - "unreachable-code"
  - "fire-and-forget"

affected-files:
  - "extension/src/poker-content.ts"
  - "lib/storage/hand-records.ts"
  - "app/api/record/route.ts"
  - "extension/src/background.ts"

symptoms:
  - "Zero preflop hand records in data/hands/ despite SAVE_HANDS=true and autopilot active"
  - "Post-flop hands saved correctly — loss is preflop-only"
  - "Browser console shows persona chart firing (Preflop chart: GTO Raise) but no JSON file written"
  - "No console errors, no 404s, no network failures — silent data loss"

related:
  - "docs/solutions/logic-errors/preflop-race-conditions-fast-path-20260224.md"
  - "docs/solutions/logic-errors/preflop-prefetch-overwrites-fast-path-20260224.md"
  - "docs/solutions/browser-extension/content-script-fetch-localhost-blocked.md"
  - "docs/solutions/implementation-patterns/hand-session-context-pipeline-wiring-20260224.md"
---

# Preflop Fast-Path: Silent Hand Record Omission

## Problem

The preflop fast-path in `poker-content.ts` executed persona chart decisions and immediately
`return`ed — bypassing Claude entirely. Because hand record save logic lived *after* the
Claude streaming call, **every preflop decision was silently dropped**. Post-flop hands saved
correctly via the Claude path; preflop hands produced zero records.

## Root Cause

```
processGameState():

  ① Fast-path fires (persona chart available, no community cards, hero's turn)
      safeExecuteAction({ action, amount, reasoning }, "local")
      return  ← exits immediately

  ② Dead code below — never reached:
      [Claude API call]
      [On stream complete → writeHandRecord(...)]
```

The control flow was designed for a single serial path (execute → analyze → save). The fast
path optimized away the Claude call but accidentally also optimized away the save.

## Fix

Four files changed to decouple persistence from the Claude path:

### 1. `lib/storage/hand-records.ts` — Make imageBuffer optional

Preflop fast-path records have no screenshot. The write function must handle both:

```ts
export async function writeHandRecord(
  record: HandRecord,
  imageBuffer?: Buffer,   // optional — preflop records skip the PNG
): Promise<void> {
  const date = record.timestamp.slice(0, 10);
  const dir = join(process.cwd(), "data/hands", date);
  await mkdir(dir, { recursive: true });

  const writes: Promise<void>[] = [
    writeFile(join(dir, `${record.id}.json`), JSON.stringify(record, null, 2)),
  ];
  if (imageBuffer && imageBuffer.length > 0) {
    writes.push(writeFile(join(dir, `${record.id}.png`), imageBuffer));
  }
  await Promise.all(writes);
}
```

### 2. `app/api/record/route.ts` — New lightweight endpoint

Accepts the preflop fast-path payload and writes a `HandRecord` without a screenshot:

```ts
export async function POST(req: Request) {
  if (process.env.SAVE_HANDS !== "true") return Response.json({ ok: true });

  const parsed = requestSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });

  const analysis: HandAnalysis = {
    cardReadingNotes: "Cards from DOM — ground truth (SVG filename parsing)",
    heroCards: data.heroCards.join(" "),
    communityCards: "",
    heroPosition: data.position,
    street: "PREFLOP",
    action: data.action,
    confidence: "HIGH",      // deterministic chart lookup
    reasoning: data.reasoning,
    concept: "Preflop Chart",
    // ...
  };

  const record: HandRecord = {
    screenshotFile: "",      // no image for fast-path
    systemPromptVariant: "with-detected-cards",
    // ... rest of fields
  };

  try {
    await writeHandRecord(record);  // no imageBuffer argument
    console.log(`[record] Saved preflop hand ${handId}`);
  } catch (err) {
    console.warn("[record] Failed:", err);  // log but never throw — must not block poker tab
  }

  return Response.json({ ok: true });  // always 200
}
```

Key design choices:
- **Always returns 200** — errors are logged, never rethrown. The poker tab cannot wait on file I/O.
- **`SAVE_HANDS` gating** — same opt-in env var as the analyze route.
- **`screenshotFile: ""`** — explicit empty string; no PNG is expected or written.
- **`concept: "Preflop Chart"`** — distinguishes fast-path records from Claude decisions.

### 3. `extension/src/background.ts` — PREFLOP_RECORD handler

```ts
const RECORD_API_URL = "http://localhost:3006/api/record";

// In onMessage listener — mirrors LOCAL_DECISION pattern:
if (message.type === "PREFLOP_RECORD") {
  fetch(RECORD_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message.payload),
  }).catch((err) => {
    console.warn("[BG] PREFLOP_RECORD failed (server may be off):", err);
  });
  return;  // do NOT await — fire-and-forget
}
```

### 4. `extension/src/poker-content.ts` — Send PREFLOP_RECORD before return

```ts
safeExecuteAction({ action: personaAction, amount: preflopAmount, reasoning }, "local");

// Fire persistence BEFORE the return — chrome.runtime.sendMessage queues
// to the browser event loop and is NOT cancelled by the subsequent return.
{
  const activePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);
  const rawPos = getPosition(state.heroSeat, state.dealerSeat, activePlayers.length);
  const pos = rawPos === "??" ? "CO" : rawPos === "BTN/SB" ? "BTN" : rawPos;
  const heroPlayer = state.players.find((p) => p.seat === state.heroSeat);
  chrome.runtime.sendMessage({
    type: "PREFLOP_RECORD",
    payload: {
      heroCards: state.heroCards,        // DOM-scraped — 100% accurate
      position: pos,
      potSize: state.pot ?? null,
      heroStack: heroPlayer?.stack ?? null,
      action: personaAction,
      amount: preflopAmount,
      reasoning,
      personaName: lastPersonaRec.name,
      handContext: handMessages[0]?.content ?? null,
      pokerHandId: state.handId ?? null,
      tableTemperature: lastTableTemperature ?? null,
      tableReads: null,
    },
  });
}

lastHeroTurn = state.isHeroTurn;
lastState = state;
return;  // safe — PREFLOP_RECORD is already queued
```

## Data Flow

```
poker-content.ts (hero's turn, preflop, persona chart fires)
  ↓ safeExecuteAction()
  ↓ chrome.runtime.sendMessage({ type: "PREFLOP_RECORD", payload })
  ↓ return

background.ts (onMessage)
  ↓ fetch(RECORD_API_URL, { method: "POST", body: payload })

app/api/record/route.ts
  ↓ Zod validation
  ↓ construct HandAnalysis + HandRecord
  ↓ writeHandRecord(record)   ← no imageBuffer

data/hands/{YYYY-MM-DD}/{handId}.json  ✓
```

## Key Mental Model: Early Returns Don't Cancel Queued Messages

```ts
chrome.runtime.sendMessage({ ... })  // queued to browser event loop ✓
return                                // exits function — does NOT cancel the queued message
```

The `return` exits `processGameState()` but the `PREFLOP_RECORD` message is already in the
browser's async queue and will be delivered to `background.ts`'s `onMessage.addListener`
regardless. This is the architectural reason the fix works.

## Prevention Checklist for Future Fast Paths

When adding any early return / fast path in `poker-content.ts`:

- [ ] **Fire persistence message BEFORE any `return`** — the message is queued to the event loop; the return does not cancel it
- [ ] **Build payload from current state** — do not defer; state can change before any later save point
- [ ] **Set guard flags BEFORE `safeExecuteAction()`** — prevents stale async responses from overwriting the fast-path decision
- [ ] **Background handler must NOT `await` the fetch** — fire-and-forget; the poker tab must not block
- [ ] **API endpoint always returns 200** — file I/O errors are logged, never propagated to the extension
- [ ] **Test with `SAVE_HANDS=true`** — verify JSON records appear in `data/hands/` after fast-path fires
- [ ] **Simulate server-off** — stop Next.js, play a hand, confirm the poker tab still plays normally (`.catch()` handles the failure)

## DOM Cards Are Ground Truth

Preflop fast-path records use `state.heroCards` directly — DOM-scraped SVG filenames from
the poker client. These are 100% accurate. **Never replace this with image detection or
Claude OCR for hero cards.** See MEMORY.md: "Always use DOM cards as ground truth."

## Verification

```bash
# 1. Set env var
echo "SAVE_HANDS=true" >> .env.local

# 2. Trigger a preflop fast-path hand (autopilot on, RFI spot)
# 3. Check records
ls data/hands/$(date +%Y-%m-%d)/

# 4. Verify preflop record fields
cat data/hands/$(date +%Y-%m-%d)/*.json | jq '{street, concept, heroCards: .analysis.heroCards, action: .analysis.action, screenshotFile}'
# Expected: street "PREFLOP", concept "Preflop Chart", heroCards populated, screenshotFile ""
```
