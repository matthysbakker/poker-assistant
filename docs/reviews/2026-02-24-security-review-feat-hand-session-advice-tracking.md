# Security Review: feat/hand-session-advice-tracking (PR #12)
**Date:** 2026-02-24
**Branch:** feat/hand-session-advice-tracking
**Reviewed by:** Security Audit Agent

---

## Executive Summary

PR #12 adds six new metadata fields to HandRecord (sessionId, pokerHandId, tableTemperature, tableReads, heroPositionCode, personaSelected) and wires them through the capture pipeline. The PR is a single-user, local-first tool with no auth and no database, which explains many accepted risks. However, two issues are critical and require immediate action before any deployment: a plaintext API key committed to .env.local, and unrestricted filesystem writes triggered by unauthenticated HTTP requests.

---

## Critical Issues

- [ ] **[P1] Anthropic API key committed in plaintext to .env.local**
  File: `/Users/matthijsbakker/Bakery/poker-assistant/.env.local:1`
  A real, live Anthropic API key (sk-ant-api03-Mz6qsSY5...) is present in .env.local. While .env.local is listed in .gitignore (line 34: `.env*`), the gitignore pattern covers git commits only. It does not protect against the file being present on disk, leaked via dev tooling, accidentally staged, or exposed if the .gitignore rule is ever overridden. The key must be rotated immediately.
  **Impact:** Direct financial exposure; API abuse by any party with filesystem or repo access.

- [ ] **[P1] Unauthenticated endpoint triggers arbitrary filesystem writes (disk DoS)**
  File: `/Users/matthijsbakker/Bakery/poker-assistant/app/api/analyze/route.ts:76-80, 106-142`
  The /api/analyze endpoint has zero authentication. When SAVE_CAPTURES is not set to "false", the server writes attacker-controlled binary data (up to the 10 MB Zod limit per request) to test/captures/ on every POST. When SAVE_HANDS=true, it writes both a .json and a .png file to data/hands/. There is no rate limiting and no per-caller quota. An attacker on the local network (or any network if Next.js is not bound to localhost) can loop POST requests to exhaust disk space. The captures branch swallows all errors silently (.catch(() => {})).
  **Impact:** Denial of service via disk exhaustion; silent failure masking.

---

## High Priority

- [ ] **[P2] handContext and opponentHistory have no length limits**
  File: `/Users/matthijsbakker/Bakery/poker-assistant/app/api/analyze/route.ts:39` and `20-23`
  `handContext` is validated as `z.string().optional()` with no `.max()`. opponentHistory entries contain `actions: z.array(z.string())` with no array length cap and no per-string `.max()`. Both are concatenated verbatim into the Claude prompt in `lib/ai/analyze-hand.ts:38-43`. A crafted request with megabyte-scale handContext or thousands of action strings will result in a large, expensive Claude call billed to the owner. In continuous mode this fires every 2 seconds.
  **Impact:** Unbounded Anthropic API cost; prompt injection surface.

- [ ] **[P2] sessionId and pokerHandId accept arbitrary strings with no UUID validation**
  File: `/Users/matthijsbakker/Bakery/poker-assistant/app/api/analyze/route.ts:42-43`
  Both fields are `z.string().optional()` / `z.string().nullable().optional()` with no format constraint. These values are written directly into persistent JSON hand records on disk. A caller can supply adversarial strings (traversal attempts like `../../`, embedded newlines, or JSON-breaking sequences). While the value is serialized as a JSON string value rather than a filename, it corrupts analytics output and could cause unexpected behavior in tooling that later processes these strings as identifiers.
  **Impact:** Analytics data poisoning; potential downstream injection in tooling that processes stored records.

