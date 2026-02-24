# Review: feat/local-poker-decision-engine — Agent-Native Architecture
**Date:** 2026-02-24
**Branch:** feat/local-poker-decision-engine
**Reviewed by:** Agent-Native Architecture Reviewer

---

## Summary

The local decision engine (rule-tree + exploit layer) is almost entirely opaque to agents
and the web app. Seven distinct gaps prevent any external agent from observing or influencing
the decision process that now governs a large share of real-money actions. The engine
produces structured data — action, amount, confidence, reasoning string — but all of it is
consumed locally inside the extension content script and then discarded. Nothing is reported
back to the web app, no API endpoint exposes the engine inputs or outputs, and the exploit
constants are compile-time literals with no inspection surface.

---

## Capability Map

| Capability | UI / Extension | Agent Tool | Prompt Reference | Status |
|---|---|---|---|---|
| Trigger autopilot decision | Popup AUTOPILOT_SET_MODE | POST /api/autopilot (messages) | AUTOPILOT_SYSTEM_PROMPT | Partial — Claude path only |
| Read local engine decision | Console log only | None | None | MISSING |
| Read exploit adjustment output | Console log only | None | None | MISSING |
| Read confidence score | Console log only | None | None | MISSING |
| Read decision reasoning string | Console log only | None | None | MISSING |
| Read table temperature | Overlay (display only, not queryable) | None | None | MISSING |
| Query lastTableTemperature state | None anywhere | None | None | MISSING |
| Override opponentType | None anywhere | None | None | MISSING |
| Override CONFIDENCE_THRESHOLD | chrome.storage.local only (no API) | None | None | No API |
| Query exploit DELTAS constants | Source code only | None | None | MISSING |
| Query sampleConfidenceMultiplier | Source code only | None | None | MISSING |
| Persona selection | POST /api/persona | POST /api/persona | Indirect | OK |
| Claude fallback decision | POST /api/autopilot | POST /api/autopilot | AUTOPILOT_SYSTEM_PROMPT | OK |
| Card detection | POST /api/detect | POST /api/detect | Not in autopilot prompt | OK |
| Full screenshot analysis | POST /api/analyze | POST /api/analyze | N/A | OK |

---

## Critical Issues (Must Fix)

### 1. Local Engine Decisions Are Invisible to Agents and the Web App

**Location:** extension/src/poker-content.ts lines 1258-1274

The local engine path calls localDecide() and immediately calls safeExecuteAction(). The
result — including action, amount, confidence, and reasoning string — is never sent to the
background script, never posted to the web app, and never forwarded to any API endpoint.

The Claude fallback path travels a complete loop:
  content -> background -> /api/autopilot -> background -> content -> web app

Local decisions travel nowhere. They are born and consumed in a single function call:

```typescript
// poker-content.ts:1259-1269
const local = localDecide(state);
if (local && local.confidence >= CONFIDENCE_THRESHOLD) {
  executing = true;
  console.log(`[Poker] [Local] ...`);
  safeExecuteAction(
    { action: local.action, amount: local.amount, reasoning: local.reasoning },
    "local",
  );
  // returns — nothing sent anywhere
}
```

**Impact:** An agent monitoring play cannot distinguish which decisions came from the local
engine vs Claude. An agent asked "what did you just decide and why?" has no data source
to query. Any logging, learning, or correction loop is blocked.

**Fix:** After a local decision exceeds the confidence threshold, post a structured message
at minimum { source, action, amount, confidence, reasoning, handId } through the background
to the web app. The LocalDecision interface at rule-tree.ts lines 26-34 already has all
the needed fields. Nothing new needs to be modelled, only surfaced.

---

### 2. applyExploitAdjustments Output Has No External Visibility

**Location:** lib/poker/exploit.ts lines 90-200, called from lib/poker/rule-tree.ts line 265

applyExploitAdjustments() modifies action, amount, and confidence before returning. The
"[exploit: TYPE, n=N]" tag appended to the reasoning string is the only signal that an
exploit adjustment occurred, and that string is only ever logged to the browser console
(poker-content.ts line 1262). There is no structured field that separates the GTO base
action from the exploit-adjusted action. Recovering the opponent type and sample size
requires regex parsing of a prose string.

