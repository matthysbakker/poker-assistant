---
status: pending
priority: p3
issue_id: "097"
tags: [code-review, quality]
dependencies: []
---

# ?? {} Spread in submit() Is Dead Fallback Code That Obscures API Payload

## Problem Statement

`...(captureContext ?? {})` in the `submit()` call has two issues: the `?? {}` is dead code (captureContext is always a non-null object), and the spread hides which fields enter the API payload from a reader who doesn't look up `CaptureContext`.

## Findings

- `components/analyzer/AnalysisResult.tsx:75-81`
- `captureContext` is built unconditionally in `page.tsx` with null defaults for each field — it is never `undefined`
- The `?? {}` fallback implies fragility that does not exist, suggesting to future readers that the prop might be absent
- The spread means a reader must look up `CaptureContext` to know what enters the API payload (a hidden surface)
- Simplicity agent: "The `?? {}` is dead code — captureContext is always constructed unconditionally in page.tsx with null defaults"

## Proposed Solutions

### Option 1: Make captureContext prop required and remove ?? {}

**Approach:**
```ts
// AnalysisResultProps: change optional to required
captureContext: CaptureContext;  // remove ?

// submit call:
submit({
  image: imageBase64,
  opponentHistory,
  handContext,
  captureMode,
  ...captureContext,  // no ?? {}
});
```

**Pros:**
- Removes misleading dead code
- TypeScript enforces the prop is always provided

**Effort:** 10 minutes

**Risk:** None

---

### Option 2: Name the fields explicitly

**Approach:** Replace the spread with explicit field-by-field assignment matching the Zod schema.

**Pros:**
- Payload shape visible at the submit call site

**Cons:**
- More verbose

**Effort:** 15 minutes

**Risk:** None

---

## Recommended Action

**To be filled during triage.** Option 1 is the minimal fix.

## Technical Details

**Affected files:**
- `components/analyzer/AnalysisResult.tsx:75-81, 44`

## Resources

- **PR:** #12

## Acceptance Criteria

- [ ] `?? {}` fallback removed
- [ ] `captureContext` prop is required (not optional) OR fields are named explicitly

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (code-simplicity-reviewer agent)
