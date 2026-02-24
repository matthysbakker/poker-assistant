---
status: pending
priority: p2
issue_id: "027"
tags: [code-review, typescript, type-safety, persona-generator]
dependencies: []
---

# `Persona.style` Typed as `string` Instead of Union Literal

## Problem Statement

`Persona.style` is typed as `string` in both the generator and the emitted `lib/poker/personas.ts`. The four valid values are `"gto"`, `"tag"`, `"lag"`, `"exploit"`. Without a union type, TypeScript cannot catch typos in persona definitions or in consumers that switch on `style`.

## Findings

- `scripts/generate-charts.ts:327` — `PersonaDef` interface has `style: string`
- `scripts/generate-charts.ts:428` — emitted `Persona` interface template has `style: string`
- `lib/poker/personas.ts:15` — generated `Persona` interface has `style: string`
- Flagged by TypeScript reviewer (Medium) and pattern reviewer (Medium)
- `persona-lookup.ts` doesn't currently use `style`, but `PersonaComparison.tsx` renders `persona.tagline` and future components could branch on `style`

## Proposed Solutions

### Option A: Add `PersonaStyle` union, update both files (Recommended)
In `scripts/generate-charts.ts`:
```typescript
type PersonaStyle = "gto" | "tag" | "lag" | "exploit";

interface PersonaDef {
  id: string;
  name: string;
  tagline: string;
  style: PersonaStyle;  // was: string
  ranges: PersonaRanges;
}
```

And update the emitted interface template (line ~428) to include the union:
```typescript
export type PersonaStyle = "gto" | "tag" | "lag" | "exploit";

export interface Persona {
  id: string;
  name: string;
  tagline: string;
  style: PersonaStyle;
  charts: Record<ChartPosition, Record<string, PersonaAction>>;
}
```

**Pros:** Compile-time safety in generator and all consumers. Small change.
**Effort:** Small (2 edits)
**Risk:** None

### Option B: Only fix the emitted file, not the generator
Update just the generated type without tightening the generator's internal type.
**Pros:** Faster
**Cons:** Generator can still produce an invalid style that TypeScript won't catch until a consumer reads the generated file
**Effort:** Smaller
**Risk:** Low

## Recommended Action

Option A — fix both the generator's internal `PersonaDef` and the emitted `Persona` interface.

## Technical Details

- **Files:** `scripts/generate-charts.ts` (lines 323-329, ~428), `lib/poker/personas.ts` (line 15)
- The generator writes the `Persona` interface as a string template — the union type must be updated in the template string, not just the TypeScript definition

## Acceptance Criteria

- [ ] `PersonaStyle = "gto" | "tag" | "lag" | "exploit"` exported from `lib/poker/personas.ts`
- [ ] `Persona.style` typed as `PersonaStyle` in the generated file
- [ ] `PersonaDef.style` typed as `PersonaStyle` in `generate-charts.ts`
- [ ] TypeScript build passes with no errors

## Work Log

- 2026-02-21: Created from PR #6 review. Flagged by TypeScript reviewer and pattern reviewer as Medium priority.
