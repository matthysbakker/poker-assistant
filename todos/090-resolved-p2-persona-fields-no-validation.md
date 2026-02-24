---
status: pending
priority: p2
issue_id: "090"
tags: [code-review, security, quality]
dependencies: []
---

# personaSelected Free-String Fields Have No Server-Side Validation

## Problem Statement

The `personaSelected` sub-object in the `/api/analyze` schema has three free-string fields (`personaId`, `personaName`, `action`) with no length caps or allowlist validation. These values are written to persistent hand records and rendered in terminal output by `query-hands.ts`. ANSI escape sequences or control characters in these fields can corrupt terminal output, and fabricated `personaId` values pollute the analytics store with fake data.

## Findings

- `app/api/analyze/route.ts:47-55` — `personaId`, `personaName`, `action` are all bare `z.string()`
- `scripts/query-hands.ts:116` — `r.personaSelected!.personaId` is rendered in `console.log()` without sanitization
- No server-side check that `personaId` corresponds to a real persona defined in the system
- A caller can write fabricated persona records (e.g., `personaId: "GOD_MODE"`) to the analytics store
- Long strings in these fields expand terminal output unpredictably
- The `action` field parallels `captureMode` which is properly enum-validated — this field should be too

## Proposed Solutions

### Option 1: Add length limits and validate personaId against known personas

**Approach:**
```ts
personaSelected: z.object({
  personaId: z.string().max(64),
  personaName: z.string().max(64),
  action: z.string().max(64),
  temperature: tableTemperatureSchema.nullable(),
}).nullable().optional()
```

Optionally: add an enum of valid persona IDs imported from `lib/poker/personas.ts`.

**Pros:**
- Prevents ANSI injection, data poisoning
- Low effort

**Cons:**
- Enum validation requires importing persona list into the API route

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Length limits only (minimal fix)

**Approach:** Add `.max(64)` to all three string fields. Skip enum validation for now.

**Pros:**
- Minimal change
- Prevents unbounded strings

**Cons:**
- Does not prevent fabricated persona IDs

**Effort:** 10 minutes

**Risk:** Low

---

## Recommended Action

**To be filled during triage.** Option 2 at minimum; Option 1 if personas have stable IDs that can be enumerated.

## Technical Details

**Affected files:**
- `app/api/analyze/route.ts:47-55`

## Resources

- **PR:** #12

## Acceptance Criteria

- [ ] `personaId`, `personaName`, `action` all have `.max(64)` or similar
- [ ] Oversized values return 400
- [ ] (Optional) personaId validated against known persona list

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (security-sentinel agent)
