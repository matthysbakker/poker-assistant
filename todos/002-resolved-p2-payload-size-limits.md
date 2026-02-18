---
status: resolved
priority: p2
issue_id: "002"
tags: [code-review, security, api]
---

# No payload size limit on base64 image strings

## Problem Statement
Both `/api/detect` and `/api/analyze` accept unbounded base64 strings via Zod validation (`z.string().min(1)`). A corrupted or malicious frame could send an arbitrarily large payload consuming server memory.

## Findings
- `app/api/detect/route.ts` line 4: `z.string().min(1)` — no max
- `app/api/analyze/route.ts` line 21: same issue

## Proposed Fix
Add `.max(10_000_000)` to both Zod schemas (~7.5MB decoded, generous for screenshots).
