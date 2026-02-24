# Review: Agent-Native Architecture
**Date:** 2026-02-24
**Reviewed by:** Agent-Native Architecture Reviewer

---

## Summary

The poker assistant exposes six POST endpoints that are well-structured for programmatic use
(`/api/analyze`, `/api/detect`, `/api/record`, `/api/decision`, `/api/persona`, `/api/autopilot`).
All accept plain JSON and validate inputs with Zod. An external agent can call the analysis and
decision pipelines end-to-end.

However, three categories of functionality are entirely agent-inaccessible: (1) hand history is
split between browser localStorage and server-side JSON files with no read API for either, (2)
session/opponent context lives exclusively in localStorage and cannot be passed to the server
without the browser bridge, and (3) the continuous capture pipeline is extension-only — an agent
has no way to drive the state machine or subscribe to its output. The `/api/decision` endpoint
is a pure write-only telemetry sink that acknowledges but discards its payload, which is the only
place observability was intended.

Agent-native score: **4/9 capabilities are fully agent-accessible**.

---

## Capability Map

| UI Capability | Location | Agent API | Notes | Status |
|---|---|---|---|---|
| Analyze hand (screenshot) | `app/page.tsx:362` | `POST /api/analyze` | Works. Returns streaming JSON. | OK |
| Detect cards only | `app/page.tsx:131` (handleFrame) | `POST /api/detect` | Works. Returns JSON. | OK |
| Persona selection | `app/page.tsx:196` | `POST /api/persona` | Works. Returns JSON. | OK |
| Autopilot decision | Extension background | `POST /api/autopilot` | Works. Returns JSON. | OK |
| Record preflop decision | Extension/continuous | `POST /api/record` | Works (write). No read. | WRITE-ONLY |
| Read hand history (localStorage) | `HandHistory.tsx:21` | None | No GET endpoint exists. | MISSING |
| Delete hand from history | `HandHistory.tsx:24` | None | UI calls `deleteHand()` directly. | MISSING |
| Clear all history | `HandHistory.tsx:29` | None | UI calls `clearAllHands()` directly. | MISSING |
| Read disk hand records (`data/hands/`) | Server only | None | No GET endpoint exists. | MISSING |
| Read/query session + opponent context | `sessions.ts` | None | Pure localStorage — no API surface. | MISSING |
| Reset session | `app/page.tsx:158` | None | Calls `resetSession()` directly. | MISSING |
| Continuous capture state machine | `use-continuous-capture.ts` | None | Extension-only WebSocket/postMessage bridge. | MISSING |
| Drive/feed frame to state machine | `app/page.tsx:131` | None | Only reachable via extension `FRAME` message. | MISSING |
| Receive CLAUDE_ADVICE output | `app/page.tsx:168` | None | postMessage only — no SSE or webhook. | MISSING |
| Receive PERSONA_RECOMMENDATION | `app/page.tsx:205` | None | postMessage only — no SSE or webhook. | MISSING |

---

## Critical Issues (P1)

### 1. No read API for hand records — agent cannot query history

`lib/storage/hand-records.ts` writes JSON files to `data/hands/<date>/<id>.json` when
`SAVE_HANDS=true`. There is no GET endpoint to list, filter, or retrieve these records.
`lib/storage/hands.ts` maintains a parallel history in `localStorage` that is also not
accessible via any API.

An agent that wants to learn from past hands, check if a situation has occurred before, or
summarise session statistics has zero access to this data.

- **Location:** `lib/storage/hand-records.ts:86-101`, `lib/storage/hands.ts:12-22`
- **Impact:** Agent cannot reason over history. No way to answer "what have I played today?",
  "how often do I fold preflop from UTG?", or "show me hands where I was beaten by a set."
- **Fix:** Add `GET /api/hands` returning a paginated list of records from `data/hands/`, and
  optionally `GET /api/hands/[id]` for a single record. For the localStorage store, note that
  this is client-only by design — if history should be agent-queryable, it must migrate to the
  server-side file store (or Supabase once added).

### 2. `/api/decision` discards its payload — no state is persisted

