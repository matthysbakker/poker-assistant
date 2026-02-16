---
title: "feat: Chrome Extension + Opponent Analysis"
type: feat
date: 2026-02-16
---

# Chrome Extension + Opponent Analysis

## Overview

Add a Chrome extension that captures the poker table on a hotkey and sends it to the web app API, plus expand the AI analysis to read all visible opponents and give exploit-adjusted recommendations. Opponent profiles accumulate in session state across hands.

**User flow:** Playing poker in browser → press hotkey → analysis appears on second monitor with action recommendation, opponent reads, and exploit reasoning.

## Problem Statement

Two friction points in the current MVP:

1. **Manual screenshotting breaks flow.** Taking a screenshot, switching to the web app, and pasting requires too many steps while actively playing.
2. **Analysis ignores opponents.** The AI only looks at hero's cards and board. It gives generic GTO-ish advice without considering who you're playing against — which is where most edge comes from at beginner/intermediate stakes.

## Proposed Solution

### Chrome Extension (new project)
A thin Manifest V3 extension. Hotkey → `captureVisibleTab()` → POST base64 to web app API. No AI logic in the extension itself.

### Enhanced AI Analysis (web app changes)
Expand the schema and prompt so Claude reads all visible players from the screenshot: their positions, stack sizes, bet actions, and inferred player type. Recommendations incorporate exploit reasoning.

### Session Opponent Tracking (web app state)
Track opponent profiles across hands within a browser session using `sessionStorage` (survives refresh, clears on tab close). The AI receives accumulated opponent context for each new hand.

## Technical Approach

### Architecture

```
[Poker Tab]                         [Second Monitor - Web App]
     |                                        |
     | Ctrl+Shift+P                           |
     v                                        |
[Chrome Extension]                            |
     | captureVisibleTab()                    |
     | POST /api/analyze                      |
     | { image, sessionId }                   |
     |----------------------------------------+
                                              v
                                      [API Route]
                                      [Claude Vision]
                                      [Expanded Schema]
                                              |
                                              v
                                      [Web App UI]
                                      - Recommendation
                                      - Opponent table
                                      - Exploit reasoning
                                      - Session profiles
```

### Key Technical Decisions

**Extension ↔ Web App communication:** Direct POST to `/api/analyze`. Simpler than `chrome.runtime.sendMessage` — works cross-origin, no need for the web app to register as extension listener. Extension handles the streaming response to know when analysis is complete, but the web app independently polls/listens for new results.

**Actually, simpler:** The extension doesn't need to parse the streaming response at all. Instead:
1. Extension POSTs image to a new `/api/capture` endpoint that stores the image temporarily
2. Web app polls or uses SSE to detect new captures
3. Web app submits to `/api/analyze` as usual

**Even simpler:** Extension sends image directly to the web app tab via `chrome.tabs.sendMessage()` / content script injection. The web app treats it exactly like a paste. No CORS needed, no new endpoints.

**Decision: Use `BroadcastChannel` API.**
- Extension's content script (injected into web app tab) posts the captured image via `BroadcastChannel`
- Web app listens on the same channel
- No CORS, no new API endpoints, no polling
- Works because both extension content script and web app share the same origin

**Opponent identification:** By seat position (1-9). Simplest and most reliable — positions are visually stable in a screenshot. Username is extracted when visible but used as a label, not for matching.

**Session boundary:** `sessionStorage` — survives page refresh, clears when tab closes. Natural fit for a poker session.

**Hotkey:** Configurable via Chrome `commands` API. Default: `Ctrl+Shift+P` (or `Command+Shift+P` on Mac).

**Screenshot compression:** Extension captures as JPEG at 85% quality via `captureVisibleTab({ format: 'jpeg', quality: 85 })`. No additional resize needed — Claude handles full-resolution screenshots well.

### Implementation Phases

#### Phase 1: Enhanced AI Analysis (Web App Only)

Expand the schema and prompt to analyze opponents. Test with existing paste flow — no extension needed yet.

