# Security Review: diff — preflop fast-path amount + leaf-span scraping
**Date:** 2026-02-24
**Reviewed by:** Security Audit Agent
**Scope:** Three hunks in extension/src/poker-content.ts
  1. `scrapeAvailableActions()` — leaf-span join (lines 368–386)
  2. `onDecisionReceived()` — stale pre-fetch guard (lines 1065–1074)
  3. `processGameState()` — preflop raise amount derivation (lines 1381–1400)

---

## Executive Summary

The diff introduces three changes. Two are low-risk improvements with narrow security surface. The third — the preflop raise amount derivation — carries a **MEDIUM severity** arithmetic flaw with a direct financial-loss vector: under specific pot/position conditions the computed raise size will be incorrect, causing the bot to open with a non-standard size in real-money play.

No new injection or remote-code-execution surface is introduced. The stale pre-fetch guard is sound. The leaf-span scraping is a net security improvement.

**Overall diff risk: MEDIUM** (one exploitable arithmetic issue, no new injection paths)

---

## Findings

---

### MEDIUM

#### DIFF-1 — BB derivation assumes SB+BB=1.5BB but this only holds when pot is exactly the starting pot

**File:** `extension/src/poker-content.ts`, lines 1389–1398

**Affected diff hunk:**
```typescript
const bb = pot / 1.5;
const multiplier = ["BTN", "CO"].includes(pos) ? 2.5 : 3.0;
preflopAmount = Math.round(bb * multiplier * 100) / 100;
```

**Description:**

The formula `bb = pot / 1.5` is only correct when the pot equals exactly 1 SB + 1 BB (i.e. 0.5×BB + 1×BB = 1.5×BB). This holds for UTG, MP, CO, BTN when no one has yet limped. It breaks in two realistic scenarios:

**Scenario A — Limpers before hero:**
If one or more players limp before action reaches hero, the pot is already enlarged: e.g. with two limpers the pot is 0.5 + 1 + 1 + 1 = 3.5×BB before hero acts. `pot / 1.5` returns 2.33×BB, and `2.33 × 3.0 = €7.00` instead of the correct 3×BB raise-to. The raise size will be inflated by the limp ratio.

However, the preflop fast-path already has this guard:
```typescript
const facingRaise = state.availableActions.some(
  (a) => a.type === "CALL" && parseFloat((a.amount ?? "0").replace(/[€$£,]/g, "")) > 0,
);
```
This guard skips the fast-path when hero faces a raise. But a **limp is not a raise** — with limpers the CALL action shows €0.00 (or no CALL) and CHECK is available (if hero is in BB) or RAISE is the only option. So `facingRaise` is `false` with limpers, and the fast-path still fires with the wrong pot denominator.

**Scenario B — SB completing in heads-up:**
In a 2-player game, `POSITIONS_BY_COUNT[2]` maps the BTN/SB to position 0. If the SB completes (calls the BB), the pot is 2×BB before hero (BB) acts. `pot / 1.5` returns 1.33×BB instead of 1×BB, and the raise amount is correspondingly wrong.

**Financial impact:**
- Open-raising 2.5×BB from CO when pot is already 2×BB (one limper) → the computed `bb` is 2/1.5 = 1.33×BB → raise = 3.3×BB instead of 2.5×BB. Hero over-bets by 32%.
- With two limpers the error compounds further.

**Severity:** MEDIUM — direct monetary impact in play mode on any hand with limpers or SB complete.

**Remediation options (in order of preference):**
1. Gate the fast-path raise on `!facingRaise && pot === expectedUnraisedPot` — i.e. verify that the pot equals exactly the expected preflop starting pot for the number of players (e.g. 1.5×BB for 3–6 handed). If the pot is larger, fall back to Claude.
2. Read the actual BB from the big-blind bet displayed in the DOM (`state.players` — find the player in BB position and read their `bet` field) rather than back-calculating from the pot.
3. Detect limpers by checking whether any active player's `bet` exceeds the BB amount and bail to Claude if true.

---

#### DIFF-2 — `preflopAmount` is not bounds-checked against available bet input min/max before execution

**File:** `extension/src/poker-content.ts`, lines 1398–1408

**Affected code (new):**
```typescript
preflopAmount = Math.round(bb * multiplier * 100) / 100;
...
safeExecuteAction(
  { action: personaAction, amount: preflopAmount, reasoning: `Preflop chart: ...` },
  "local",
);
```

**Description:**

The RAISE/BET path in `executeAction()` has a post-delay bounds check (lines 983–995) that validates `decision.amount` against `betInput.min` and `betInput.max`. However, the fast-path fires `safeExecuteAction()` immediately, before any humanisation delay, which means this bounds check runs while the bet input _is_ present. That part is fine.

