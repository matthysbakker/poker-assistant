---
status: pending
priority: p3
issue_id: "099"
tags: [code-review, security, quality]
dependencies: []
---

# query-hands Loads Records with JSON.parse Cast — No Schema Validation

## Problem Statement

`scripts/query-hands.ts` loads hand records from disk as `JSON.parse(raw) as HandRecord` without Zod validation. If a record on disk is malformed (from a tampered POST via the unauthenticated endpoint, or a format change), the script crashes rather than skipping the bad record gracefully.

## Findings

- `scripts/query-hands.ts:36` — records loaded as `JSON.parse(raw) as HandRecord` (type assertion, no runtime check)
- `scripts/query-hands.ts:205, 218` — non-null assertions `r.personaSelected!.personaId` rely on the upstream filter, but if the record structure is unexpected, crash
- A tampered record written via the unauthenticated `/api/analyze` route (see todo 084) could crash the analytics script
- The new fields added by this PR (`tableTemperature`, `personaSelected`, etc.) are accessed with non-null assertion operators in some places

## Proposed Solutions

### Option 1: Use HandRecord Zod schema with safeParse (Recommended)

**Approach:** Create a Zod schema for `HandRecord` in `lib/storage/hand-records.ts` (or a sibling `schemas.ts`) and use `safeParse` when loading. Skip malformed records with a warning.

**Pros:**
- Script continues even with a bad record
- Self-documenting validation

**Cons:**
- Requires creating a Zod schema for HandRecord (moderate effort)

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Try/catch per record with continue (Minimal fix)

**Approach:**
```ts
try {
  const record = JSON.parse(raw) as HandRecord;
  records.push(record);
} catch {
  console.warn(`Skipping malformed record: ${file}`);
}
```

**Pros:**
- Minimal change
- Prevents crash on malformed JSON

**Cons:**
- Type cast still exists; invalid-shape records are not caught

**Effort:** 5 minutes

**Risk:** None

---

## Recommended Action

**To be filled during triage.** Option 2 (try/catch) is the quick fix. Option 1 if a HandRecord Zod schema is created for other reasons (e.g., todo 086).

## Technical Details

**Affected files:**
- `scripts/query-hands.ts:36`

## Resources

- **PR:** #12
- **Related:** todo 084 (unauthenticated write surface)

## Acceptance Criteria

- [ ] Malformed records in `data/hands/` do not crash the query script
- [ ] Bad records are reported as warnings, not silently skipped

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (security-sentinel agent)