- [ ] **[P2] personaSelected sub-fields are free strings with no allowlist or length cap**
  File: `/Users/matthijsbakker/Bakery/poker-assistant/app/api/analyze/route.ts:47-55`
  personaId, personaName, and action inside personaSelected are `z.string()` without length caps or enum constraints. These are stored in hand records and displayed via `scripts/query-hands.ts:116`. Oversized strings or ANSI-escape-laden values could cause terminal display corruption. More critically, there is no server-side check that personaId corresponds to an actual persona — callers can write fabricated persona records into the analytics store.
  **Impact:** Analytics integrity corruption; minor terminal injection risk via query script output.

- [ ] **[P2] postMessage handler passes unvalidated base64 directly to the API**
  File: `/Users/matthijsbakker/Bakery/poker-assistant/app/page.tsx:57-64`
  The message handler correctly checks `event.origin` and `event.data.source`. However, `event.data.base64` is used directly as imageBase64 with no client-side size check or format validation before being passed to `setImageBase64`, which triggers `submit()` to the API. The 10 MB guard lives only in the server-side Zod schema. Any script running in the same origin (for example, injected content from a poker site loaded in an iframe, or a malicious browser extension with content scripts) could craft a CAPTURE message and trigger repeated expensive API calls with arbitrary payloads.
  **Impact:** Same-origin scripts can trigger unbounded API calls; bypasses client-side size guard.

---

## Medium Priority

- [ ] **[P3] SAVE_CAPTURES is opt-out not opt-in — screenshot data written to disk by default**
  File: `/Users/matthijsbakker/Bakery/poker-assistant/app/api/analyze/route.ts:76`
  Captures are saved unless `SAVE_CAPTURES === "false"`. In any environment where the env var is not explicitly set, every analyzed screenshot is persisted to disk. Screenshots may contain sensitive poker account details (username, balance, hand history). The safer default is opt-in (`SAVE_CAPTURES === "true"`).
  **Impact:** Unintended data retention; privacy concern for sensitive screen content.

- [ ] **[P3] crypto.randomUUID() called without explicit SSR guard**
  File: `/Users/matthijsbakker/Bakery/poker-assistant/lib/storage/sessions.ts:40`
  `createSession()` calls `crypto.randomUUID()` without checking `typeof window`. While Next.js 15+ Node.js ships with `crypto.randomUUID()`, if this code path runs in a test runner or a restricted edge runtime lacking the Web Crypto global, it will throw. The guard at `app/page.tsx:27` partially protects this by returning early from getSession during SSR, but createSession can still be reached server-side if that guard is removed in the future.
  **Impact:** Low risk; environment compatibility caveat; could break in edge runtimes.

- [ ] **[P3] query-hands.ts loads disk records with JSON.parse cast and no schema validation**
  File: `/Users/matthijsbakker/Bakery/poker-assistant/scripts/query-hands.ts:36`
  Records are loaded as `JSON.parse(raw) as HandRecord` with no Zod safeParse. The new fields (tableTemperature, personaSelected, etc.) are accessed with non-null assertions at lines 205 and 218. A manually edited or tampered record will cause the script to crash or silently misreport. This is a developer script, but it processes data written by an unauthenticated endpoint.
  **Impact:** Script robustness; tampered records written by malicious requests will cause crashes rather than graceful skips.

- [ ] **[P3] Raw API error message rendered verbatim in the UI**
  File: `/Users/matthijsbakker/Bakery/poker-assistant/components/analyzer/AnalysisResult.tsx:133`
  `{error.message}` is rendered directly. React escapes the output so XSS is not possible. However, Anthropic API errors may include internal context (model name, request ID, rate limit state, account tier). In a single-user local tool this is low risk, but worth noting if the app is ever shared.
  **Impact:** Minor information leakage from upstream API error messages.

---

## Passed / No Action Needed

