---
status: pending
priority: p2
issue_id: "040"
tags: [code-review, convention, ai, autopilot]
dependencies: []
---

# Model ID Uses Date-Pinned Format, Violates Project Convention

## Problem Statement

`app/api/autopilot/route.ts` uses `anthropic("claude-sonnet-4-20250514")` — a date-pinned model ID. The global CLAUDE.md convention explicitly requires unversioned aliases. This introduces version skew with the rest of the project and will silently point at an older model as newer versions are released.

## Findings

- `app/api/autopilot/route.ts:36` — `model: anthropic("claude-sonnet-4-20250514")`
- Global `CLAUDE.md` rule: "Prefer unversioned aliases when available (e.g. `claude-sonnet-4-6` over `claude-sonnet-4-5-20250929`)"
- Pattern review (2026-02-23): "The unversioned alias `claude-sonnet-4-6` should be used"

## Proposed Solutions

### Option A: Use unversioned alias (Recommended)
```typescript
model: anthropic("claude-sonnet-4-6"),
```
**Pros:** Follows convention; auto-upgrades within major version
**Cons:** None for a personal tool
**Effort:** 1 token change
**Risk:** None

## Recommended Action

Option A. 1-line change.

## Technical Details

- **File:** `app/api/autopilot/route.ts:36`
- **Current:** `anthropic("claude-sonnet-4-20250514")`
- **Target:** `anthropic("claude-sonnet-4-6")`

## Acceptance Criteria

- [ ] Model ID in autopilot route uses unversioned alias `claude-sonnet-4-6`

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by pattern-recognition-specialist, architecture-strategist (L2). Trivial fix.
