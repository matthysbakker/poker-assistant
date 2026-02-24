# Review: poker-content.ts diff (preflopFastPathFired + scrapeAvailableActions + suit tags + BB raise calc)
**Date:** 2026-02-24
**Reviewed by:** Kieran (TypeScript review agent)
**File:** extension/src/poker-content.ts

---

## Critical Issues

- [ ] **Double `parseCurrency(state.pot)` call in `bbTag` computation (line ~1401–1403)**
  `parseCurrency(state.pot)` is called a third time inside the `bbTag` ternary even though `pot` is already in scope.
  This is harmless but signals a copy-paste from `preflopAmount`'s block. The `pot` local variable from
  the enclosing `if (personaAction === "RAISE" || ...)` block is not in scope here (it's inside a nested `if (pot > 0)`).
  The outer `bbTag` block needs to re-derive pot because `pot` was declared inside the RAISE guard.
  Fix: hoist `pot` before the `if (personaAction === ...)` guard, or compute `bbTag` inside the same scope.

- [ ] **`preflopFastPathFired` set twice for the same fast-path invocation**
  At line ~1383, `preflopFastPathFired = true` is assigned inside the `state.isHeroTurn` block.
  At line ~1384 in the same diff hunk, `executing = true` is set. But `preflopFastPathFired` was also
  already added at the module-level variable site and reset on new hand — that part is correct.
  The issue: the guard at `onDecisionReceived` (line ~1070) only checks `autopilotMode === "monitor"`.
  In **play** mode, a pre-fetch is never triggered (`requestDecision` is not called at hand start for
  play mode), so `preflopFastPathFired` in play mode will always be false when `onDecisionReceived` fires.
  The guard condition is therefore safely mode-scoped, but the comment "prevents stale Claude pre-fetch
  overwriting it" is only correct for monitor mode. In play mode the flag is set but never read. This
  is not a bug, but it is misleading — the comment on the variable declaration should say so.

## High Priority

- [ ] **`SUIT_NAMES` constant defined inside `buildHandStartMessage` — should be module-level**
  `SUIT_NAMES` is declared with `const` on every call to `buildHandStartMessage`. It is a pure
  static lookup table with no runtime dependencies. Placing it inside the function allocates a new
  object on every invocation. The existing `SUIT_MAP` constant at the top of the file (line 66)
  already establishes the pattern for module-level static lookup tables — `SUIT_NAMES` should follow it.

  ```typescript
  // Before (inside buildHandStartMessage — allocates on every call)
  const SUIT_NAMES: Record<string, string> = { d: "diamonds", h: "hearts", s: "spades", c: "clubs" };

  // After (module-level, alongside SUIT_MAP)
  const SUIT_NAMES: Record<string, string> = { d: "diamonds", h: "hearts", s: "spades", c: "clubs" };
  ```

- [ ] **BB derivation assumes SB always posts exactly 0.5 BB — fragile assumption**
  `const bb = pot / 1.5` assumes the pot entering the preflop fast-path is always `SB + BB = 1.5 BB`.
  This breaks silently in three real situations:
  1. Antes: pot = SB + BB + N_antes → BB is under-estimated, raise size is too small.
  2. Straddle: pot = SB + BB + straddle → BB is under-estimated.
  3. Hero is SB completing (limping): pot may already have additional callers before action reaches hero.
  The function returns `null` when `pot <= 0`, so it won't produce negative values, but it will produce
  a wrong number without any log warning. At minimum, add a console note when the derived BB differs
  significantly from what the UI slider shows, or document the known limitation inline.

- [ ] **`activePlayers` is computed twice within the preflop fast-path block**
  Once at line ~1393 (inside the RAISE guard) and again — implicitly — at `getPosition` which also
  receives `activePlayers.length`. But `activePlayers` from the outer `if (state.isHeroTurn ...)` block
  at line ~1317 is already computed and available. The inner re-computation shadows/duplicates it.
  This is a minor inefficiency but also a readability problem: a reader cannot tell at a glance whether
  both computations are identical or intentionally different.

  ```typescript
  // Outer scope (line ~1317) — already has activePlayers
  const activePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);

  // Inner scope (line ~1393) — redundant re-computation
  const activePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);
  ```
  The inner `const activePlayers` will shadow the outer one in the RAISE block. This is fine in JS
  but should be removed — hoist `pos` computation above the RAISE guard and reuse the outer variable.

- [ ] **`bbTag` is computed outside the `if (pot > 0)` guard but depends on it**
  ```typescript
  let preflopAmount: number | null = null;
  if (personaAction === "RAISE" || personaAction === "BET") {
    const pot = parseCurrency(state.pot);
    if (pot > 0) {
      ...
      preflopAmount = Math.round(bb * multiplier * 100) / 100;
    }
  }
  const bbTag = preflopAmount != null && parseCurrency(state.pot) > 0
    ? ` (${(preflopAmount / (parseCurrency(state.pot) / 1.5)).toFixed(1)}BB)`
    : "";
  ```
  When `pot <= 0`, `preflopAmount` remains `null` and `bbTag` correctly becomes `""`. But the guard
  `preflopAmount != null && parseCurrency(state.pot) > 0` is redundant — if `preflopAmount != null` then
  `pot` was already proven `> 0` in the guard that set it. The second `parseCurrency(state.pot)` call
  is dead. Simplify:
  ```typescript
  const bbTag = preflopAmount != null
    ? ` (${(preflopAmount / (parseCurrency(state.pot) / 1.5)).toFixed(1)}BB)`
    : "";
  ```
  Note: `parseCurrency(state.pot)` still runs once here (unavoidable since `pot` is out of scope), but
  the explicit re-guard is unnecessary noise.

## Low Priority / Nice-to-Have

- [ ] **`deduped` variable name is accurate but the algorithm has an edge case**
  `leafTexts.filter((t, i) => i === 0 || t !== leafTexts[i - 1])` deduplicates consecutive identical
  entries. This works correctly for the documented Playtech aria duplication pattern ("Fold","Fold").
  However, a button with genuinely non-consecutive identical parts ("Raise","€1.25","Raise") would
  keep both "Raise" strings. That is unlikely in practice but worth a comment documenting the
  assumption: "deduplicates adjacent duplicates only (Playtech aria pattern)".

- [ ] **`PersonaRec` is initialised without `rotated` and `allPersonas` in the `PERSONA_RECOMMENDATION` message handler (line ~179)**
  ```typescript
  lastPersonaRec = {
    name: message.personaName,
    action: message.action,
    temperature: message.temperature,
    // rotated and allPersonas are missing
  };
  ```
  TypeScript should catch this as a type error since `PersonaRec` requires those fields. If it does not
  (perhaps because `PersonaRec` is not used as a strict assignment target), this is a latent runtime
  bug where `allPersonas` would be `undefined` and the overlay's `lastPersonaRec.allPersonas.length`
  check (line ~1137) would throw. This predates the diff but is worth flagging since the diff adds more
  reads of `allPersonas`.

- [ ] **`scrapeAvailableActions` change: the `break` removal is a behaviour change, not just a refactor**
  The old code `break`-ed after finding the first leaf span. The new code collects ALL leaf spans.
  The comment explains the intent (capture split labels like "Raise To €1.25"), but consider whether
  a button with a genuine deep span tree could now collect unexpected inner content. The guard
  `s.querySelector("span") === null` correctly limits to leaves, so this is safe — but it is worth
  noting in the comment that this is an intentional behaviour change, not just a style cleanup.

- [ ] **Magic number `1.5` appears three times in the new raise block**
  The comment explains it (`SB + BB = 1.5 × BB`), but if antes are ever supported the constant will
  need updating in three places. Extract to a named constant:
  ```typescript
  const PREFLOP_POT_TO_BB_RATIO = 1.5; // SB(0.5) + BB(1.0) in an unraised pot with no antes
  ```

## Passed / No Action Needed

- The `preflopFastPathFired = false` reset in the new-hand detection block (line ~1305) is correctly
  placed alongside all other hand-level state resets. No issue.
- The guard added to the monitor-mode pre-fetch (`state.heroCards.length === 2`) is a legitimate
  correctness fix — previously a pre-fetch could fire with 0 cards visible. Good.
- The `onDecisionReceived` early-return guard is correctly placed after the watchdog cancellation and
  before `safeExecuteAction`, so the watchdog is always cancelled even for discarded pre-fetches. Good.
- `parseCurrency` correctly returns 0 for empty/null/NaN, so `pot / 1.5` cannot produce Infinity or
  NaN when guarded by `if (pot > 0)`. The arithmetic is sound.
- The suit tag change from `" (suited)"/"(offsuit)"` to `" — SUITED (both diamonds)"` is cosmetic and
  does not affect logic. The fallback `?? c1.slice(-1)` for unknown suits is defensive and correct.
- The `SUIT_NAMES` lookup uses single-character keys matching the suffix of `parseCardFromSvg` output
  (`[cdhs]`), which is consistent with the card format used throughout. No type safety gap.
- `Math.round(bb * multiplier * 100) / 100` produces a value rounded to the nearest cent. Correct
  approach for currency arithmetic at this scale.
- The `pos === "BTN/SB"` → `"BTN"` normalisation before the multiplier lookup mirrors the same
  pattern already used in `localDecide`. Consistent.