- **Zod enum constraints on new fields:** tableTemperature uses a proper z.enum of 6 known values. heroPositionCode uses positionSchema enum. Both are validated before any processing.
- **No SQL injection surface:** No database. All storage is filesystem JSON.
- **No XSS from new fields:** query-hands.ts writes to stdout only. captureContext fields are never rendered to the DOM.
- **No credentials in the PR diff itself:** The API key finding is pre-existing. The new PR fields introduce no new credentials.
- **Record IDs are server-generated:** handId at route.ts:108 is generated server-side via `crypto.randomUUID()`, not taken from the request. File paths use this server-generated UUID, preventing path traversal via client-supplied identifiers.
- **data/hands/ is gitignored:** Saved hand records (screenshot data and poker strategy) are excluded from version control at .gitignore:61.
- **pokerHandId generation logic is safe:** UUID is generated only on a confirmed WAITING->PREFLOP transition at state-machine.ts:143-146. There is no path for a client to force re-generation.
- **Forward-only state machine:** Cannot be manipulated via the new context fields to reset or replay hand state.
- **CORS:** No wildcard CORS headers added by this PR.

---

## Risk Matrix

| ID  | Severity     | Title                                                             | File:Line                        |
|-----|--------------|-------------------------------------------------------------------|----------------------------------|
| F1  | P1 Critical  | API key committed in .env.local                                   | .env.local:1                     |
| F2  | P1 Critical  | Unauthenticated endpoint drives filesystem writes / disk DoS      | route.ts:76-80, 106-142          |
| F3  | P2 High      | Unbounded handContext / actions array -> API cost amplification   | route.ts:39, analyze-hand.ts:38  |
| F4  | P2 High      | sessionId / pokerHandId accept arbitrary strings                  | route.ts:42-43                   |
| F5  | P2 High      | personaSelected sub-fields are free strings with no allowlist     | route.ts:47-55                   |
| F6  | P2 High      | postMessage passes unvalidated base64 to API                      | page.tsx:57-64                   |
| F7  | P3 Medium    | SAVE_CAPTURES opt-out default; screenshots persisted by default   | route.ts:76                      |
| F8  | P3 Medium    | crypto.randomUUID() SSR compatibility caveat                      | sessions.ts:40                   |
| F9  | P3 Medium    | query-hands.ts loads records without schema validation            | scripts/query-hands.ts:36        |
| F10 | P3 Medium    | Raw API error message rendered in UI                              | AnalysisResult.tsx:133           |

---

## Remediation Roadmap

### Immediate (before any non-local use)

1. **Rotate the Anthropic API key** via the Anthropic console. The exposed key prefix is sk-ant-api03-Mz6qsSY5 at `.env.local:1`.

2. **Add a lightweight caller check to /api/analyze.** Minimum viable: validate a shared-secret header (`X-Internal-Key`) matched against a value in .env.local, and reject requests without it. This stops any LAN or internet attacker from triggering disk writes or API calls.

3. **Add `.max()` to handContext** (`z.string().max(5000).optional()`) and cap opponentHistory actions (`z.array(z.string().max(200)).max(20)`) in the Zod request schema.

### Short-term (next sprint)

4. **Validate sessionId and pokerHandId as UUIDs:** Change to `z.string().uuid().optional()` and `z.string().uuid().nullable().optional()`.

5. **Constrain personaSelected sub-fields:** Add `.max(64)` to personaId, personaName, and action. Optionally validate personaId against a server-side set of known persona IDs.

6. **Validate base64 size client-side** in the postMessage handler before calling setImageBase64. Check `event.data.base64.length > 14_000_000` (14M base64 chars is approximately 10 MB decoded) and discard oversized messages.

7. **Flip SAVE_CAPTURES to opt-in:** Change `process.env.SAVE_CAPTURES !== "false"` to `process.env.SAVE_CAPTURES === "true"` at route.ts:76.

### Backlog

8. **Add Zod safeParse in query-hands.ts** when loading disk records to handle schema evolution gracefully and surface tampered or corrupted records without crashing.

9. **Wrap error.message in AnalysisResult.tsx** with a generic fallback string rather than rendering the raw upstream error message.

10. **Consider a simple in-memory rate limiter** on /api/analyze (for example a token bucket of 1 request per second) to bound API spend even without full authentication.
