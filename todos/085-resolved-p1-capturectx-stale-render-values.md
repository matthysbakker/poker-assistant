---
status: pending
priority: p1
issue_id: "085"
tags: [code-review, architecture, performance, quality]
dependencies: []
---

# captureContext Not Atomically Snapshotted — Wrong Context Saved to HandRecord

## Problem Statement

`captureContext` is built from live render state in `page.tsx` and passed as a prop to `AnalysisResult`. The submit `useEffect` in `AnalysisResult` closes over the `captureContext` from whatever render runs the effect — which may not be the render that corresponded to the actual capture event. This means the `tableTemperature`, `personaSelected`, and `heroPositionCode` saved to a `HandRecord` could be from a different point in time than when the screenshot was taken.

## Findings

- `app/page.tsx:172-188` — `captureContext` is a plain object literal built during render, reconstructed every time any state changes
- `components/analyzer/AnalysisResult.tsx:83` — `captureContext` is in the `useEffect` dep array; React compares by reference (`Object.is`), so a new object every render means the effect body runs every 2 seconds in continuous mode
- In continuous mode at 2s intervals, `handState` dispatches new state every tick, causing re-renders; if `tableProfile` or `selectedPersona` updates concurrently, the `captureContext` in the effect may reflect post-capture state
- Architecture agent: "a caller can inject adversarial strings... and could cause unexpected behavior in downstream tooling"
- The `submittedRef` guard prevents duplicate API calls, but does not prevent the effect from using stale/wrong context values
- Performance agent: the effect body executes ~30 times/minute during a hand (every 2s render), and `getSession()` calls `sessionStorage.getItem` + `JSON.parse` on every render

## Proposed Solutions

### Option 1: Snapshot captureContext into a ref at capture time (Recommended)

**Approach:** At the exact moment `imageBase64` is set (inside `onAnalysisTrigger` and the `CAPTURE` message handler), atomically snapshot the capture context into a `captureContextRef.current`. Read `captureContextRef.current` inside the submit effect instead of depending on the prop.

```ts
// page.tsx — snapshot at capture time
const captureContextRef = useRef<CaptureContext | null>(null);

// Inside CAPTURE handler:
captureContextRef.current = {
  sessionId: sessionIdRef.current,
  pokerHandId: manualPokerHandIdRef.current,
  tableTemperature: tableProfile?.temperature ?? null,
  ...
};
setImageBase64(event.data.base64);

// AnalysisResult — read from ref, not prop
submit({ image: imageBase64, ...(captureContextRef.current ?? {}) });
```

**Pros:**
- Eliminates the stale render value problem entirely
- Removes `captureContext` from useEffect deps (no more spurious re-runs)
- Context values are guaranteed to match the capture event

**Cons:**
- Ref-based pattern slightly harder to trace than props

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: useMemo on captureContext (Partial fix)

**Approach:** Wrap `captureContext` in `useMemo` keyed on primitive values. Reduces spurious effect runs but does not eliminate the race between capture event and concurrent state updates.

**Pros:**
- Simpler change
- Fixes the performance issue

**Cons:**
- Does not fully solve the stale value problem

**Effort:** 30 minutes

**Risk:** Low — but incomplete fix for the data integrity issue

---

## Recommended Action

**To be filled during triage.** Option 1 (snapshot ref) is the correct architectural fix and also resolves the performance issue.

## Technical Details

**Affected files:**
- `app/page.tsx:172-188` — captureContext construction
- `app/page.tsx:57-64` — CAPTURE message handler
- `components/analyzer/AnalysisResult.tsx:71-83` — submit useEffect

**Related components:**
- `lib/storage/hand-records.ts` — receives the potentially stale context values

## Resources

- **PR:** #12

## Acceptance Criteria

- [ ] captureContext values are captured atomically at the same time as `imageBase64`
- [ ] `captureContext` removed from useEffect dep array in AnalysisResult
- [ ] `getSession()` called once (not every render)
- [ ] Verified that HandRecord timestamp + context fields correspond to the same capture event

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (architecture-strategist + performance-oracle agents)

**Actions:**
- Identified stale render value issue during PR #12 review
- Confirmed submittedRef does not protect against wrong context values
