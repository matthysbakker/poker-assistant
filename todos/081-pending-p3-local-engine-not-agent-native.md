---
status: pending
priority: p3
issue_id: "081"
tags: [code-review, agent-native, local-engine, observability]
dependencies: []
---

# Local Engine Decision Path Opaque — No `DECISION_MADE` Message to Web App

## Problem Statement

When `localDecide()` produces a decision (action, confidence, reasoning), the result is sent directly to the poker tab as `AUTOPILOT_ACTION` but is never forwarded to the web app (localhost:3006). This means the web app UI cannot display what the local engine decided, cannot log decisions to hand history, and an AI agent querying the web app cannot observe decisions or provide oversight.

## Findings

- `localDecide()` in `poker-content.ts` calls `chrome.runtime.sendMessage({ type: "AUTOPILOT_ACTION", action })` to background
- Background forwards to poker tab only
- Web app (and by extension, any agent using the web app) has no visibility into local engine decisions
- Contrast: Claude API decisions flow back through `CLAUDE_ADVICE` → web app → poker content script (bidirectional)
- Review agent: agent-native-reviewer
- This is also useful for debugging — the overlay shows nothing when the local engine acts

## Proposed Solutions

### Option 1: Emit `LOCAL_DECISION_MADE` Message to Background (Recommended)

**Approach:** After `localDecide()` produces a result, send a separate message to background that forwards to the web app tab.

```typescript
// In poker-content.ts after localDecide():
chrome.runtime.sendMessage({
  type: "LOCAL_DECISION_MADE",
  action: decision.action,
  amount: decision.amount,
  confidence: decision.confidence,
  reasoning: decision.reasoning,
  opponentType,
  handsObserved,
});
```

Background forwards this to `webAppTabId`. Web app can display/log it.

**Pros:**
- Web app + agents get full decision visibility
- Minimal: one extra message, no changes to casino interaction
- Enables overlay display of local engine decisions

**Cons:**
- Background needs a new message handler
- Web app needs a new listener

**Effort:** 2 hours
**Risk:** Low

---

### Option 2: Write to Console Only (Not Agent-Native)

**Approach:** Log `localDecide()` result to console with a structured JSON line.

**Pros:** Trivial

**Cons:** Not observable by agents or the web app UI

**Effort:** 15 minutes
**Risk:** Low (but doesn't solve the agent-native problem)

## Technical Details

**Affected files:**
- `extension/src/poker-content.ts` — after `localDecide()` call
- `extension/src/background.ts` — new `LOCAL_DECISION_MADE` handler
- `extension/src/content.ts` — forward to page if needed
- Web app: new message listener (future PR)

## Resources

- **PR:** feat/local-poker-decision-engine (PR #11)
- **Review agent:** agent-native-reviewer

## Acceptance Criteria

- [ ] Each local engine decision produces a `LOCAL_DECISION_MADE` message visible to the web app
- [ ] Web app can log or display the decision (even if UI is minimal)
- [ ] `bun run build:extension` passes

## Work Log

### 2026-02-24 — Discovered in Code Review

**By:** Claude Code (review workflow)
