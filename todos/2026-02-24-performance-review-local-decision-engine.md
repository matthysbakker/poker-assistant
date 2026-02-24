# Performance Review: Local Poker Decision Engine — Implementation (PR #11)
**Date:** 2026-02-24
**Branch:** feat/local-poker-decision-engine
**Reviewed by:** Performance Oracle
**Files reviewed:**
- `extension/src/poker-content.ts`
- `lib/poker/hand-evaluator.ts`
- `lib/poker/board-analyzer.ts`
- `lib/poker/rule-tree.ts`
- `lib/poker/exploit.ts`
- `lib/poker/equity/outs.ts`, `odds.ts`, `pot-odds.ts`, `implied-odds.ts`, `dirty-outs.ts`, `card.ts`, `hand-strength.ts`

---

## Performance Summary

The local decision engine itself (hand-evaluator, board-analyzer, rule-tree, exploit, equity) is
well-implemented from a performance standpoint. Pre-allocated Uint8Arrays, bitmask straight
detection, and result caches are all present and correct. The caches are bounded per-hand and
cleared on new-hand detection. The engine runs under 50µs on every hero turn — well within the
<1ms budget established in the plan review.

The dominant performance risk is in the DOM scraping layer in poker-content.ts. Specifically,
`findStatValue()` does a full `querySelectorAll("*")` walk on every player area on every
`requestPersona()` call, and this call fires twice per hand even when VPIP/AF stats are absent
from the DOM. A secondary concern is `scrapeGameState()` re-querying stable per-hand values
(`heroSeat`, `dealerSeat`, `handId`) on every 200 ms debounce tick.

---

## Critical Issues

- [ ] **`findStatValue()` does `querySelectorAll("*")` per player area — fires every `requestPersona()` call even when stats are absent**
  File: `extension/src/poker-content.ts:406`
  Code: `const all = Array.from(area.querySelectorAll("*"));`

  `requestPersona()` calls `scrapeTableStats()` at line 661, which calls `findStatValue()` for
  VPIP and AF on every `.player-area` element. At 6 seats this is 6 full descendant traversals
  per `requestPersona()` call. `requestPersona()` is invoked on new-hand detection (line 1183)
  and again as a fallback on hero-turn detection (line 1227), meaning 2 invocations per hand
  minimum. In a typical 60-hand/hour session, this is 120 wasted full DOM walks per hour when
  VPIP/AF stats are absent from the page.

  The `statDebugLogged` flag (line 444) suppresses only the log message — the DOM walk still
  executes on every subsequent call after the flag is set.

  Recommended fix: On the first call to `scrapeTableStats()` that returns all-null results, set a
  module-level `statsUnavailable = true` flag and return `[]` immediately on all subsequent
  calls. Reset the flag on new-hand detection so a late-loading HUD is retried once per hand.

- [ ] **`scrapeGameState()` re-reads stable per-hand values on every 200 ms tick**
  File: `extension/src/poker-content.ts:526-539`

  `scrapeGameState()` unconditionally calls `scrapeHandId()`, `scrapeHeroSeat()`,
  `scrapeDealerSeat()`, and the hero-card scraper on every invocation. None of these values
  change during a hand. `scrapeHeroSeat()` queries `.player-area.my-player` and its
  `className`. `scrapeDealerSeat()` loops through up to 6 `document.querySelector` calls
  (line 310-316). At 5 ticks/second these fire 300 times per 60-second hand for zero new
  information.

  Recommended fix: Cache `handId`, `heroSeat`, `dealerSeat`, and `heroCards` after the first
  successful read per hand. Clear the cache in the new-hand detection block at line 1159.
  Only re-read volatile values (`isHeroTurn`, `availableActions`, `pot`, player bets) on every
  tick.

---

## High Priority

