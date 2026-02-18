---
status: resolved
priority: p2
issue_id: "003"
tags: [code-review, type-safety]
---

# Unvalidated API response cast in handleContinuousFrame

## Problem Statement
`const detection: DetectionResult = await res.json()` is a type assertion with no runtime validation. A malformed response would silently corrupt the state machine. Called every 2 seconds.

## Findings
- `app/page.tsx` line 91: `res.json()` returns `Promise<any>`, cast to `DetectionResult`
- If server returns error shape, state machine receives garbage

## Proposed Fix
Add a guard before feeding to state machine: `if (!detection.heroCards || !detection.communityCards) return;` or validate with a Zod schema on the client.
