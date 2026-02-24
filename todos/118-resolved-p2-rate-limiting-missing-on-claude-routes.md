---
status: pending
priority: p2
issue_id: "118"
tags: [code-review, security, reliability, api]
---

# No rate limiting on Claude-calling routes — API key can be drained by loop

## Problem Statement
`/api/analyze` and `/api/autopilot` call the Anthropic API with no server-side guard. The 3-second client-side debounce in `background.ts` is the only protection. A direct HTTP call, a bug-triggered loop in continuous mode, or a crash-loop scenario burns through the API key with no circuit breaker.

## Findings
- `app/api/analyze/route.ts` — no rate limit guard
- `app/api/autopilot/route.ts` — no rate limit guard
- Client-side guard only: debounce in `background.ts`, `detectingRef` mutex in `use-continuous-capture.ts`
- Server-side guards are defense-in-depth and should not depend on client behaviour

## Proposed Fix
Simple module-level last-call timestamp guard (sufficient for single-user local tool):
```typescript
let lastAnalyzeMs = 0;
const MIN_ANALYZE_INTERVAL_MS = 3000;

export async function POST(req: Request) {
  const now = Date.now();
  if (now - lastAnalyzeMs < MIN_ANALYZE_INTERVAL_MS) {
    return Response.json({ error: "Rate limit: too many requests." }, { status: 429 });
  }
  lastAnalyzeMs = now;
  // ... existing logic
}
```

## Files
- `app/api/analyze/route.ts` (top of POST handler)
- `app/api/autopilot/route.ts` (top of POST handler)

## Acceptance Criteria
- [ ] Rapid successive requests to `/api/analyze` return 429
- [ ] Normal usage (3s+ interval) not affected
- [ ] Autopilot route has equivalent guard
