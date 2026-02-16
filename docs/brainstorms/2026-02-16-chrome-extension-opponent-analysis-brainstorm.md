# Chrome Extension + Opponent Analysis

**Date:** 2026-02-16
**Status:** Ready for planning

## What We're Building

A Chrome extension that captures the poker table on a hotkey and sends it to the existing poker assistant web app. The web app (on a second monitor) shows enhanced analysis that includes opponent reads and exploit-adjusted recommendations. Opponent profiles are tracked across hands within a session.

**User flow:**
1. Playing poker in browser tab on primary monitor
2. Web app open on second monitor
3. Press hotkey → extension captures poker tab screenshot
4. Analysis appears on second monitor within ~3 seconds
5. Shows: recommended action + opponent reads + exploit reasoning
6. Opponent profiles build up across hands in the session

## Why This Approach

**Two problems, one solution:** The user wants (a) less friction while playing and (b) smarter analysis that adapts to opponents. A thin extension solves capture friction, and enhanced AI analysis solves the intelligence gap — both ship together.

**Extension stays thin:** The extension only captures and sends. All AI logic, opponent tracking, and UI live in the existing web app. This keeps the extension simple to build and maintain.

**Session-only persistence:** Opponent tracking resets when the tab closes. No database needed yet — just in-memory state in the web app. This avoids the Supabase auth/DB scope while still delivering value.

## Key Decisions

1. **Chrome extension captures, web app analyzes.** Extension is a thin capture layer. No AI or UI logic in the extension itself.

2. **Hotkey-triggered capture, not continuous.** User presses a key when they want advice. No auto-detection of "your turn" — that would require parsing the DOM of the poker site, which is fragile.

3. **Opponent data extracted from every screenshot.** The AI schema expands to include all visible players: positions, stack sizes, bet amounts, and inferred player type (tight/loose, passive/aggressive).

4. **Exploit suggestions in recommendations.** The AI advice adapts to opponent tendencies. "RAISE because villain has been playing passively" rather than generic GTO reasoning.

5. **Session-only opponent tracking.** Player profiles accumulate in React state (web app) across hands within a browser session. No persistence to localStorage or DB.

6. **Communication via existing API.** Extension POSTs base64 to `/api/analyze` (with CORS headers added). Web app receives results through existing streaming flow — but triggered from extension instead of paste.

## Architecture Sketch

```
[Poker Tab]                    [Second Monitor - Web App]
     |                                    |
     | hotkey press                       |
     v                                   |
[Chrome Extension]                        |
     | capture tab screenshot             |
     | POST base64 to /api/analyze        |
     |------------------------------------+
                                          v
                                  [API Route]
                                  [Claude Vision]
                                  [Enhanced Schema]
                                          |
                                          v
                                  [Web App UI]
                                  - Action recommendation
                                  - Opponent reads
                                  - Exploit reasoning
                                  - Session opponent profiles
```

## Scope

### Chrome Extension (new project)
- Manifest V3
- Background service worker listens for hotkey
- `chrome.tabs.captureVisibleTab()` to screenshot
- Send base64 to web app API
- Minimal popup for connection status

### Web App Changes
- Add CORS headers to `/api/analyze`
- Expand AI schema: opponent positions, stacks, bets, player types
- Expand system prompt: multi-player reads, exploit-adjusted advice
- New component: opponent profiles sidebar
- Session state for tracking opponents across hands
- New input mode: receive from extension (in addition to paste)

### NOT in scope
- Auto-detection of poker tables or "your turn"
- DOM scraping of poker sites
- Persistent opponent database (Supabase)
- Mobile support
- Multiple poker site tabs simultaneously

## Open Questions

1. **Extension ↔ Web App communication:** POST to API? Or use `chrome.runtime.sendMessage` to a connected web app tab? API approach is simpler and works cross-origin.

2. **Opponent identification across hands:** How do we match "seat 3" across screenshots? By position? Username if visible? This affects tracking accuracy.

3. **Multiple tables:** Should the extension support capturing from multiple poker tables? Or single-table only for MVP?

## Next Steps

Run `/workflows:plan` to create implementation plan.