`app/api/decision/route.ts:35-39` validates a decision object and then only `console.log`s it.
The endpoint returns `{ ok: true }` but stores nothing. The comment in the file says it enables
"observability and hand history logging" but the implementation does neither.

- **Location:** `app/api/decision/route.ts:34-39`
- **Impact:** Local engine decisions are invisible to everything except the server log.
  An agent (or a monitoring system) that POSTs a decision gets a success response but no record
  is written, no event is emitted, and no way to retrieve that decision later exists.
- **Fix:** Either write the decision to a `data/decisions/` record, or wire it into
  `writeHandRecord` the same way `/api/record` does. At minimum, the misleading comment in
  the JSDoc should be corrected.

### 3. Session / opponent context is fully locked in localStorage

`lib/storage/sessions.ts` stores the running opponent profile (`PokerSession`) in
`localStorage`. The analyze endpoint accepts `opponentHistory` as a POST body field, but the
only code that populates this field is the browser's `getOpponentContext()` call in
`app/page.tsx:58`. An external agent has no way to read the current session context, inject
an opponent history, or reset the session without going through the browser UI.

- **Location:** `lib/storage/sessions.ts:23-44`, `app/page.tsx:32,58`
- **Impact:** An agent calling `/api/analyze` will always produce weaker recommendations than
  the browser UI because it cannot supply the accumulated opponent history. After 20 hands the
  difference in recommendation quality is material.
- **Fix:** Expose `GET /api/session` to read current session state, and accept
  `opponentHistory` as a first-class documented parameter. The Zod schema in
  `app/api/analyze/route.ts:44-75` already accepts `opponentHistory` — the gap is only
  discovery: no documentation or agent-facing schema describes how to build it.

---

## Warnings (P2)

### 4. `POST /api/analyze` returns a streaming JSON object — format is undocumented

The analyze route returns `result.toTextStreamResponse()` (line 228). This is Vercel AI SDK's
streaming format: newline-delimited JSON tokens with a proprietary envelope. Nothing in the
codebase documents this format for callers other than the `useObject` React hook.

An external agent calling `POST /api/analyze` with `Content-Type: application/json` and
expecting `application/json` will receive an unexpected stream. The response schema
(`handAnalysisSchema`) is defined in `lib/ai/schema.ts` but not linked from the route file or
any README.

- **Location:** `app/api/analyze/route.ts:228`, `lib/ai/schema.ts:41-158`
- **Recommendation:** Document in a comment at the top of the route that the response is
  Vercel AI SDK `streamObject` format. Add an optional `?stream=false` query parameter (or a
  separate `POST /api/analyze/sync` route) that awaits the full object and returns plain JSON
  for non-streaming callers.

### 5. Model IDs are hardcoded to specific dated versions

`lib/ai/analyze-hand.ts:7-9` pins `claude-haiku-4-5-20251001` and `claude-sonnet-4-20250514`.
`app/api/autopilot/route.ts:36` also pins `claude-haiku-4-5-20251001`. Per the global CLAUDE.md
rule: "Prefer unversioned aliases when available."

- **Location:** `lib/ai/analyze-hand.ts:7-9`, `app/api/autopilot/route.ts:36`
- **Recommendation:** Prefer `claude-haiku-4-5` and `claude-sonnet-4` (unversioned aliases) or
  verify the latest stable model IDs via the Anthropic API before the next deployment.

### 6. Continuous capture pipeline has no agent entry point

The state machine in `lib/hand-tracking/state-machine.ts` is driven entirely by
`handleFrame()` calls originating from the Firefox extension's `postMessage`. No API endpoint
accepts a raw frame for processing by the state machine. An agent running in a non-browser
context (e.g., a server-side loop, a desktop automation script) cannot participate in continuous
mode at all.

- **Location:** `app/page.tsx:131`, `lib/hand-tracking/use-continuous-capture.ts`
- **Recommendation:** Consider a `POST /api/frame` endpoint that accepts a base64 image,
  feeds it through `detectCards` and the state machine, and returns the resulting `HandState`.
  This would make the continuous pipeline testable and agent-callable without requiring a
  browser extension.

### 7. `CLAUDE_ADVICE` and `PERSONA_RECOMMENDATION` outputs are postMessage-only