- [ ] **`_evalCache` and `_boardCache` have no size cap — cleared only on new-hand detection**
  Files: `lib/poker/hand-evaluator.ts:126`, `lib/poker/board-analyzer.ts:54`

  Both caches are plain `Map`s cleared at lines 1169-1170 when `handId` changes. During normal
  play the maps hold at most 3-5 entries (one per unique board state seen during the hand).
  However, if `handId` detection fails silently — for example if `scrapeHandId()` returns `""`
  repeatedly — `currentHandId` never updates and `clearEvalCache()`/`clearBoardCache()` are
  never called. `localDecide()` fires on every hero turn with unique board combinations. Over a
  2-hour session with a broken `handId`, this can grow to hundreds of entries.

  Recommended fix: Add a max-size guard at the top of `evaluateHand()` and `analyzeBoard()`:
  ```typescript
  if (_evalCache.size > 50) _evalCache.clear();
  ```
  This is a defensive backstop, not the primary clearing mechanism.

- [ ] **`scrapePlayers()` queries 7 selectors per seat on every tick — player names are static**
  File: `extension/src/poker-content.ts:274-299`

  Inside the `.player-area` `forEach`, 7 `querySelector` calls fire per seat per tick: name,
  stack, bet, fold-action, hidden-cards, hero-cards check. Player names are set when players
  sit down and do not change. At 6 seats × 7 queries × 5 ticks/second = 210 selector
  evaluations per second for data that does not change between ticks.

  Recommended fix: Cache `Map<seat, name>` after the first successful population. Skip the
  `.nickname .target` query on subsequent ticks for seats where the name is already known.

- [ ] **`scrapeDealerSeat()` issues up to 6 sequential `document.querySelector` calls on every tick**
  File: `extension/src/poker-content.ts:310-316`

  Loops `i = 1..6` calling `document.querySelector(".game-position-${i}:not(.pt-visibility-hidden)")`.
  Worst case is 6 full-document queries per tick when the dealer button is at seat 6 or not
  visible. The dealer seat does not change during a hand — it fires 300+ times per hand for
  identical information.

  Recommended fix: Cache `dealerSeat` in the new-hand detection block. Re-read only when
  `handId` changes.

- [ ] **`startObserving()` retry `setTimeout` can accumulate if `AUTOPILOT_MODE` fires while `.table-area` is absent**
  File: `extension/src/poker-content.ts:1299`

  When `.table-area` is not found, `setTimeout(startObserving, 2000)` is scheduled. If
  `AUTOPILOT_MODE` messages arrive rapidly (user toggling the popup), each call to
  `startObserving()` creates a new independent retry chain. The disconnect logic at line 1287
  ensures no MutationObserver accumulates, but multiple concurrent `setTimeout` chains all
  calling `startObserving()` run simultaneously. Each chain that fires while `.table-area` is
  still absent schedules another retry, compounding.

  Recommended fix: Store the retry handle in a module-level `let retryTimer: ReturnType<typeof setTimeout> | null = null` and `clearTimeout(retryTimer)` before scheduling a new one, mirroring the `decisionWatchdog` pattern.

- [ ] **`statDebugLogged` fires on the very first call and never resets — stale for late-loading HUDs**
  File: `extension/src/poker-content.ts:444`

  The flag is set on the very first `scrapeTableStats()` call at session start, before the
  stats container may have rendered. If the HUD loads asynchronously (e.g. after 30 seconds),
  subsequent successful parses produce no diagnostic output. The "VPIP/AF not found" snippet
  logged at session start is stale and misleading.

  Recommended fix: Reset `statDebugLogged = false` in the new-hand detection block (line 1159)
  so each hand gets one fresh diagnostic snapshot at its first `requestPersona()` call.

---

## Optimization Opportunities