The problem is that the fast-path fires at the **rising edge of hero's turn** (line 1333), which is detected via a DOM mutation. The actions area DOM is not guaranteed to be fully rendered when the mutation fires — Playtech may animate the action buttons into view over several frames. If `executeAction()` runs before the bet input is rendered, `document.querySelector(".betInput, [data-bet-input]")` returns `null` and the code path aborts (lines 985–988):

```typescript
if (!betInput) {
  console.warn("[Poker] Bet input gone after delay — aborting raise");
  return;
}
```

So the raise is silently dropped with no fallback. The `executing` flag is cleared in the `finally` block, but the hero takes no action — they rely on the browser timer to expire, then the watchdog fires FOLD.

**Financial impact:** Hero folds instead of raising when the fast-path fires slightly before the bet input renders. This is a rare timing race, but with a 200ms debounce the mutation could fire before the animation completes.

**Severity:** MEDIUM (timing race → unintended fold in play mode)

**Remediation:** When the bet input is missing in the RAISE/BET path, retry after a short delay (e.g. 100ms) rather than immediately aborting. A simple retry loop with a max of 3 attempts and 100ms spacing would cover the animation window without risking a stale DOM.

---

### LOW

#### DIFF-3 — Leaf-span join can produce multi-token `text` that bypasses action-type classification

**File:** `extension/src/poker-content.ts`, lines 375–387

**Affected diff hunk:**
```typescript
const deduped = leafTexts.filter((t, i) => i === 0 || t !== leafTexts[i - 1]);
const fallbackText = btn.textContent?.trim() ?? "";
let text = deduped.join(" ") || fallbackText;
if (!text || text.includes("/")) return;
```

**Description:**

The old code broke at the first leaf span and used that text. The new code joins _all_ leaf span texts, deduplicated, with spaces. This is correct for split labels like `["Raise To", "€1.25"]` → `"Raise To €1.25"`.

However, if Playtech renders a button with three leaf spans — for example `["Raise", "To", "€1.25"]` — the joined text is `"Raise To €1.25"`, which still starts with "raise" and is correctly classified. This is benign.

The edge case: if a future Playtech update renders a button whose first leaf span is NOT the action keyword (e.g. an icon label first: `["⬆", "Raise", "€1.25"]` → `"⬆ Raise €1.25"`), the `lowerText.startsWith("raise")` check fails and the button is silently ignored. Hero would have no RAISE option, potentially causing Claude to fall back to CHECK/CALL.

**Financial impact:** Low — classification failure produces a conservative fallback (CHECK/CALL), not an incorrect aggressive action.

**Severity:** LOW — defensive concern, not currently exploitable.

**Remediation:** Consider using `lowerText.includes("raise")` instead of `startsWith` for robustness, or test the joined text against a broader set of Playtech button label patterns before committing to the `startsWith` approach.

---

#### DIFF-4 — `deduped` consecutive filter may not remove non-adjacent duplicates (Playtech aria pattern)

**File:** `extension/src/poker-content.ts`, line 384

**Affected code:**
```typescript
const deduped = leafTexts.filter((t, i) => i === 0 || t !== leafTexts[i - 1]);
```

**Description:**

The deduplication removes only _consecutive_ identical entries. Playtech's aria duplication pattern ("Fold", "Fold") is consecutive, so it is correctly handled. If Playtech ever interleaves duplicates non-consecutively — e.g. `["Raise", "To", "Raise"]` — the last "Raise" is not removed and the joined text becomes `"Raise To Raise €1.25"`, which still starts with "raise" and classifies correctly. No security impact.

**Severity:** LOW — informational.

---

#### DIFF-5 — Stale pre-fetch guard is play-mode-only, but play mode also calls `safeExecuteAction()` from the fast-path

**File:** `extension/src/poker-content.ts`, lines 1070–1074

**Affected code:**
```typescript
if (autopilotMode === "monitor" && preflopFastPathFired) {
  console.log("[Poker] [MONITOR] Discarding stale pre-fetch...");
  executing = false;
  return;
}
safeExecuteAction(action, "claude");
```

**Description:**

The stale pre-fetch guard only fires in `monitor` mode. In `play` mode, if `preflopFastPathFired` is true and a Claude response arrives (stale pre-fetch), `safeExecuteAction(action, "claude")` is called — potentially executing a second action after the fast-path already acted.

