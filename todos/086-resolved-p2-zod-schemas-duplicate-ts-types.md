---
status: pending
priority: p2
issue_id: "086"
tags: [code-review, quality, architecture]
dependencies: []
---

# tableTemperatureSchema and positionSchema Duplicate Existing TypeScript Types

## Problem Statement

`app/api/analyze/route.ts` defines two Zod schemas by manually copying the values from existing TypeScript union types in `lib/`. A new enum member added to the canonical type will silently pass TypeScript compilation but fail Zod validation at runtime, rejecting API requests with a cryptic 400 error.

## Findings

- `app/api/analyze/route.ts:25-32` — `tableTemperatureSchema = z.enum([...])` manually copies 6 strings from `lib/poker/table-temperature.ts:12-18`
- `app/api/analyze/route.ts:34` — `positionSchema = z.enum(["UTG","MP","CO","BTN","SB","BB"])` manually copies `Position` from `lib/card-detection/types.ts:49`
- Both pattern and architecture agents independently flagged this as a silent divergence risk
- Pattern agent rated tableTemperatureSchema as P1 risk (silent validation failure with new temperature value)
- The fix is straightforward: derive the TypeScript type from Zod (`z.infer`) rather than the reverse

## Proposed Solutions

### Option 1: Export Zod schemas from lib/ and infer TypeScript types (Recommended)

**Approach:** In `lib/poker/table-temperature.ts`, replace the TypeScript union type with a Zod schema and derive the type from it:

```ts
// lib/poker/table-temperature.ts
import { z } from "zod";
export const tableTemperatureSchema = z.enum([
  "tight_passive", "tight_aggressive", "loose_passive",
  "loose_aggressive", "balanced", "unknown",
]);
export type TableTemperature = z.infer<typeof tableTemperatureSchema>;
```

Same for `Position` in `lib/card-detection/types.ts`. Import the schemas in `route.ts`.

**Pros:**
- Single source of truth
- Type and runtime validation always in sync
- Follows Zod best practices

**Cons:**
- Adds Zod import to lib/ files (currently clean of Zod)

**Effort:** 1 hour

**Risk:** Low

---

### Option 2: Create lib/schemas.ts with Zod schemas alongside existing types

**Approach:** Keep the existing TypeScript types unchanged in lib/. Create `lib/schemas.ts` (or `lib/poker/schemas.ts`) that imports and creates Zod schemas from the literal strings, with a `satisfies` check to ensure the Zod values match the TypeScript type.

**Pros:**
- Does not change existing type files
- Keeps Zod contained to schemas files

**Cons:**
- Still requires some manual synchronization

**Effort:** 1 hour

**Risk:** Low

---

## Recommended Action

**To be filled during triage.** Option 1 is the cleanest approach and is standard practice for Zod-first TypeScript.

## Technical Details

**Affected files:**
- `app/api/analyze/route.ts:25-32, 34` — schemas to remove
- `lib/poker/table-temperature.ts:12-18` — add Zod schema
- `lib/card-detection/types.ts:49` — add Zod schema for Position

## Resources

- **PR:** #12

## Acceptance Criteria

- [ ] `tableTemperatureSchema` exported from `lib/poker/table-temperature.ts`
- [ ] `positionSchema` exported from `lib/card-detection/types.ts`
- [ ] `TableTemperature` and `Position` types derived via `z.infer`
- [ ] `route.ts` imports schemas from lib/ (no local duplicates)
- [ ] TypeScript compiles cleanly

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (pattern-recognition-specialist + architecture-strategist agents)

**Actions:**
- Identified schema duplication during PR #12 review