- [ ] **`parseCardFromSvg()` compiles the regex on every call**
  File: `extension/src/poker-content.ts:197`
  Code: `const match = src.match(/([cdhs])([a2-9]|10|[jqka])\.svg$/i);`

  The regex literal is inside the function body. V8 does cache compiled regex, but hoisting to
  module scope is explicit and consistent with the codebase's precision discipline.
  Recommended fix: `const CARD_SVG_RE = /([cdhs])([a2-9]|10|[jqka])\.svg$/i;` at module scope.
  Impact: negligible at scraping call rates, but correct practice.

- [ ] **`analyzeBoard._analyze()` uses `Math.max(...suitCounts)` spread — inconsistent with stated allocation discipline**
  File: `lib/poker/board-analyzer.ts:106`
  Code: `const maxSuit = Math.max(...suitCounts);`

  Spreading a `Uint8Array` into `Math.max` creates a temporary argument list. `hand-evaluator.ts`
  correctly avoids this with an explicit loop at line 65. The board analyzer should match.
  Recommended fix: Replace with an explicit `for` loop:
  ```typescript
  let maxSuit = 0;
  for (let i = 0; i < 4; i++) if (suitCounts[i] > maxSuit) maxSuit = suitCounts[i];
  ```

- [ ] **`handMessages` and `streetActions` have no defensive cap — grow unbounded if `handId` detection breaks**
  File: `extension/src/poker-content.ts:106`, `109`

  Both arrays are cleared on new-hand detection. If `handId` detection silently fails,
  `handMessages` grows by one entry per hero turn and `streetActions` by one per opponent action
  across the entire session.
  Recommended fix: Before pushing to `handMessages`:
  ```typescript
  if (handMessages.length > 20) handMessages = handMessages.slice(-10);
  ```
  Apply the same cap to `streetActions`.

---

## Confirmed Safe — No Action Needed

- **`sampleConfidenceMultiplier()` if-chain**: 5 comparisons, called once per hero turn. O(1) constant. Not a hot path.
- **`applyExploitAdjustments()` `exploitTag` string construction**: Called once per hero turn on the non-early-return path. Negligible.
- **`evaluateHand()` cache key**: `[...heroCards, "|", ...communityCards].join(" ")` is correct and collision-safe.
- **`analyzeBoard()` cache key**: `communityCards.join(" ")` is correct — board card order is stable within a hand.
- **`hasStraight()` bitmask implementation**: O(1) effectively (10-window constant loop, bitmask ops). Correct.
- **Pre-allocated `_rankCounts`/`_suitCounts` Uint8Arrays**: Present in `hand-evaluator.ts:55-56` and `equity/outs.ts:16-17`. No GC pressure from the evaluator hot path.
- **`clearEvalCache()` and `clearBoardCache()` called together**: Lines 1169-1170 in the same new-hand block. No gap between cache resets.
- **`executing` mutex**: Correctly prevents double-execution of actions.
- **MutationObserver scoped to `.table-area` not `document.body`**: Correct scope limit.
- **`characterData` removed from observer config**: Avoids the timer-tick flood (todo 043). Confirmed.
- **`activeObserver` disconnected before re-observation** at line 1287-1291: No observer leak.
- **`decisionWatchdog` timeout correctly cleared in `onDecisionReceived()`** at line 983: No leak.
- **`beforeunload` listener registered once at module load**: Cannot outlive the document.
- **`localDecide()` pre-flop guard**: Returns `null` when `communityCards.length < 3` (line 710). No unnecessary equity computation on pre-flop ticks.
- **`applyRuleTree()` multiway guard**: Returns low-confidence Claude fallback before any expensive computation on multiway pots (line 131-134). Correct short-circuit.
- **`applyExploitAdjustments()` early-return when `opponentType` is undefined**: Line 100. Avoids all delta computation when no opponent model is available.
- **`isBluffLine`/`isValueBetLine` use `ReadonlySet.has()`**: O(1).
- **`PERSONA_API_URL` fetch is async**: Does not block the 200 ms DOM tick.
- **`requestPersona()` guarded by `if (lastPersonaRec) return`**: Line 658. Prevents redundant calls for the same hand.
