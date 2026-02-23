---
status: pending
priority: p3
issue_id: "058"
tags: [code-review, cleanup, simplicity, personas, typescript]
dependencies: [052]
---

# Minor Simplicity Cleanups from Persona Auto-Selection PR

## Problem Statement

Three small simplicity issues introduced in PR #8 that are worth addressing together:

1. **`TEMPERATURE_LABELS` dict is unnecessary** — `PersonaComparison.tsx` has an 8-line dict mapping `TableTemperature` values to their hyphenated equivalents. `poker-content.ts` already does this inline with `.replace("_", "-")`. The dict can be replaced with a one-expression `.replace`.

2. **`tableProfile ?? undefined` coercion** — `page.tsx` passes `tableProfile ?? undefined` because state is `TableProfile | null` but the prop expects `TableProfile | undefined`. Initialising state as `undefined` instead of `null` eliminates the coercion.

3. **`replace("_", "-")` only replaces first underscore** — `poker-content.ts:722` uses string literal `.replace("_", "-")` which only replaces the first occurrence. All current `TableTemperature` values have one underscore, so this is correct by coincidence. `"replaceAll"` or a regex `/g` flag is safer. (Related: the two files use different approaches for the same transform — a discrepancy.)

## Findings

- `components/analyzer/PersonaComparison.tsx:13-20` — `TEMPERATURE_LABELS` dict, 8 lines
- `components/analyzer/PersonaComparison.tsx:50` — `TEMPERATURE_LABELS[tableTemperature.temperature]` lookup
- `app/page.tsx:265` — `tableProfile ?? undefined` coercion
- `app/page.tsx:98` — `useState<TableProfile | null>(null)`
- `extension/src/poker-content.ts:722` — `lastPersonaRec.temperature.replace("_", "-")` (single replace)
- Simplicity review (2026-02-23): 16 lines total could be removed across this PR

**Note:** The `rotated` prop threading (page.tsx → AnalysisResult → PersonaComparison) solely to render `↻` vs `▶` is a judgment call. If the visual distinction between rotated and fixed persona selection is not meaningful, the prop can be removed entirely. Left out of this todo as it's purely cosmetic.

## Proposed Solutions

### Fix 1: Replace TEMPERATURE_LABELS dict

```typescript
// Before:
const TEMPERATURE_LABELS: Record<string, string> = { tight_passive: "tight-passive", ... };
// Usage:
{TEMPERATURE_LABELS[tableTemperature.temperature]} · {tableTemperature.reads} reads

// After (remove dict entirely):
{tableTemperature.temperature.replace(/_/g, "-")} · {tableTemperature.reads} reads
```

### Fix 2: Use undefined instead of null for tableProfile state

```typescript
// In page.tsx:
const [tableProfile, setTableProfile] = useState<TableProfile | undefined>(undefined);
// prop:
tableTemperature={tableProfile}  // no ?? undefined needed
// and in WAITING branch:
setTableProfile(undefined);  // was setTableProfile(null)
```

### Fix 3: Use replaceAll in poker-content.ts

```typescript
// Before:
lastPersonaRec.temperature.replace("_", "-")
// After:
lastPersonaRec.temperature.replaceAll("_", "-")
```

**Total effort:** ~10 lines changed across 3 files
**Risk:** None

## Recommended Action

All three fixes. Mechanical changes, no logic impact.

## Technical Details

- **Affected files:** `components/analyzer/PersonaComparison.tsx`, `app/page.tsx`, `extension/src/poker-content.ts`
- **Blocked by:** todo 052 (if `alternatives` field is removed first, simpler to batch these cleanups after)

## Acceptance Criteria

- [ ] `TEMPERATURE_LABELS` dict removed from `PersonaComparison.tsx`
- [ ] Temperature display uses inline `.replace(/_/g, "-")`
- [ ] `tableProfile` state typed as `TableProfile | undefined`, no `?? undefined` coercion
- [ ] `poker-content.ts` uses `replaceAll` or `/g` regex for temperature transform
- [ ] `tsc --noEmit` passes, all tests pass

## Work Log

- 2026-02-23: Identified by simplicity and code-quality reviews of PR #8
