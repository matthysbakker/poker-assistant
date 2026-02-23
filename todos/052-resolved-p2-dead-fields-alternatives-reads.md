---
status: pending
priority: p2
issue_id: "052"
tags: [code-review, cleanup, personas, dead-code]
dependencies: []
---

# Dead Fields: `alternatives` in SelectedPersona and `reads` in postMessage

## Problem Statement

Two pieces of data are computed and transmitted every hand but never consumed by any UI component:

1. **`SelectedPersona.alternatives`** — allocated by `persona-selector.ts` on every multi-candidate rotation, but `page.tsx` never accesses `selectedPersona?.alternatives` and `PersonaComparison.tsx` has no prop for it. The JSDoc says "shown in UI as alternatives" — this is false.

2. **`reads` in postMessage payload** — `page.tsx` sends `reads: profile.reads` in the `PERSONA_RECOMMENDATION` message, but `PersonaRec` interface in `poker-content.ts` has no `reads` field and the overlay HTML never displays a read count.

Both fields exist in a "we might use this later" state that contradicts YAGNI and misleads maintainers.

## Findings

- `lib/poker/persona-selector.ts:17` — `alternatives: Persona[]` in `SelectedPersona` interface, documented as "shown in UI as alternatives"
- `lib/poker/persona-selector.ts:90-92` — alternatives computed on every tied rotation: `candidates.filter((_, i) => i !== idx).map((r) => r.persona)`
- `app/page.tsx:264-267` — passes only `selectedPersona?.persona.id` and `selectedPersona?.rotated` downstream; never reads `.alternatives`
- `components/analyzer/PersonaComparison.tsx` — no `alternatives` prop exists
- `app/page.tsx:131` — `reads: profile.reads` in postMessage payload
- `extension/src/poker-content.ts:68-72` — `PersonaRec` interface: `name`, `action`, `temperature` only; `reads` silently dropped
- `extension/src/poker-content.ts:718-738` — overlay HTML never renders reads count
- Code quality review + simplicity review (2026-02-23): both flagged as dead weight

## Proposed Solutions

### Option A: Remove both dead fields (Recommended)

**`alternatives` removal:**
1. Delete `alternatives: Persona[]` from `SelectedPersona` interface
2. Delete lines 90-92 from `persona-selector.ts` (the `alternatives` computation)
3. Change `return { ..., alternatives, rotated: true }` to `return { ..., rotated: true }`
4. Delete 3 test assertions in `persona-selector.test.ts` that verify `alternatives` content

**`reads` removal from postMessage:**
1. Remove `reads: profile.reads` from the `window.postMessage` call in `page.tsx:131`

**Effort:** Delete ~8 lines total across 3 files
**Risk:** None — nothing reads these values

### Option B: Wire up alternatives in PersonaComparison UI

Add an `alternatives?: Persona[]` prop to `PersonaComparison`, display them below the chosen persona with a "or play as:" label.

**Effort:** Medium — requires UI work
**Risk:** Feature scope expansion, not cleanup

## Recommended Action

Option A. Remove both. If alternatives display or reads count in overlay is ever desired, add them then with a concrete design. The JSDoc comment on `alternatives` is actively misleading.

## Technical Details

- **Affected files:** `lib/poker/persona-selector.ts`, `lib/poker/__tests__/persona-selector.test.ts`, `app/page.tsx`, `extension/src/poker-content.ts`
- **Lines affected:** `persona-selector.ts:17,90-98`; `persona-selector.test.ts:79-86`; `page.tsx:131`

## Acceptance Criteria

- [ ] `SelectedPersona` interface has no `alternatives` field
- [ ] `persona-selector.ts` multi-candidate branch does not compute alternatives
- [ ] `window.postMessage` in `page.tsx` does not include `reads`
- [ ] All 28 tests still pass after removing dead test assertions
- [ ] `tsc --noEmit` passes

## Work Log

- 2026-02-23: Identified by simplicity and code-quality reviews of PR #8
