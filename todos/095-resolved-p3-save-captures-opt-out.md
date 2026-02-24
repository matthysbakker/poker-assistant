---
status: pending
priority: p3
issue_id: "095"
tags: [code-review, security, quality]
dependencies: []
---

# SAVE_CAPTURES is Opt-Out — Inconsistent with SAVE_HANDS Opt-In Default

## Problem Statement

`SAVE_CAPTURES` and `SAVE_HANDS` use opposite defaults. Screenshots are saved to disk in any environment where the env var is absent, while hand JSON records require explicit opt-in. Screenshots may contain sensitive poker account content (usernames, balances, chat), so the asymmetric default is a privacy concern.

## Findings

- `app/api/analyze/route.ts:76` — captures written when `process.env.SAVE_CAPTURES !== 'false'` (opt-out)
- The `SAVE_HANDS` guard uses `=== 'true'` (opt-in) — the correct pattern
- In any environment where `SAVE_CAPTURES` is not explicitly set (fresh clone, CI, staging), every screenshot is persisted to `test/captures/`
- Screenshots contain the full poker table view including usernames and balance information

## Proposed Solutions

### Option 1: Change SAVE_CAPTURES to opt-in (Recommended)

**Approach:**
```ts
// Change from:
if (process.env.SAVE_CAPTURES !== 'false') {
// To:
if (process.env.SAVE_CAPTURES === 'true') {
```

Update `.env.local.example` to document both variables with their correct defaults.

**Pros:**
- Consistent with `SAVE_HANDS` pattern
- Privacy-correct default (no data retained without opt-in)

**Cons:**
- Breaking behavior change for existing setups that rely on the opt-out default

**Effort:** 2 minutes

**Risk:** Low (affects dev environment only)

---

## Recommended Action

**To be filled during triage.** Change to opt-in. Update `.env.local.example`.

## Technical Details

**Affected files:**
- `app/api/analyze/route.ts:76`

## Resources

- **PR:** #12

## Acceptance Criteria

- [ ] `SAVE_CAPTURES` uses `=== 'true'` (opt-in) to match `SAVE_HANDS`
- [ ] `.env.local.example` documents both variables

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (security-sentinel agent)