When Claude completes an analysis, the result is broadcast via `window.postMessage` on
`app/page.tsx:168-179`. The persona recommendation is similarly postMessage-only
(`app/page.tsx:205-215`). These are the primary outputs that drive the extension overlay.

An agent calling `/api/analyze` receives the full streaming analysis object — that is fine.
But if an agent wants to receive advice events in near-real-time without polling, there is no
SSE endpoint or webhook.

- **Location:** `app/page.tsx:164-180`, `app/page.tsx:203-217`
- **Recommendation:** For the current use case this is acceptable. Flag it only if a future
  agent needs to subscribe to live advice events rather than drive the analyze call itself.

---

## Observations (P3)

### 8. Tool design is mostly primitive — not workflow-encoded

The six POST endpoints are well-designed as primitives:
- `/api/detect` does one thing: run card detection on an image.
- `/api/persona` does one thing: look up a persona for given cards/position/temperature.
- `/api/autopilot` does one thing: ask Claude for a decision given a message list.
- `/api/analyze` does one thing: stream a full hand analysis.

This is correct. There is no business logic encoded in the tools that should live in the agent's
reasoning. The persona selection matrix in `persona-selector.ts` is a deliberate data-driven
lookup rather than encoded logic in the tool itself.

### 9. Zod schemas double as implicit documentation

The `requestSchema` objects in each route are the closest thing to API documentation that exists.
They are precise and machine-readable. Adding a `.describe()` to each top-level schema field
would allow auto-generation of documentation and help any agent introspecting the schema at
runtime.

- **Location:** All files in `app/api/*/route.ts`

### 10. `POST /api/record` is guarded by `SAVE_HANDS` env var

`app/api/record/route.ts:23-25` returns `{ ok: true }` immediately if `SAVE_HANDS !== "true"`.
This is intentional for production safety, but an agent calling this endpoint in a default
environment will silently succeed while no record is written. The response gives no indication
that writing was skipped.

- **Location:** `app/api/record/route.ts:23-25`
- **Recommendation:** Return `{ ok: true, saved: false, reason: "SAVE_HANDS not enabled" }`
  so callers know the record was not persisted.

---

## Recommendations (Priority Order)

1. **Add `GET /api/hands`** — paginated list of records from `data/hands/`. Include filters for
   date, street, action, and position. This unlocks history queries for agents and humans alike.
2. **Add `GET /api/hands/[id]`** — single record retrieval including the analysis JSON.
3. **Fix `/api/decision`** to actually persist the decision (write to disk or hand record),
   fulfilling its stated purpose.
4. **Add `GET /api/session`** — expose current session state (handCount, opponent profiles).
   This allows an agent to build the `opponentHistory` field when calling `/api/analyze`.
5. **Add response-format documentation** to `/api/analyze` and consider a `?stream=false` path
   for non-streaming callers.
6. **Add `{ saved: boolean }` to `/api/record` response** so callers know whether the env var
   guard fired.
7. **Switch model IDs to unversioned aliases** in `lib/ai/analyze-hand.ts` and
   `app/api/autopilot/route.ts`.

---

## What Is Working Well

- All write-path endpoints accept plain JSON and validate with Zod — an agent can call them
  without any browser context.
- `/api/persona` exposes `allPersonas` in the response, giving agents full visibility into
  alternatives, not just the selected one.
- The `opponentHistory` field in `/api/analyze` is a clean primitive: the agent supplies data,
  the tool does not make decisions about which opponents to include.
- Card detection (`/api/detect`) and full analysis (`/api/analyze`) are correctly separated,
  allowing an agent to run detection-only when speed matters and full analysis when depth matters.
- The `handContext` field in `/api/analyze` allows agents to supply multi-street context as a
  plain string, without needing to replicate the state machine.

---

## Agent-Native Score

- **4 / 9 primary capabilities are fully agent-accessible** (analyze, detect, persona, autopilot)
- **3 write-only** (record, decision — no read path; session — write via UI, no API)
- **2 completely inaccessible** (hand history read, continuous capture pipeline)

**Verdict: NEEDS WORK** — The write paths are solid. The read paths and history layer are the
critical gap. Fix P1 items to reach PASS.