**Files to create:**

| File | Purpose |
|------|---------|
| `lib/storage/sessions.ts` | Session management: `getSession()`, `updateOpponentProfiles()`, `getOpponentContext()` |
| `components/analyzer/OpponentTable.tsx` | Table showing opponent positions, stacks, actions, and inferred types |

**Files to modify:**

| File | Change |
|------|--------|
| `lib/ai/schema.ts` | Add `opponents` array and `exploitAnalysis` field |
| `lib/ai/system-prompt.ts` | Add multi-player parsing instructions and exploit reasoning |
| `lib/ai/analyze-hand.ts` | Accept optional session context (opponent history), inject into prompt |
| `app/api/analyze/route.ts` | Accept optional `sessionId` + `opponentHistory` in request body |
| `components/analyzer/AnalysisResult.tsx` | Display opponent table and exploit analysis, update session after each hand |
| `app/page.tsx` | Manage session state, pass opponent context to analysis |

**Expanded schema:**

```typescript
// lib/ai/schema.ts

const opponentSchema = z.object({
  seat: z.number().describe("Seat number (1-9)"),
  username: z.string().optional().describe("Player username if visible"),
  position: z.enum(["UTG", "MP", "CO", "BTN", "SB", "BB"]).optional(),
  stack: z.string().describe("Stack size, e.g. '95 BB' or '$190'"),
  currentAction: z.string().optional()
    .describe("Action this hand if visible, e.g. 'RAISE 3BB', 'FOLD'"),
  playerType: z.enum([
    "TIGHT_PASSIVE", "TIGHT_AGGRESSIVE",
    "LOOSE_PASSIVE", "LOOSE_AGGRESSIVE",
    "UNKNOWN"
  ]).describe("Inferred player type based on visible information"),
  notes: z.string().optional()
    .describe("Brief read on this player based on visible clues"),
});

export const handAnalysisSchema = z.object({
  // ... existing hero fields unchanged ...

  opponents: z.array(opponentSchema)
    .describe("All visible opponents at the table"),
  exploitAnalysis: z.string()
    .describe("How the recommendation exploits specific opponent tendencies at this table"),

  // ... existing recommendation + teaching fields unchanged ...
});
```

**Session data shape:**

```typescript
// lib/storage/sessions.ts

interface OpponentProfile {
  seat: number;
  username?: string;
  handsObserved: number;
  actions: string[];        // history of observed actions
  inferredType: string;     // most recent AI assessment
  averageStack: string;
}

interface PokerSession {
  id: string;
  startedAt: number;
  handCount: number;
  opponents: Record<number, OpponentProfile>; // keyed by seat number
}
```

**Success criteria:** Paste a screenshot → analysis includes opponent reads and exploit reasoning. Paste another → opponent profiles accumulate.

#### Phase 2: Chrome Extension

Build the extension as a separate directory within the repo. Uses `BroadcastChannel` to send captured images to the web app.

**Files to create:**

| File | Purpose |
|------|---------|
| `extension/manifest.json` | Manifest V3 config: permissions, commands, content scripts |
| `extension/background.ts` | Service worker: listens for hotkey, captures tab, sends to content script |
| `extension/content.ts` | Content script (injected into web app): receives image, posts via BroadcastChannel |
| `extension/popup.html` | Minimal popup: connection status, hotkey reminder |
| `extension/popup.ts` | Popup logic |
| `extension/icons/` | Extension icons (16, 48, 128px) |

**Files to modify:**

| File | Change |
|------|--------|
| `app/page.tsx` | Add `BroadcastChannel` listener for incoming extension captures |
| `components/analyzer/PasteZone.tsx` | Support "extension mode" — hide paste UI when image arrives from extension |

**Extension architecture:**

```
manifest.json
├── permissions: ["activeTab", "tabs"]
├── commands: { "capture-hand": { "suggested_key": "Ctrl+Shift+P" } }
├── background: { service_worker: "background.js" }
├── content_scripts: [{ matches: ["http://localhost:3000/*", "https://your-app.vercel.app/*"] }]
└── action: { default_popup: "popup.html" }
```

