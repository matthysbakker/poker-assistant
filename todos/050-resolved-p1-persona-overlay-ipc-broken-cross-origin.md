---
status: pending
priority: p1
issue_id: "050"
tags: [code-review, architecture, extension, ipc, overlay, personas]
dependencies: []
---

# Persona Overlay IPC Channel Silently Broken (Cross-Origin postMessage)

## Problem Statement

The persona auto-selection feature's extension overlay is silently non-functional. `page.tsx` posts `PERSONA_RECOMMENDATION` via `window.postMessage(..., window.location.origin)`. The Next.js app runs on `localhost:3006`; the casino poker page runs on `https://casino.hollandcasino.nl`. These are different origins.

`window.postMessage(data, window.location.origin)` restricts delivery to the same origin as the caller — `localhost`. The browser silently discards messages for different-origin windows. No error is thrown. The content script at `poker-content.ts:145` never receives the event. Even if it did, the origin guard `event.origin !== window.location.origin` would block it (evaluates `"localhost:3006" !== "https://casino.hollandcasino.nl"`).

Result: the overlay permanently shows `Persona: —` with no indication of failure. The feature this PR introduces for the overlay is completely inoperative in the deployed architecture.

## Findings

- `app/page.tsx:134` — `window.postMessage({ ..., type: "PERSONA_RECOMMENDATION" }, window.location.origin)` — posts to localhost origin, unreachable from casino tab
- `extension/src/poker-content.ts:145-156` — listener at casino origin, never fires
- `extension/src/poker-content.ts:146` — `event.origin !== window.location.origin` would further block any delivered message
- Architecture review (2026-02-23): rated P1
- Solution doc `docs/solutions/implementation-patterns/persona-auto-selection-table-temperature.md:207` incorrectly states "postMessage (same origin) is the correct IPC mechanism"

## Proposed Solutions

### Option A: Background bridge pattern (Recommended)

Standard extension cross-tab messaging:
1. Add a `PERSONA_RECOMMENDATION` handler to `background.ts` that stores the latest recommendation
2. In `page.tsx`, replace `window.postMessage` with `window.postMessage` to the localhost content script (already injected on localhost), which relays via `chrome.runtime.sendMessage` to background
3. Background forwards to the registered poker tab via `chrome.tabs.sendMessage(pokerTabId, { type: "PERSONA_RECOMMENDATION", ... })`

**Effort:** Medium — adds one relay hop through background
**Risk:** Low — follows existing `AUTOPILOT_ACTION` pattern exactly

### Option B: Polling via background state

Content script polls background on each hero-turn detection for the latest persona recommendation. Background fetches or caches data from `page.tsx` relay.

**Effort:** Medium — requires polling logic
**Risk:** Adds latency and complexity

### Option C: Document overlay as localhost-only feature

If the intended use of the overlay is only when the app is embedded as an iframe (same-origin), document this explicitly. Add a comment to `page.tsx` and `poker-content.ts` explaining the deployment constraint. Accept that the overlay does not function in the separate-tab model.

**Effort:** Zero
**Risk:** Ongoing — the overlay persona line is permanently `Persona: —` in the standard deployment

### Option D: Remove persona line from overlay until IPC is fixed

Remove `personaHtml` from `updateOverlay` and remove the `PERSONA_RECOMMENDATION` listener from `poker-content.ts`. The feature still works in the web UI (`PersonaComparison`). Clean up after fixing the channel.

**Effort:** Small — remove ~20 lines
**Risk:** None

## Recommended Action

Option A if the extension overlay persona line is important. Option D if the overlay persona display can wait — it removes confusion and dead code until a proper background bridge is wired.

## Technical Details

- **Affected files:** `app/page.tsx`, `extension/src/poker-content.ts`, `extension/src/background.ts`
- **Root cause:** `window.postMessage` with same-origin restriction cannot cross tab boundaries to a different domain
- **Correct reference pattern:** `AUTOPILOT_ACTION` — background sends to poker tab via `chrome.tabs.sendMessage(pokerTabId, ...)`

## Acceptance Criteria

- [ ] Persona recommendation visible in extension overlay when autopilot monitor/play mode is active
- [ ] Overlay shows correct persona name + action at PREFLOP start
- [ ] Overlay clears persona between hands
- [ ] OR: overlay persona line removed and todo filed for future IPC implementation

## Work Log

- 2026-02-23: Identified by architecture-strategist review of PR #8
