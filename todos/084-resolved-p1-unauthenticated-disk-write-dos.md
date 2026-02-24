---
status: pending
priority: p1
issue_id: "084"
tags: [code-review, security, performance]
dependencies: []
---

# Unauthenticated /api/analyze Writes to Disk — DoS Risk

## Problem Statement

`/api/analyze` has no authentication and no rate limiting. On every POST, it writes up to 10 MB of attacker-controlled binary data to `test/captures/`, and when `SAVE_HANDS=true` (the current `.env.local` default), it also writes `.json` + `.png` to `data/hands/`. Any process that can reach the dev server can exhaust disk in minutes.

## Findings

- `app/api/analyze/route.ts:76-80` — captures written to `test/captures/` on every request, guarded only by `SAVE_CAPTURES !== 'false'` (opt-out default)
- `app/api/analyze/route.ts:106-142` — hand records (JSON + screenshot PNG) written when `SAVE_HANDS=true`
- No `Authorization` header check, no session cookie, no IP-based rate limit
- Write errors are swallowed silently via `.catch(() => {})` — silent data loss with no visibility
- Zod limits image field to 10 MB per request; an attacker can loop requests to multiply this
- The captures write path is the most exposed: it runs even before AI analysis, so the cost is low per request

## Proposed Solutions

### Option 1: Network-level protection (Recommended for dev-only tool)

**Approach:** Since this is a localhost dev tool, add a middleware or env-var guard that only allows requests from `127.0.0.1`. Reject all other origins with 403.

**Pros:**
- Zero-friction for the intended use case (local only)
- Simple to implement

**Cons:**
- Breaks if the tool is ever shared on a LAN
- Does not add rate limiting

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Add rate limiting via `next-rate-limit` or in-memory counter

**Approach:** Implement a per-IP request rate limiter (e.g., max 30 req/min) in the route handler.

**Pros:**
- Works even if the server is network-accessible
- Limits disk write rate

**Cons:**
- Adds a dependency
- More complex

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 3: Make capture writes opt-in and add basic auth token

**Approach:** Change `SAVE_CAPTURES` to opt-in (`=== 'true'`), add a simple `ANALYZE_TOKEN` env var checked on every POST, and surface write errors in the response.

**Pros:**
- Addresses root cause (opt-in default + auth)
- Write errors visible to caller

**Cons:**
- Requires setting token in extension/page

**Effort:** 1 hour

**Risk:** Low

---

## Recommended Action

**To be filled during triage.** For a local-only dev tool, Option 1 (localhost-only guard) combined with making `SAVE_CAPTURES` opt-in is the simplest fix.

## Technical Details

**Affected files:**
- `app/api/analyze/route.ts:76-80` — capture write path
- `app/api/analyze/route.ts:106-142` — hand record write path

**Related components:**
- `lib/storage/hand-records.ts` — `writeHandRecord()`

## Resources

- **PR:** #12

## Acceptance Criteria

- [ ] `/api/analyze` rejects requests from non-localhost origins, OR has rate limiting, OR has token auth
- [ ] `SAVE_CAPTURES` default changed to opt-in
- [ ] Write errors surfaced (not silently swallowed)

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (security-sentinel agent)

**Actions:**
- Identified unauthenticated disk write surface during PR #12 security review
