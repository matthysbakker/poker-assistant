---
status: pending
priority: p1
issue_id: "049"
tags: [code-review, security, xss, extension, overlay]
dependencies: []
---

# XSS via Unescaped postMessage Values in Overlay innerHTML

## Problem Statement

The extension overlay in `poker-content.ts` interpolates three postMessage-sourced values — `lastPersonaRec.name`, `lastPersonaRec.action`, `lastPersonaRec.temperature` — directly into a template literal assigned to `el.innerHTML` with no HTML escaping. The origin check correctly rejects cross-origin messages but does not protect against injection from the same origin. Any script at `localhost` can spoof the `source: "poker-assistant-app"` identifier. The same `el.innerHTML` template also interpolates DOM-scraped values (`state.handId`, `state.pot`, player names, actions) that reach the same injection point.

This runs on the Holland Casino poker page DOM — a real-money gambling platform. An XSS payload executing there can read session cookies and page contents.

## Findings

- `extension/src/poker-content.ts:718-738` — template literal with unescaped `lastPersonaRec.name`, `.action`, `.temperature` in `el.innerHTML`
- `extension/src/poker-content.ts:728-738` — same `el.innerHTML` block also interpolates `state.handId`, `state.pot`, `hero` (player cards), `board`, `actions`, `modeLabel`
- Same-origin spoof PoC: `window.postMessage({ source:"poker-assistant-app", type:"PERSONA_RECOMMENDATION", personaName:'<img src=x onerror=alert(1)>', ... }, window.location.origin)`
- A casino player whose username contains `<script>` would reach the scraping path injection point
- Security review (2026-02-23): rated CRITICAL

**Current `el.innerHTML` block:**
```typescript
el.innerHTML = `
  <div style="color:${modeColor};...>${modeLabel}</div>
  <div>Hand: ${state.handId || "—"}</div>
  <div>Hero: <b>${hero}</b></div>
  ...
  ${personaHtml}
`;
```

## Proposed Solutions

### Option A: Add `escapeHtml` and apply to every interpolated value (Recommended)

```typescript
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

Apply `escapeHtml()` to every dynamic value: `modeLabel`, `state.handId`, `hero`, `board`, `state.pot`, `actions`, `state.players.filter(...).length`, `lastPersonaRec.name`, `.action`, `.temperature`.

**Effort:** Small — add 1 helper function, wrap ~10 interpolated values
**Risk:** Low — text-only display, no legitimate HTML in any of these values

### Option B: Replace innerHTML with structured DOM API

Build the overlay using `document.createElement` + `node.textContent` instead of template literals. `textContent` assignment is immune to HTML injection by construction. No escaping function required.

**Effort:** Medium — rewrite `updateOverlay` (~40 lines)
**Risk:** Low but more churn

### Option C: Accept risk for personal single-developer use

Note explicitly in a code comment that the overlay is unescaped and safe only because persona names are static. Document that this must be fixed before broader distribution.

**Effort:** Zero
**Risk:** Ongoing — supply-chain compromise in any npm dep or future XSS anywhere in the Next.js app reaches the casino page

## Recommended Action

Option A. The `escapeHtml` helper is ~7 lines. Wrapping the interpolated values is mechanical. This is a real-money gambling page; the XSS surface should be closed even for personal use.

## Technical Details

- **Affected files:** `extension/src/poker-content.ts`
- **Lines:** 718-738 (`updateOverlay`), 150-155 (`PersonaRec` storage)
- **Components:** Extension overlay, monitor mode

## Acceptance Criteria

- [ ] `escapeHtml` helper added to `poker-content.ts`
- [ ] All dynamic values in `el.innerHTML` template wrapped with `escapeHtml()`
- [ ] `lastPersonaRec.name`, `.action`, `.temperature` all escaped before render
- [ ] DOM-scraped values (`handId`, `pot`, `hero`, `board`, `actions`) all escaped
- [ ] Manual test: inject `<img src=x onerror=alert(1)>` as persona name via postMessage — should render as literal text

## Work Log

- 2026-02-23: Identified by security-sentinel review of PR #8
