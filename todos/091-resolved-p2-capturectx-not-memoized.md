---
status: pending
priority: p2
issue_id: "091"
tags: [code-review, performance, quality]
dependencies: [085]
---

# captureContext Not Memoized — useEffect Fires Every 2 Seconds

## Problem Statement

`captureContext` is constructed as a plain object literal in `page.tsx`'s render body. React compares dep array entries by reference (`Object.is`), so a new object every render causes the submit `useEffect` in `AnalysisResult` to execute its body every time the parent re-renders — roughly every 2 seconds in continuous mode. The `submittedRef` guard prevents duplicate API calls, but the effect overhead is unnecessary and fragile against future changes.

## Findings

- `app/page.tsx:172-188` — object literal constructed on every render (no `useMemo`)
- `components/analyzer/AnalysisResult.tsx:83` — `captureContext` in dep array: `[imageBase64, submit, opponentHistory, handContext, captureMode, captureContext]`
- `handState` updates every 2 seconds via `useReducer` → re-render → new `captureContext` reference → effect body runs
- Performance agent: "the effect body executes roughly 30 times per minute during an active hand"
- `getSession()` calls `sessionStorage.getItem` + `JSON.parse` on every render (sessionId is stable for the tab lifetime)
- Note: todo 085 (snapshot ref fix) would also resolve this as a side effect — check if 085 is implemented first

## Proposed Solutions

### Option 1: useMemo keyed on primitive constituents (Standalone fix)

**Approach:**
```ts
const captureContext: CaptureContext = useMemo(() => ({
  sessionId: sessionIdRef.current,  // stable ref, not getSession() call
  pokerHandId: isContinuous ? handState.pokerHandId : manualPokerHandIdRef.current,
  tableTemperature: tableProfile?.temperature ?? null,
  tableReads: tableProfile?.reads ?? null,
  heroPositionCode: handState.heroPosition,
  personaSelected: selectedPersona ? { ... } : null,
}), [isContinuous, handState.pokerHandId, handState.heroPosition, tableProfile, selectedPersona]);
```

Cache `sessionId` in a `useRef` initialized once, updated in `handleResetSession`.

**Pros:**
- Prevents spurious effect executions
- Removes `getSession()` from render path

**Cons:**
- Does not fix the data integrity issue (see todo 085)
- Adds memoization dependency management

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Resolve via todo 085 (Snapshot ref approach)

**Approach:** If todo 085 is implemented (snapshot captureContext into a ref at capture time), `captureContext` is removed from the dep array entirely. This issue is automatically resolved.

**Effort:** 0 additional effort if 085 is done

**Risk:** None

---

## Recommended Action

**To be filled during triage.** If todo 085 is approved, implement that first and close this as resolved. If 085 is deferred, apply the `useMemo` fix.

## Technical Details

**Affected files:**
- `app/page.tsx:172-188`

## Resources

- **PR:** #12
- **Related:** todo 085

## Acceptance Criteria

- [ ] `captureContext` object reference is stable between renders when values don't change
- [ ] `getSession()` called at most once per session (not on every render)
- [ ] Submit useEffect does not run at the 2s capture cadence

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (performance-oracle agent)