In practice this is mitigated by the `executing` flag: the fast-path sets `executing = true` before `safeExecuteAction()` (line 1383), and `requestDecision()` checks `if (executing) return` (line 807). So the pre-fetch was already blocked from being sent when `preflopFastPathFired` is true if the fast-path set `executing` first.

However, the pre-fetch is fired at hand-start (line 1325), _before_ the fast-path fires at hero's turn. At hand-start, `executing` is `false`. The race is: pre-fetch API call takes N seconds; hero's turn fires at M seconds; fast-path executes at M; Claude's response arrives at M+delta. At M+delta, `executing` is `false` again (cleared by `safeExecuteAction → executeAction → finally`), so `onDecisionReceived()` proceeds and calls `safeExecuteAction()` a second time.

This is the exact scenario the new guard prevents in monitor mode, but the same race exists in play mode. The guard's condition `autopilotMode === "monitor"` means play mode is unprotected.

**Financial impact:** MEDIUM in play mode — hero takes two actions in the same betting round if the Claude response arrives after the fast-path has already acted and cleared `executing`. The second action would be a CHECK or CALL (the stale Claude advice for preflop), executed when action is no longer to hero — which most poker clients silently ignore (the buttons are gone), but represents a logic error and a DOM click on stale buttons.

**Severity:** MEDIUM (the guard is correct for monitor mode but incomplete — play mode has the same race)

**Remediation:** Remove the `autopilotMode === "monitor"` condition. The guard `if (preflopFastPathFired)` is sufficient on its own — discard the stale pre-fetch in _both_ modes when the fast-path has already acted.

---

## Security Requirements Checklist (diff-scoped)

- [x] No new injection surface introduced by leaf-span join — text is DOM-sourced, goes through `escapeHtml()` for display, and only classified against a fixed enum for action type
- [x] Amount derivation does not introduce hardcoded credentials or secrets
- [ ] Arithmetic correctness of `bb = pot / 1.5` — FAILS for limped pots (DIFF-1)
- [ ] Pre-fetch guard completeness — FAILS for play mode (DIFF-5)
- [x] No new `innerHTML` injection vectors — all paths through the existing `escapeHtml()` overlay builder
- [x] No new cross-origin or postMessage surface
- [x] `preflopFastPathFired` flag reset on new hand (line 1305) — PASS

---

## Risk Matrix

| ID     | Severity | Description                                                       | Financial Loss Risk |
|--------|----------|-------------------------------------------------------------------|---------------------|
| DIFF-1 | MEDIUM   | BB back-calculation incorrect with limpers or SB complete         | HIGH — wrong raise size in play mode on limped pots |
| DIFF-2 | MEDIUM   | Bet-input-not-found aborts raise with no retry → watchdog folds   | MEDIUM — unintended fold on animation timing race |
| DIFF-5 | MEDIUM   | Stale pre-fetch guard missing in play mode                        | MEDIUM — double-action race in play mode |
| DIFF-3 | LOW      | First-leaf-not-keyword edge case misclassifies action             | LOW — conservative fallback only |
| DIFF-4 | LOW      | Non-adjacent duplicate leaf texts not removed                     | NONE — no classification impact |

---

## Remediation Roadmap

### Before enabling play mode with this diff

1. **DIFF-5** — Remove `autopilotMode === "monitor" &&` from the stale pre-fetch guard. The `preflopFastPathFired` flag alone is the correct condition. One-line change.

2. **DIFF-1** — Add a limper-detection guard before computing `preflopAmount`. The simplest heuristic: if `parseCurrency(state.pot) > expectedUnraisedPot` (where `expectedUnraisedPot = 1.5 × inferredBB`), bail to Claude. Alternatively, derive BB from the BB player's `bet` field in `state.players` directly.

### Short-term

3. **DIFF-2** — Add a retry loop (max 3 × 100ms) in `executeAction()` when `betInput` is null on the RAISE/BET path, rather than immediately aborting.

---

## Passed / No Action Needed (this diff)

- **XSS in leaf-span path:** The joined `text` value flows into `label: text` in `ActionOption`, which is displayed via `escapeHtml(state.availableActions.map((a) => a.label).join(" | "))` in `updateOverlay()`. No raw HTML injection.
- **Action classification from joined text:** Classification is `lowerText.startsWith(...)` against fixed strings — the join does not widen the classification surface.
- **`/` filter for pre-action toggles:** Still correctly applied after the join at line 387.
- **`preflopFastPathFired` reset:** Correctly reset to `false` on new hand at line 1305. No state leak between hands.
- **`executing` mutex on fast-path:** Correctly set to `true` before `safeExecuteAction()` at line 1383, preventing concurrent Claude requests from proceeding during fast-path execution.
