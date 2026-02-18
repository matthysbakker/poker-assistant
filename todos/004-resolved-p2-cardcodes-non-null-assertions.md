---
status: resolved
priority: p2
issue_id: "004"
tags: [code-review, type-safety]
---

# Non-null assertions in cardCodes function

## Problem Statement
`.filter(m => m.card !== null).map(m => m.card!)` bypasses TypeScript's type narrowing. The `!` is safe at runtime but defeats the purpose of strict typing.

## Findings
- `lib/hand-tracking/state-machine.ts` lines 52-59

## Proposed Fix
Use `flatMap`: `detection.heroCards.flatMap(m => m.card ? [m.card] : [])` or a type guard function.
