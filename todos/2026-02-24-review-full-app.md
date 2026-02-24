# Review: Full App — Main Branch
**Date:** 2026-02-24
**Reviewed by:** security-sentinel, performance-oracle, architecture-strategist, pattern-recognition-specialist, code-simplicity-reviewer, agent-native-reviewer

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 P1 Critical | 6 |
| 🟡 P2 Important | 8 |
| 🔵 P3 Nice-to-have | 5 |

---

## 🔴 P1 — Critical (address soon)

- `105` — **postMessage wildcard origin** exposes screenshots with hole cards to any iframe
- `106` — **PERSONA_RECOMMENDATION** relayed without action validation → real-money autopilot click risk
- `107` — **Image size** validated on base64 string length, not decoded bytes → Sharp memory exhaustion
- `108` — **Double JPEG decode** in `locateCards` — one full redundant decompress per 2s frame
- `109` — **`detectCards()` runs** in `/api/analyze` even when DOM cards + `heroPosition` already present
- `110` — **`/api/decision` silently discards** its payload despite JSDoc claiming "hand history logging"

---

## 🟡 P2 — Important

- `111` — Extension `setInterval` fires at **1000ms instead of 2000ms** — doubles traffic, same output
- `112` — **localStorage hand history is unbounded** — JSON.parse blocks main thread at scale
- `113` — **`parseDomCards`** is domain logic buried in the API route layer (layer violation)
- `114` — **Card-priority override logic duplicated** with divergent placeholder behaviour
- `115` — **`parseCard` / straight / flush counting duplicated** across hand-evaluator and equity module
- `116` — **Model IDs pinned to dated versions** in 2 files — will 503 when deprecated
- `117` — **No read API for hand records** — agents and tools cannot query history
- `118` — **No rate limiting** on Claude-calling routes — API key can be drained by loop

---

## 🔵 P3 — Nice-to-have

- `119` — `Street` type defined in 2 files with different members — import confusion risk
- `120` — `buildDetectionDetails` is a 27-LOC identity transform — premature normalization
- `121` — Preflop sentinel returns **FOLD with confidence 0** — semantically wrong, real-money footgun
- `122` — Extension API URLs **hardcode port 3006** — env var injection would be cleaner
- `123` — Extension message protocol has **no shared type definition** — silent rename mismatches

---

## What Already Works Well

- Secrets in macOS Keychain, no real keys in `.env.local`
- Every API route wraps `req.json()` in try/catch with Zod `safeParse` — no routes crash on bad input
- `escapeHtml()` applied consistently before `innerHTML` in overlay
- `crypto.randomUUID()` for all file IDs — no predictable filenames
- `AUTOPILOT_ACTION` protected by `isAutopilotAction()` enum guard before DOM execution
- State machine is clean pure-function reducer (forward-only, no backward transitions)
- Local decision engine (`rule-tree.ts`, `persona-selector.ts`) fully decoupled from AI
- DOM-card-as-ground-truth principle is architecturally sound
- Card detection pipeline (98%+ accuracy) is a solid foundation
- `detectingRef` mutex correctly prevents overlapping detection frames

---

## Agent Reports (raw)

- Security: `todos/2026-02-24-security-audit-full-codebase.md`
- Performance: `todos/2026-02-24-performance-review-continuous-capture-pipeline.md`
- Architecture: `todos/2026-02-24-architecture-review-full-system.md`
- Patterns: `todos/2026-02-24-code-pattern-review.md`
- Simplicity: `todos/2026-02-24-simplification-review.md`
- Agent-native: `todos/2026-02-24-agent-native-review.md`