**Impact:** An agent cannot determine whether a given decision was GTO-derived or
exploit-adjusted, what opponent type triggered the adjustment, or whether the adjustment
increased or decreased confidence. Retrospective review is impossible.

**Fix:** Promote the exploit metadata to structured fields alongside the decision output:
exploitType (string | null), exploitHandsObserved (number | null), confidenceDelta (number).
Include these in any decision log event posted to the web app.

---

### 3. The Confidence Score Has No Structured Exposure

**Location:** extension/src/poker-content.ts lines 1260, 1272; lib/poker/rule-tree.ts line 26

LocalDecision.confidence controls whether the local engine acts or falls back to Claude.
It is the most operationally significant number in the local path. It is logged to console
but never included in the overlay, never returned to the web app, and not accessible via
any API. The overlay at lines 1062-1083 shows persona and Claude advice but skips local
engine output entirely.

**Impact:** An agent cannot assess whether the local engine is operating confidently or
barely above threshold. A systematic pattern of low-confidence decisions caused by
unmodelled board textures would be invisible without reading raw console logs.

**Fix:** Include confidence in the decision log event. Show it in the monitor overlay
alongside the existing advice display.

---

### 4. lastTableTemperature State Has No API Endpoint or Message Path

**Location:** extension/src/poker-content.ts lines 90, 668-673, 736-737

lastTableTemperature is an in-memory module-level variable storing { dominantType,
handsObserved }. It is set once per hand during requestPersona() and read by localDecide()
to derive the opponentType passed to the rule tree. It is never sent to the web app,
never exposed via any chrome.runtime message, never included in the overlay, and not
accessible via a GET endpoint.

The GET_STATUS handler in background.ts line 211 returns { connected, continuous,
pokerConnected, autopilotMode } but no temperature.

**Impact:** An agent cannot query what table type the engine is currently exploiting.
The temperature directly controls bet sizing (via DELTAS in exploit.ts lines 67-73) and
hard action overrides (AP-1 through AP-4 in exploit.ts lines 116-165). A wrong
classification causes systematic sizing errors that are invisible to any monitoring agent.

**Fix:** Include lastTableTemperature in the decision log event. Add it to the GET_STATUS
response or as a separate query message type in the background protocol.

---

### 5. No Agent Path to Override opponentType or Confidence Threshold

**Location:** extension/src/poker-content.ts lines 94-101, 512-524, 736

CONFIDENCE_THRESHOLD can be set via chrome.storage.local (line 96) but there is no API
surface for this. opponentType is derived entirely from lastTableTemperature through the
fixed mapping opponentTypeFromTemperature (lines 512-524) with no override mechanism.

**Impact:** An agent observing systematic errors for a specific table type cannot intervene.
If VPIP/AF DOM scraping returns no data for a given poker client layout, opponentType is
undefined and no exploit adjustments fire — but there is no way for an agent to inject a
correct opponentType for the session.

**Fix:** Add a chrome.runtime message type (e.g. SET_OPPONENT_TYPE) that lets the web app
or an agent override the inferred type. Expose CONFIDENCE_THRESHOLD through an API endpoint
(e.g. PATCH /api/engine-config) rather than requiring direct chrome.storage.local writes.

---

## Warnings (Should Fix)

### 6. Exploit Constants Are Hardcoded With No Inspection API

**Location:** lib/poker/exploit.ts lines 67-73, 185-191

The DELTAS table:
  LOOSE_PASSIVE:    { base: +0.10, valueBet: +0.08, bluff: -0.25, callDown: +0.05 }
  TIGHT_AGGRESSIVE: { base: -0.05, valueBet: +0.05, bluff: -0.20, callDown: -0.10 }
  ...

And sizing multipliers (1.30 vs LOOSE_PASSIVE, 0.85 vs TIGHT_PASSIVE) are compile-time
literals. The sampleConfidenceMultiplier thresholds (lines 24-30) are also compile-time.
There is no GET endpoint that returns current constants and no message type that lets an
agent query the active configuration.

**Recommendation:** Expose constants through a read-only GET /api/engine-config endpoint
so agents can include them in reasoning about system behavior.

---

