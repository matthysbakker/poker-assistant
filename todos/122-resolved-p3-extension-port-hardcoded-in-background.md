---
status: pending
priority: p3
issue_id: "122"
tags: [code-review, architecture, extension]
---

# Extension API URLs hardcode port 3006 in source

## Problem Statement
`background.ts` hardcodes `http://localhost:3006` in three URL constants. Any port change or alternate dev environment requires a source edit and extension rebuild.

## Findings
- `extension/src/background.ts:44-46` — `AUTOPILOT_API_URL`, `DECISION_API_URL`, `RECORD_API_URL` all hardcode port 3006

## Proposed Fix
Inject `BASE_URL` at build time via environment variable, with `http://localhost:3006` as default:
```typescript
const BASE_URL = process.env.APP_URL ?? "http://localhost:3006";
const AUTOPILOT_API_URL = `${BASE_URL}/api/autopilot`;
const DECISION_API_URL = `${BASE_URL}/api/decision`;
const RECORD_API_URL = `${BASE_URL}/api/record`;
```

Update `bun run build:extension` in `package.json` to pass `APP_URL` if set.

## Files
- `extension/src/background.ts:44-46`
- `package.json` build:extension script

## Acceptance Criteria
- [ ] Port not hardcoded in source
- [ ] `APP_URL` env var respected at build time
- [ ] Default still works as `localhost:3006`
