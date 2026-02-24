# Review: feat/local-poker-decision-engine
**Date:** 2026-02-24
**Reviewed by:** Kieran (TypeScript review agent)
**Scope:** lib/poker/exploit.ts, lib/poker/rule-tree.ts, lib/poker/hand-evaluator.ts,
           lib/poker/board-analyzer.ts, lib/poker/equity/*, extension/src/poker-content.ts

---

## Critical Issues

- [ ] **exploit.ts:67 — `Record<string, ConfidenceDeltas>` accepts any string key, masking typos silently**
  The DELTAS map should be typed as `Partial<Record<OpponentType, ConfidenceDeltas>>` once an
  `OpponentType` union type is defined. Currently `DELTAS["LOSEE_PASSIV"]` returns `undefined`
  at runtime (handled correctly by the null guard at line 104), but TypeScript will never catch
  the misspelling at the call site. This is a known class of footgun: the key type for DELTAS
  should mirror the same string literal union used on `applyExploitAdjustments`.

- [ ] **exploit.ts:92 — `opponentType: string | undefined` is too loose**
  The type should be a proper string literal union (e.g. `"LOOSE_PASSIVE" | "TIGHT_PASSIVE" |
  "LOOSE_AGGRESSIVE" | "TIGHT_AGGRESSIVE" | "UNKNOWN" | undefined`), not raw `string`. The
  function internally normalises with `.toUpperCase()` and then looks up DELTAS, so it already
  treats the string as one of a known set. The signature should reflect that constraint.
  As-is, TypeScript will silently accept any arbitrary string from callers.

- [ ] **rule-tree.ts:46 — Same loose `string` type for `opponentType` propagates to the interface**
  `RuleTreeInput.opponentType?: string` inherits the same problem. Defining a shared
  `OpponentType` literal union in a types module and using it here and in exploit.ts would
  close the type gap entirely.

---

## High Priority

- [ ] **poker-content.ts:90 / 670 — `lastTableTemperature` is never reset on new hand**
  In the new-hand reset block (line 1161–1170), `lastPersonaRec`, `lastClaudeAdvice`, and
  `monitorAdvice` are all cleared. `lastTableTemperature` is not. This means the exploit layer
  will continue using temperature data from a previous session's stat scrape for every new hand
  until `requestPersona()` runs again. If the table composition changes mid-session (a player
  leaves, a new one sits), the stale temperature will silently persist. The new-hand block at
  line 1159 should reset `lastTableTemperature = null` if table stats should be re-evaluated
  per hand, or at minimum reset `handsObserved` to prevent full-confidence exploit decisions
  using a single scrape.

- [ ] **poker-content.ts:517 — `opponentTypeFromTemperature` silently returns `undefined` for
  "balanced" and "unknown"**
  The function uses `Partial<Record<...>>` intentionally for those two values, but the
  omission is not documented at the call site. A reader seeing `opponentTypeFromTemperature`
  invoked at line 736 has no indication that two of six possible inputs will produce
  `undefined` (which propagates as no exploit adjustment). The design is defensible but should
  carry a JSDoc comment explaining the deliberate omission: "balanced and unknown → undefined
  → no exploit overlay applied."

- [ ] **poker-content.ts:492 — Non-null assertion `s.vpip!` inside `.reduce()`**
  Line 492: `withVpip.reduce((sum, s) => sum + s.vpip!, 0)`.
  `withVpip` is already filtered to `s.vpip !== null`, so the assertion is logically safe, but
  the pattern is fragile — if the filter criterion changes, the assertion becomes a hidden
  `null` dereference. Use `s.vpip ?? 0` instead to remove the non-null assertion entirely
  without losing safety.

- [ ] **poker-content.ts:497 — Same non-null assertion `s.af!` in AF reduce**
  Same issue on line 497. Replace with `s.af ?? 0`.

- [ ] **hand-evaluator.ts:55–56 / equity/outs.ts:16–17 — Module-level mutable shared buffers
  are not concurrency-safe**
  `_rankCounts`, `_suitCounts` are module-level `Uint8Array` instances shared across all
  callers. In a single-threaded browser extension this is safe. However, `hand-evaluator.ts`
  has TWO functions (`flushOutCount` and `hasFlush`) that both call `_suitCounts.fill(0)` and
  iterate, and `_classify()` calls both sequentially, relying on re-fill between calls. This
  works today, but the implicit ordering dependency between `hasFlush(all)` and the subsequent
  draw-detection code that also uses `_suitCounts` via `flushOutCount(all)` is a trap for the
  next person who reorders calls. The buffers are shared state that looks like local state.
  At minimum, add a comment to `_classify()` where it calls both functions, noting the
  dependency on `fill(0)`.

- [ ] **dirty-outs.ts:46 — `totalRawOuts` parameter is accepted but never used**
  `DirtyOutsInput.totalRawOuts` is declared in the interface and destructured at line 32, but
  the function always computes `(flushOuts + straightOuts) * ...` from the individual
  components rather than from `totalRawOuts`. If `flushOuts + straightOuts !== totalRawOuts`
  (e.g. because the caller passed in a combo-draw count), the result silently diverges from
  the intent. Either remove `totalRawOuts` from the interface or use it directly.

---

## Low Priority / Nice-to-Have

- [ ] **exploit.ts:67 — DELTAS keys disagree with the documented archetype names in the JSDoc**
  The file header says "5 opponent archetypes" and lists UNKNOWN. The DELTAS object also has
  5 keys. This is internally consistent. However, cross-referencing with `poker-content.ts`
  reveals 6 `TableTemperatureLocal` values (including "balanced"), of which only 4 map to
  DELTAS keys. The asymmetry is intentional but worth a single comment in DELTAS confirming
  "balanced and unknown are handled above (no-op path)".

- [ ] **poker-content.ts:672 — `handsObserved` proxy is a rough heuristic with no documentation**
  The mapping `withVpip.length >= 3 ? 30 : ... >= 2 ? 15 : ... >= 1 ? 6 : 0` converts number
  of players with visible VPIP stats into a hands-observed signal. This is a proxy, not real
  sample data. The value 30 (full confidence) for 3+ players with stats is aggressive — it
  means maximum exploit confidence applies on the first hand at the table if 3 players have
  visible stats. A short JSDoc explaining what this proxy represents would help the next reader.

- [ ] **board-analyzer.ts:48 — `betFractionFromWetScore` accepts `number` but the valid domain is 0–4**
  The function signature is `(wetScore: number): number`. The return type works correctly via
  the `?? 0.50` fallback, but accepting raw `number` instead of `0 | 1 | 2 | 3 | 4` means
  callers can silently pass any integer. Since `wetScore` on `BoardTexture` is already typed
  `0 | 1 | 2 | 3 | 4`, tighten the parameter to the same literal union.

- [ ] **hand-evaluator.ts:265 — Backdoor flush included in the `weak_draw` tier check**
  `if (straightOuts >= 4 || flushOuts >= 2)` — `flushOuts >= 2` catches backdoor flushes
  (2 effective outs). A backdoor flush is ~8.4% equity over two streets, which is less than
  a true gutshot (8.5% on the turn). Grouping them together as `weak_draw` is roughly
  correct, but the 2-out backdoor is being treated identically to a 4-out gutshot through the
  rest of the system (same pot-odds comparisons, same decisions). This is an acceptable
  approximation for the scope of the engine, but should be documented as a known simplification.

- [ ] **rule-tree.ts:59 — `isInPosition` only recognises "BTN/SB" (heads-up position)**
  `["BTN", "CO", "BTN/SB"]` — the comment says "clockwise from dealer button" but SB as a
  string is not listed individually. On a 3-handed table the SB is OOP relative to BTN. For
  the current use-case this is acceptable since `BTN/SB` is the only special case generated
  by `getPosition()`, but it would silently misclassify pure "SB" as out-of-position even in
  a 2-player scenario if the position naming ever changes.

- [ ] **poker-content.ts:135–141 — Type guard `isAutopilotAction` uses `as Record<string, unknown>`**
  This is the idiomatic pattern for a runtime type guard on `unknown`, so it does not fail the
  `any` rule. However, the guard does not validate that `amount` is a finite number — it only
  checks `typeof a.amount === "number"`. `NaN` and `Infinity` would pass. Given that `amount`
  drives real-money bet sizing, add `Number.isFinite(a.amount)` in that branch.

---

## Passed / No Action Needed

- Zero `any` usage across all reviewed files. All type assertions are on `unknown` in the
  type guard and are correct.
- `parseCard` / `parseCards` return `null` on invalid input and callers use `.filter(Boolean)`
  pattern with a proper type guard predicate `(c): c is Card`. No unsafe casts.
- `exactOutEquity` handles the `remaining <= 0` edge case defensively, preventing division
  by zero.
- `computePotOdds` guards against `callAmount <= 0` before dividing.
- `parseCurrency` handles `null | undefined` via truthiness check before `parseFloat`.
- The circular import question: `exploit.ts` imports from `rule-tree.ts` (type-only:
  `LocalDecision`), and `rule-tree.ts` imports a value from `exploit.ts`
  (`applyExploitAdjustments`). This is a one-way value import plus a one-way type import and
  does NOT form a circular dependency — TypeScript and module bundlers handle this correctly.
  The `import type` on the `rule-tree` side of the `exploit.ts` import confirms the type is
  erased at runtime.
- `sampleConfidenceMultiplier` boundaries are correct and fully tested:
  - 0 → 0.50 (cold read, half signal)
  - 1–5 → 0.65
  - 6–15 → 0.80
  - 16–29 → 0.90
  - 30+ → 1.00 (full signal)
  The `handsObserved` proxy in poker-content.ts uses 30 as the max, which correctly hits the
  1.00 ceiling. The steps do not overlap, which is verifiable in the test suite.
- `deriveTemperatureFromDomStats` handles the `avgAf === null` case (no AF data) correctly:
  `isAggressive` is set to `null`, and the ternary `isAggressive === false` correctly
  distinguishes `false` (confirmed passive) from `null` (no data), defaulting to the
  aggressive classification. This is intentional and correct.
- `updateOverlay` does not call `safeExecuteAction` and contains no mutation logic — pure DOM
  update, safe to call frequently.
- `simulateClick` uses `getBoundingClientRect()` which is safe on connected elements. The
  re-connection check before the click (`button.isConnected`) at line 929 is a solid guard.
- All 185 unit tests pass with `bun test`.
- The `try/catch` around `applyRuleTree` in `localDecide()` (line 739) is an appropriate
  defensive boundary at the content-script level — exceptions from the pure engine are caught
  without crashing the observer loop.

---

## Second Pass — Pattern & Duplication Analysis (2026-02-24)

### 1. RANK_MAP triplication (High)

Three independent copies of the identical 13-entry `Record<string, number>` map:

| Location | Symbol | Visibility |
|---|---|---|
| `lib/poker/hand-evaluator.ts:32–35` | `RANK_MAP` (const) | Module-private |
| `lib/poker/equity/card.ts:11–14` | `RANK_MAP` (const) | Module-private |
| `lib/poker/board-analyzer.ts:155–158` | inline inside `_parseRank()` | Function-private |

All three are byte-for-byte identical, including the `"T": 10` legacy alias. `equity/card.ts` already exports `parseCard` which encapsulates the map. The other two modules should import from there or from a shared `equity/card.ts`-sourced helper, eliminating the need to keep three copies in sync.

### 2. `boardHasHighCard()` inconsistency (High)

`lib/poker/rule-tree.ts:71–76`:
```typescript
function boardHasHighCard(communityCards: string[]): boolean {
  return communityCards.some((c) => {
    const rank = c.slice(0, -1).toUpperCase();
    return rank === "A" || rank === "K" || rank === "Q";
  });
}
```

This is the only card-rank extraction in `lib/poker/` that does not go through a `RANK_MAP` lookup or `parseCard()`. For "10x" cards, `slice(0, -1)` yields `"1"`, which is absent from all RANK_MAP instances — harmless here because `"1"` does not match A/K/Q, but the function is fragile for any extension.

More importantly, `analyzeBoard()` — already called at `rule-tree.ts:96` — returns `BoardTexture.highCards` which is defined at `board-analyzer.ts:126` as `ranks.some((r) => r >= 12)` (Q/K/A). That is precisely the same predicate. The `boardHasHighCard()` local function duplicates `board.highCards` on the already-computed `board` variable. At `rule-tree.ts:264`:
```typescript
const highCardOrWetBoard = boardHasHighCard(communityCards) || board.wetScore >= 2;
```
could be written as:
```typescript
const highCardOrWetBoard = board.highCards || board.wetScore >= 2;
```
eliminating the redundant parsing entirely.

### 3. Currency parsing — three divergent call sites (High)

`parseCurrency()` exists at `lib/poker/equity/pot-odds.ts:23` and is imported into `poker-content.ts`. It is used correctly for all numeric conversions in `localDecide()` (lines 715, 720, 725, 732). However two other call sites in the same file bypass it:

**`scrapeAvailableActions()` at `poker-content.ts:371–385`:**
```typescript
const amountMatch = text.match(/[€$£]([\d,.]+)/);
if (amountMatch) amount = amountMatch[0];  // ← captures the symbol too, e.g. "€1,50"
```
The captured group is `amountMatch[0]` (the full match including the currency symbol), not `amountMatch[1]` (the numeric part). This means `amount` stored in `ActionOption.amount` already contains the symbol. When later passed through `parseCurrency()` in `localDecide()`, the symbol is stripped correctly — so end-to-end the values are right. But the raw `ActionOption.amount` strings are exposed to other consumers (overlay, message formatting) in a non-normalised form.

**Preflop raise guard at `poker-content.ts:1234`:**
```typescript
(a) => a.type === "CALL" && parseFloat((a.amount ?? "0").replace(/[€$£,]/g, "")) > 0,
```
This reinvents `parseCurrency` inline. It differs in one detail: it strips commas from the whole string, whereas `parseCurrency` strips commas as part of the same global replace. Functionally equivalent for current inputs, but a silent divergence point.

### 4. `CONFIDENCE_THRESHOLD` is centralised; AP-guard literals are not (Medium)

`poker-content.ts:94` correctly names the caller-facing threshold as `CONFIDENCE_THRESHOLD`. The four AP-guard return confidences in `exploit.ts` are unnamed:

| Guard | Value | Location |
|---|---|---|
| AP-1 (never bluff calling station) | `0.85` | `exploit.ts:121` |
| AP-4 (fold medium vs nit bet) | `0.78` | `exploit.ts:130` |
| AP-3 (call medium vs LAG cheaply) | `0.68` | `exploit.ts:145` |
| AP-2 (probe scare card vs nit) | `0.72` | `exploit.ts:161` |

These are not arbitrary decimals — each represents a deliberate "how confident is this exploit override" value. Unnamed literals make it difficult to locate or adjust them as a group.

### 5. Magic numbers in `exploit.ts` (Medium)

Beyond the AP-guard confidences, three additional unnamed numeric literals appear in the hot path:

| Value | Semantic meaning | Location |
|---|---|---|
| `0.32` | Maximum pot fraction for a "cheap" call under AP-3 | `exploit.ts:141` |
| `0.40` | AP-2 probe-bet fraction of pot | `exploit.ts:161` |
| `1.30` | Calling-station value sizing multiplier | `exploit.ts:187` |
| `0.85` | Nit value sizing multiplier | `exploit.ts:190` |

Note: `0.85` appears as both a naming candidate here (sizing multiplier) and as the AP-1 guard confidence. They are unrelated but share the same literal value — a coincidence that will create confusion if either is changed independently.

### 6. Inline suit map in `board-analyzer.ts` (Low)

`board-analyzer.ts:91`:
```typescript
const suitIdx = { h: 0, d: 1, c: 2, s: 3 }[suitChar] ?? -1;
```
A new object is allocated on every card processed in every call to `_analyze()`. The same mapping is a module-level `SUIT_MAP` constant in `hand-evaluator.ts:37` and `equity/card.ts:16`. This is the same pattern concern as the RANK_MAP triplication, and the fix is the same: share from `equity/card.ts`.

### 7. Three `parseCard` functions with different signatures (Low)

| Location | Signature | Scope | Purpose |
|---|---|---|---|
| `lib/poker/equity/card.ts:23` | `(card: string) => Card \| null` | Exported | Equity/outs calculations |
| `lib/poker/hand-evaluator.ts:41` | `(card: string) => ParsedCard \| null` | Module-private | Hand tier classification |
| `lib/poker/hand-notation.ts:19` | `(code: string) => { rank: string; suit: string } \| null` | Module-private | Preflop chart notation |

The third is intentionally different (string rank, not numeric) and uses a regex rather than RANK_MAP, which is appropriate for its chart-lookup context. But the identical name across three functions with different return types is a codebase search hazard. Renaming the notation parser to `parseCardCode` or `parseHandCard` would resolve the ambiguity.

### 8. Exploit reasoning tag format (Pass)

`[exploit: TYPE, n=N]` is produced at `exploit.ts:111` and applied via string concatenation in every return path. The format is consistent — it never varies. Tests at `exploit.test.ts:185` and `302` assert `toContain("[exploit: LOOSE_PASSIVE")` and `"[exploit: LOOSE_AGGRESSIVE"` — they check the prefix but not the `n=` suffix, which means a broken `n=` interpolation would not be caught. This is a minor gap, not a bug.

### 9. Test helper patterns (Pass)

`exploit.test.ts` helpers `decision()`, `hand()`, `adjust()` follow the same "builder function with defaults + named overrides object" pattern used across the suite:
- `rule-tree.test.ts`: `input(overrides: Partial<RuleTreeInput>)`
- `table-temperature.test.ts`: `makeOpponents(types: string[])`
- `exploit.test.ts`: `decision(overrides: Partial<LocalDecision>)`, `hand(tier)`, `adjust(base, opponentType, opts)`

The `adjust()` wrapper defaults `handsObserved` to 30 (full scaling) so most tests are not contaminated by scaling effects. Tests that specifically cover scaling call `applyExploitAdjustments` directly. The split is consistent and deliberate. The `beforeEach` cache-clear discipline (`clearEvalCache`, `clearBoardCache`) is present in the two tests that need it (`hand-evaluator.test.ts:4`, `rule-tree.test.ts:6–9`) and absent from `exploit.test.ts` which has no cached state. This is correct.

### 10. Pure-function discipline (Pass)

All five return paths in `exploit.ts` use `{ ...base, ... }` spread. The immutability test at `exploit.test.ts:597–602` explicitly verifies that `base.confidence` is unchanged after a call. `rule-tree.ts` constructs each `LocalDecision` as a fresh object literal. `hand-evaluator.ts` uses pre-allocated `Uint8Array` buffers for performance but does not expose them to callers. No mutation of arguments was found in any reviewed function.

---

## Race Condition & Async Review (2026-02-24, Julik)
**Scope:** extension/src/poker-content.ts — async operations, timers, mutex patterns on a real-money platform

### Critical Race Conditions

- [ ] **RACE-1: `executing` mutex never reset when `executeAction()` throws** — `poker-content.ts:880-943`
  `executeAction()` is `async`. `executing = false` only appears on three explicit return paths: line 914 (no button found), line 936 (button lost after delay), and line 942 (success). There is no `finally` block. If `humanDelay()` rejects, or any line added in future between the delay and the click throws, `executing` stays `true` for the remainder of the hand. Every subsequent hero-turn check on line 1195 skips because `!executing` is false. The player watches the action buttons while the bot does nothing. The watchdog then fires after 9 seconds and FOLDs. For the watchdog's FOLD to actually fire it calls `executeAction()` which itself — since `executing` is already `true` — is called again without the guard (the watchdog path calls `executeAction` directly, not `requestDecision`, so it bypasses the `if (executing) return` guard on line 772). So you get a watchdog FOLD on top of a locked mutex. Charming.
  Fix: `try { ... } finally { executing = false; }` around the entire body of `executeAction()`.

- [ ] **RACE-2: Watchdog callback races with legitimate `AUTOPILOT_ACTION` message** — `poker-content.ts:791-798` (set) vs `poker-content.ts:983-985` (cancel)
  `clearTimeout()` can only cancel a callback that has not yet been invoked. Browser timer precision is ±1ms, and the event loop processes all queued microtasks before the next task. If the Claude response arrives at T+8.95s and the watchdog was set for T+9.0s, `clearTimeout()` will succeed — usually. But under event-loop pressure (heavy DOM mutations from animation, garbage collection pause) the watchdog callback can be queued slightly early, and once queued it cannot be un-queued by `clearTimeout()`. Both `onDecisionReceived()` and the watchdog callback then execute. `onDecisionReceived()` calls `safeExecuteAction()`, which calls `executeAction()`, which clicks CALL and sets `executing = false`. The watchdog callback then sees `executing = false` (already reset), passes the guard, and calls `executeAction({ action: "FOLD" })`. The bot has called and then immediately folded a hand it just entered. On real money. This is the worst possible failure mode in this entire codebase.
  Fix: cancellation-token pattern. `const token = { canceled: false }; decisionWatchdog = setTimeout(() => { if (token.canceled) return; ... }, ms)`. In `onDecisionReceived()`, set `token.canceled = true` before `clearTimeout`. Store `token` alongside `decisionWatchdog`.

- [ ] **RACE-3: Dual concurrent `requestPersona()` calls on the same hand** — `poker-content.ts:1183` (new-hand) and `poker-content.ts:1227` (hero-turn fallback)
  The early-return guard at line 658 is `if (lastPersonaRec) return`. Both call-sites fire before either `fetch()` resolves, so both pass the guard. Both `await fetch()`. Whichever response arrives second overwrites `lastPersonaRec`. Also: `lastTableTemperature` is written at line 670–673 in both invocations — last writer wins, which is probably fine, but the first persona-fast-path execution (lines 1243–1254) may have already read `lastPersonaRec` set by response #1 and acted on it, while response #2 then sets a different persona. The overlay then shows the different persona as if it were the one that made the decision.
  Fix: add a module-level `personaInFlight: Promise<void> | null`. `requestPersona()` returns early if this is non-null, sets it at the start of the async work, and clears it (via `finally`) on completion.

### High Priority

- [ ] **RACE-4: `lastTableTemperature` is `null` when `localDecide()` reads it on mid-hand activation** — `poker-content.ts:90` (initialiser) vs `poker-content.ts:736`
  `lastTableTemperature` is set inside `requestPersona()`, which is only called when the extension detects a *new hand* with `communityCards.length === 0`. If the user activates autopilot while a hand is already in progress on the flop or turn — a perfectly ordinary situation — `requestPersona()` is never called for that hand. `localDecide()` reads `lastTableTemperature` as `null`, `opponentTypeFromTemperature(null)` returns `undefined`, and the rule tree runs with no opponent-type signal. This is a silent wrong answer on a real-money decision, with no log entry to indicate it happened.
  Fix: run a best-effort temperature derivation directly in `localDecide()` if `lastTableTemperature` is null, using `scrapeTableStats()` and `deriveTemperatureFromDomStats()`.

- [ ] **RACE-5: Button re-find after `humanDelay()` does not replicate the full fallback chain** — `poker-content.ts:929-938`
  After the async delay, `button.isConnected` is false (timeout cleared the actions area). The re-find block looks for `decision.action === "RAISE" || decision.action === "BET" ? "CALL" : decision.action`. If CALL is also gone, it aborts with `executing = false`. The problem is that `lastHeroTurn` has already been set to `true` (line 1281) before `executeAction` was called — the rising-edge guard `state.isHeroTurn && !lastHeroTurn` will therefore be false on the next DOM mutation and the turn is silently skipped. No retry, no log at a level that triggers an alert, no fallback FOLD. The hand plays out with no action from the bot, and the server auto-folds after its own timeout.
  Fix: extract a `resolveButton(decision)` function that implements the full fallback chain. Call it from both the initial path and the re-find path.

- [ ] **`safeExecuteAction()` FOLD→CHECK guard reads stale `lastState`** — `poker-content.ts:953-955`
  The check `lastState?.availableActions.some((a) => a.type === "CHECK")` is read from the state snapshot at the time `processGameState()` ran — at minimum 200ms stale due to debounce, potentially seconds stale if `humanDelay()` ran. If another player's action causes the server to transition the hand (pot consolidated, bet posted, round ended), CHECK may have already disappeared when `executeAction()` later looks for it. The fallback chain inside `executeAction()` then finds nothing and aborts. The override intended to prevent a bad FOLD has itself caused no action.
  Fix: call `scrapeAvailableActions()` live inside `safeExecuteAction()` for the CHECK guard.

- [ ] **Monitor-mode `requestDecision()` fires before persona resolves** — `poker-content.ts:1186-1189`
  Line 1183: `requestPersona()` is started (async, not awaited). Line 1187: `requestDecision([...handMessages])` is called immediately. `lastPersonaRec` is null, so `requestDecision()` builds `fullMessages` without the persona system-turn prefix. The preflop monitor recommendation is made without persona context. The persona arrives later and `lastPersonaRec` is set, but Claude's answer has already been dispatched.
  Fix: do not call `requestDecision()` at hand-start time. The hero-turn block (lines 1210–1278) already has the persona fallback path and the correct timing.

- [ ] **`startObserving()` retry timer is uncancellable and can accumulate** — `poker-content.ts:1299`
  `setTimeout(startObserving, 2000)` has no handle stored. If `startObserving()` is called again before the retry fires — e.g. because `AUTOPILOT_MODE` message arrives and triggers `startObserving()` at line 166 — two invocations run concurrently. The `activeObserver` disconnect guard handles observer duplication, but `REGISTER_POKER_TAB` is sent twice, and the background script fires a duplicate `AUTOPILOT_MODE` re-send to the content script (background.ts line 245), which triggers another `startObserving()` call, potentially creating a third.
  Fix: store the retry handle as `let startObservingRetry: ReturnType<typeof setTimeout> | null = null` and cancel it at the top of `startObserving()`.

- [ ] **`streetActions` can accumulate duplicate entries from DOM animation flicker** — `poker-content.ts:1145-1156`
  Every `processGameState()` call diffs `state.players[n].bet` against `lastState.players[n].bet`. If Playtech's bet display animates through intermediate DOM text states (e.g. chip counting animation briefly shows partial amounts before settling), successive `processGameState()` calls will see different `prev.bet` values and append multiple "bets/raises to X" strings for the same underlying bet. Claude's context message then contains phantom duplicate opponent actions.
  Fix: track which (seat, bet-amount) pairs have already been appended to `streetActions` and skip duplicates.

### How to Induce These Failures

- **RACE-2 (watchdog + action collision):** Set the autopilot API route to sleep for 10 seconds before responding, and set the timer DOM to show "12". The watchdog fires at T+9s, calls `executeAction(FOLD)`. At T+10s Claude responds, `onDecisionReceived()` calls `executeAction(CALL)`. Observe in the server hand history: FOLD then a phantom click event.
- **RACE-3 (dual persona fetch):** Add `await new Promise(r => setTimeout(r, 800))` at the top of the persona API handler. Start the extension on a fresh hand. Both `requestPersona()` calls fire within the debounce window. Watch the console: `[Poker] Persona: X → RAISE` then immediately `[Poker] Persona: Y → FOLD`.
- **RACE-1 (stuck mutex):** Temporarily add `throw new Error("injected failure")` inside `humanDelay()`. Observe that `executing` stays `true`, all subsequent turns are silently skipped, and the watchdog eventually FOLDs — but by then the server has auto-folded anyway because the action timer expired.