### 7. The Monitor Overlay Shows No Source Label for Local Engine Decisions

**Location:** extension/src/poker-content.ts lines 1062-1083, 950

The overlay advice section (claudeHtml) shows lastClaudeAdvice or monitorAdvice, and the
label is always "AI:". Local engine decisions in monitor mode do set monitorAdvice via
safeExecuteAction() — but the user and any agent reading overlay content cannot distinguish
a local engine recommendation from a Claude recommendation.

**Recommendation:** Use the source argument already passed to safeExecuteAction() (line 950)
to label the source in the overlay as "[Local]" vs "[Claude]".

---

### 8. The Autopilot System Prompt Has No Awareness of the Local Engine

**Location:** lib/ai/autopilot-prompt.ts (entire file)

When Claude receives a fallback request it starts from zero context. The system prompt
does not mention that a local engine has already attempted a decision and found low
confidence, what the local engine reasoning was, what the confidence threshold is, or what
opponentType the exploit layer inferred.

**Recommendation:** When falling back to Claude, prepend the local engine low-confidence
reasoning to the user message. The caller at poker-content.ts line 1276 has the local
object in scope but discards it before calling requestDecision().

---

## Observations (Consider)

### 9. The [exploit: TYPE, n=N] Tag Is Parse-Hostile

The exploit tag is appended as a plain string suffix in exploit.ts line 111:
  const exploitTag = ` [exploit: ${type}, n=${handsObserved}]`;

Any consumer that needs the opponent type and sample size must parse this string with a
regex. If the format changes, parsers break silently.

### 10. Preflop Fast-Path Logs Confidence but Does Not Include It in reasoning

**Location:** poker-content.ts line 1246

The preflop persona chart path logs "(confidence 1.0)" to the console but the reasoning
field passed to safeExecuteAction() is "Preflop chart: ${lastPersonaRec.name}" with no
confidence value, making the decision log inconsistent between paths.

---

## Recommendations (Prioritized)

1. Emit a structured DECISION_MADE event to the web app for every local engine decision,
   including { source, action, amount, confidence, reasoning, exploitType, exploitN,
   handId, tableTemperature }. Route through background as a new message type. This single
   change resolves findings 1, 2, 3, and 4 simultaneously.

2. Add GET /api/engine-config returning DELTAS, CONFIDENCE_THRESHOLD, and
   sampleConfidenceMultiplier thresholds. Read-only. Resolves finding 6 and partially 5.

3. Add SET_OPPONENT_TYPE to the background protocol so the web app or an agent can override
   the inferred opponent type without chrome.storage.local access. Resolves finding 5.

4. Label local vs Claude decisions in the monitor overlay using the source argument already
   in scope at safeExecuteAction() line 950. Resolves finding 7.

5. Pass low-confidence local reasoning to Claude as context when falling back. The local
   object is in scope at poker-content.ts line 1276. Resolves finding 8.

---

## What Is Working Well

- rule-tree.ts and exploit.ts are pure functions with no chrome.* dependencies. They are
  fully unit-testable and could be exposed via a thin API wrapper without restructuring.

- CONFIDENCE_THRESHOLD tuning via chrome.storage.local (line 96) shows the right intent;
  it just needs an API wrapper to complete the agent interaction loop.

- The Claude fallback path has a clean, consistent message protocol with full round-trip
  visibility. The local engine path needs this same loop closed.

- The LocalDecision interface (rule-tree.ts lines 26-34) already has all fields needed for
  structured reporting. No new modelling is required, only surfacing.

- The [exploit: TYPE, n=N] tag shows intent toward observability. Promoting it from a string
  suffix to a structured field is a small change with high impact.

---

## Agent-Native Score

- 4 of 14 identified capabilities are agent-accessible
  (persona selection, Claude fallback, card detection, full screenshot analysis)
- 10 capabilities are internal-only or missing
  (local engine decision output, exploit output, confidence score, reasoning string,
  table temperature query, lastTableTemperature state, opponentType override, threshold
  override, exploit constants, source labeling)
- Verdict: NEEDS WORK — The local engine handles a significant fraction of real-money
  decisions with no external observability. Any agent, monitoring tool, or logging system
  is blind to the decisions it makes.
