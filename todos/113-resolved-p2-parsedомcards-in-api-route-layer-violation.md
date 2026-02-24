---
status: pending
priority: p2
issue_id: "113"
tags: [code-review, architecture, code-quality]
---

# parseDomCards is a domain function buried in the API route layer

## Problem Statement
`parseDomCards` is a pure domain function that decodes the handContext text protocol. It lives in a 229-line transport/infrastructure file alongside HTTP validation and AI dispatch. The producer (`buildHandContext`) and consumer (`parseDomCards`) are in different layers with no shared contract. If `buildHandContext` changes the format string, `parseDomCards` silently produces empty arrays with no compile error.

## Findings
- `app/api/analyze/route.ts:29-42` — `parseDomCards` defined as file-scoped function
- `lib/hand-tracking/use-hand-tracker.ts:38-63` — `buildHandContext` produces the string that parseDomCards consumes
- No test covers the round-trip; a format change silently breaks card extraction
- Any future API route needing DOM cards would duplicate this function

## Proposed Fix
Move `parseDomCards` to `lib/hand-tracking/` (e.g., `lib/hand-tracking/hand-context.ts`) as a sibling export of `buildHandContext`. Export both from `lib/hand-tracking/index.ts`. Import in the API route.

Longer term: replace the prose encoding with structured API fields (`heroCards: string[], communityCards: string[]`) to eliminate the regex round-trip entirely.

## Files
- `app/api/analyze/route.ts:29-42` (move out of here)
- `lib/hand-tracking/` (move into here)
- `lib/hand-tracking/use-hand-tracker.ts:38-63` (reference for format contract)

## Acceptance Criteria
- [ ] `parseDomCards` lives in `lib/hand-tracking/`
- [ ] Both `buildHandContext` and `parseDomCards` are in the same module
- [ ] API route imports from `lib/hand-tracking/`
- [ ] All existing tests pass
