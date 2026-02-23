---
status: pending
priority: p2
issue_id: "056"
tags: [code-review, extension, overlay, stale-state, personas]
dependencies: [050]
---

# lastPersonaRec Not Cleared on New Hand Start in Content Script

## Problem Statement

`lastPersonaRec` in `poker-content.ts` is cleared only when autopilot mode is set to "off" (inside `updateOverlay` at line 701). It is not cleared when `currentHandId` changes — i.e., when a new hand starts. If a `PERSONA_RECOMMENDATION` is not received for a new hand (either due to the broken IPC channel from todo 050, or any timing issue), the prior hand's persona recommendation persists in the overlay for the new hand.

The new-hand block in `processGameState()` (around line 801) resets `executing`, `handMessages`, `lastHeroTurn`, and `streetActions` — but not `lastPersonaRec`. This means a player folding on the prior hand with "Exploit Hawk → RAISE [tight-passive]" will see that stale recommendation for the next hand's preflop until a new recommendation arrives (or never arrives).

## Findings

- `extension/src/poker-content.ts:801-815` (approximately) — new-hand detection block resets multiple state vars but not `lastPersonaRec`
- `extension/src/poker-content.ts:698-703` — `lastPersonaRec = null` only called when `autopilotMode === "off"`
- Architecture review (2026-02-23): rated P3
- Security review (2026-02-23): rated S8 (LOW)

**Current new-hand block (approximate):**
```typescript
// new hand detected
currentHandId = newHandId;
executing = false;
handMessages = [];
lastHeroTurn = false;
streetActions = [];
// ← lastPersonaRec NOT cleared here
```

## Proposed Solutions

### Option A: Clear lastPersonaRec in new-hand detection block (Recommended)

```typescript
currentHandId = newHandId;
executing = false;
handMessages = [];
lastHeroTurn = false;
streetActions = [];
lastPersonaRec = null;  // <-- add this line
```

**Effort:** Add 1 line
**Risk:** None — the overlay shows `Persona: —` between hands until a new recommendation arrives, which is the correct behavior

### Option B: Clear lastPersonaRec at top of each PREFLOP detection

Instead of clearing on new-hand ID change, clear when community cards go from >0 to 0 (PREFLOP start). Same net effect.

**Effort:** Similar, less explicit
**Risk:** Slightly less obvious than clearing with the other reset vars

## Recommended Action

Option A. Add `lastPersonaRec = null` alongside the other resets in the new-hand block. This also applies regardless of whether todo 050 (broken IPC) is fixed — even when the channel works, there's a brief window between new-hand detection and the recommendation arriving.

## Technical Details

- **Affected files:** `extension/src/poker-content.ts`
- **Line:** New-hand detection block (~line 801)
- **Note:** This todo is partially blocked by 050 since if the IPC channel is broken, clearing stale state has no visible effect anyway. However, the fix is a 1-liner and worth doing independently.

## Acceptance Criteria

- [ ] `lastPersonaRec = null` added to new-hand detection reset block
- [ ] Overlay shows `Persona: —` briefly between hands before new recommendation arrives
- [ ] No other state vars affected

## Work Log

- 2026-02-23: Identified by architecture and security reviews of PR #8