**Capture flow:**

```typescript
// background.ts
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-hand") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "jpeg",
    quality: 85,
  });

  // Send to content script running in the web app tab
  const webAppTabs = await chrome.tabs.query({
    url: ["http://localhost:3000/*", "https://your-app.vercel.app/*"],
  });

  if (webAppTabs.length > 0) {
    chrome.tabs.sendMessage(webAppTabs[0].id!, {
      type: "POKER_CAPTURE",
      image: dataUrl.split(",")[1], // strip data URL prefix
    });
  }
});
```

```typescript
// content.ts (runs in web app tab)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "POKER_CAPTURE") {
    const channel = new BroadcastChannel("poker-assistant");
    channel.postMessage({ type: "CAPTURE", image: message.image });
    channel.close();
  }
});
```

```typescript
// app/page.tsx (web app)
useEffect(() => {
  const channel = new BroadcastChannel("poker-assistant");
  channel.onmessage = (event) => {
    if (event.data.type === "CAPTURE") {
      setImageBase64(event.data.image);
    }
  };
  return () => channel.close();
}, []);
```

**Success criteria:** Press hotkey while on poker tab → analysis appears on web app on second monitor. No paste needed.

#### Phase 3: Polish

- Extension popup shows last capture timestamp and connection status
- Hotkey visual confirmation (brief badge flash on extension icon)
- Debounce hotkey (ignore if pressed within 3s of last capture)
- Error notification if no web app tab is found
- "Start new session" button in web app to reset opponent profiles

### Not in Scope

- Auto-detection of poker tables or "your turn to act"
- DOM scraping of poker site markup
- Persistent opponent database (Supabase)
- Multiple simultaneous poker tables
- Mobile support
- Authentication / rate limiting
- Publishing extension to Chrome Web Store

## Acceptance Criteria

### Functional Requirements

- [ ] AI analysis extracts all visible opponents (position, stack, action, player type)
- [ ] Exploit reasoning adapts to opponent tendencies
- [ ] Opponent profiles accumulate across hands within a session
- [ ] Session context is passed to AI for subsequent hands
- [ ] Chrome extension captures active tab on hotkey press
- [ ] Captured screenshot appears in web app without manual paste
- [ ] Analysis streams normally after extension capture
- [ ] Session persists across page refresh (sessionStorage)
- [ ] Session clears when web app tab is closed
- [ ] Existing paste flow continues to work (extension is optional)

### Non-Functional Requirements

- [ ] Capture → first analysis token < 5 seconds
- [ ] Extension < 1MB total size
- [ ] No new npm dependencies in web app
- [ ] No new npm dependencies in extension (vanilla TS)

## Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude can't reliably read opponent data from screenshots | High | Test with 5+ poker sites before building extension. Fall back to hero-only if opponent parsing is poor. |
| BroadcastChannel not supported in older browsers | Low | 96%+ browser support. Extension users are on modern Chrome by definition. |
| Expanded schema increases response time | Medium | Opponent data streams alongside hero data. Measure latency impact. |
| `captureVisibleTab` returns blank for minimized tabs | Medium | Document: "poker tab must be visible". Extension shows error if image is mostly blank. |

## References

### Internal
- Brainstorm: `docs/brainstorms/2026-02-16-chrome-extension-opponent-analysis-brainstorm.md`
- AI SDK streaming pattern: `docs/solutions/implementation-patterns/ai-sdk-v6-streaming-structured-output.md`
- useEffect dependency gotcha: `docs/solutions/react-hooks/useeffect-object-dependency-infinite-loop.md` (AIssesment project)

### External
- [Chrome Extensions Manifest V3](https://developer.chrome.com/docs/extensions/develop)
- [chrome.tabs.captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab)
- [BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
- [Chrome Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands)
