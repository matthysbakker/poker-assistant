---
status: pending
priority: p2
issue_id: "087"
tags: [code-review, architecture, quality]
dependencies: []
---

# CaptureContext Interface Defined in UI Component File

## Problem Statement

`CaptureContext` is a pure domain/data-transfer type that describes the context captured at analysis time. It is currently defined in `components/analyzer/AnalysisResult.tsx`, which inverts the dependency direction: `page.tsx` (a route-level orchestrator) imports a shared data type from a leaf UI component. Domain types should live in `lib/`, not in component files.

## Findings

- `components/analyzer/AnalysisResult.tsx:19-31` — `CaptureContext` interface defined and exported here
- `app/page.tsx:21` — imports `CaptureContext` from a UI component file (`import type { CaptureContext } from "@/components/analyzer/AnalysisResult"`)
- If `AnalysisResult.tsx` is renamed, split, or deleted, this import breaks at build time
- Architecture agent: "The relationship should flow the other way — UI components may depend on domain types, not define them"
- `CaptureContext` shares domain concepts with `HandRecord` (same fields) and `HandState` (same source data)
- Simplicity agent noted the interface has only one consumer (the `submit()` spread) so the abstraction may not be needed at all

## Proposed Solutions

### Option 1: Move to lib/hand-tracking/types.ts (Recommended)

**Approach:** Move the `CaptureContext` interface to `lib/hand-tracking/types.ts`, which already contains `HandState`, `HandAction`, etc. Update imports in `page.tsx` and `AnalysisResult.tsx`.

**Pros:**
- Correct dependency direction: UI imports from lib, not vice versa
- Co-located with related `HandState` type
- Single line change at the import sites

**Cons:**
- None

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Eliminate the interface entirely

**Approach:** Since `CaptureContext` has only one consumer (the `submit()` spread), inline the fields directly into `AnalysisResultProps` or pass them as individual props. Remove the `CaptureContext` type altogether.

**Pros:**
- Eliminates the wrong-file problem at root
- Reduces abstraction overhead

**Cons:**
- More props on `AnalysisResult`
- Loses the named grouping

**Effort:** 30-60 minutes

**Risk:** Low

---

## Recommended Action

**To be filled during triage.** Option 1 is the minimal correct fix. If todo 085 (captureContext snapshot ref) is implemented first, consider Option 2 as a simplification.

## Technical Details

**Affected files:**
- `components/analyzer/AnalysisResult.tsx:19-31` — move interface out
- `lib/hand-tracking/types.ts` — add interface
- `app/page.tsx:21` — update import

## Resources

- **PR:** #12
- **Related:** todo 085 (captureContext stale values)

## Acceptance Criteria

- [ ] `CaptureContext` defined in `lib/hand-tracking/types.ts` (or eliminated)
- [ ] `app/page.tsx` imports from `lib/`, not from `components/`
- [ ] TypeScript compiles cleanly

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (architecture-strategist + pattern-recognition-specialist agents)
