# Review: feat/local-poker-decision-engine — Simplicity & YAGNI
**Date:** 2026-02-24
**Reviewed by:** Code Simplicity Agent

## Summary

The new code is generally clean and purposefully structured. Most of the design choices are justified by the domain. There are a handful of real simplification wins — none are architectural rewrites, all are small and safe.

---

## Critical Issues
None.

---

## High Priority

### H-1: `isCallDownLine()` is a one-liner that wraps a one-liner
- **File:** `lib/poker/exploit.ts:50-52`
- **Issue:** `isCallDownLine(base)` is called exactly once (line 174). The function body is `return decision.action === "CALL"`. There is no reuse, no logic to isolate, and no clarity gain from naming it.
- **Current:**
  ```ts
  function isCallDownLine(decision: LocalDecision): boolean {
    return decision.action === "CALL";
  }
  // ...
  } else if (isCallDownLine(base)) {
  ```
- **Proposed:** inline at the call site
  ```ts
  } else if (base.action === "CALL") {
  ```
- **Impact:** -4 LOC, zero loss of clarity (the delta table key `callDown` names the concept already)

### H-2: `opponentTypeFromTemperature()` is only called once — should be inlined
- **File:** `extension/src/poker-content.ts:513-524`
- **Issue:** The function is 11 lines, exported nowhere, called once at line 736. The map it holds is simple enough to read at call site. Naming this "opponentTypeFromTemperature" adds a navigation hop without adding clarity that isn't already provided by the `lastTableTemperature` variable name and the `dominantType` field.
- **Current:**
  ```ts
  function opponentTypeFromTemperature(temp: ...) {
    const map: Partial<Record<...>> = { ... };
    return map[temp.dominantType];
  }
  // ...
  const opponentType = opponentTypeFromTemperature(lastTableTemperature);
  ```
- **Proposed:** inline in `localDecide()`
  ```ts
  const TYPE_MAP: Partial<Record<TableTemperatureLocal, string>> = {
    loose_passive: "LOOSE_PASSIVE",
    tight_passive: "TIGHT_PASSIVE",
    loose_aggressive: "LOOSE_AGGRESSIVE",
    tight_aggressive: "TIGHT_AGGRESSIVE",
  };
  const opponentType = lastTableTemperature
    ? TYPE_MAP[lastTableTemperature.dominantType]
    : undefined;
  ```
- **Impact:** -11 LOC in function definition, +4 LOC inline = net -7. Removes one named abstraction with no semantic value.

---

## Low Priority / Nice-to-Have

### L-1: `isBluffLine()` and `isValueBetLine()` — keep, but note they carry their weight
- **File:** `lib/poker/exploit.ts:42-48`
- **Analysis:** Both are called 2-3 times each (lines 116, 170, 172, 184). The naming (`isBluffLine`, `isValueBetLine`) communicates intent that raw boolean expressions wouldn't. The Sets they wrap are also tested implicitly through `applyExploitAdjustments`. These helpers are justified — do not inline.

### L-2: `BLUFF_TIERS` / `VALUE_TIERS` as `ReadonlySet` — correct choice
- **File:** `lib/poker/exploit.ts:34-40`
- **Analysis:** Set is the right structure for O(1) membership testing with 5 string literals. The `ReadonlySet` type annotation prevents accidental mutation. No change needed.

### L-3: `ConfidenceDeltas` interface — appropriately clean
- **File:** `lib/poker/exploit.ts:56-65`
- **Analysis:** Used as the value type in the `DELTAS` Record and nowhere else. Four fields, all used. The interface makes the DELTAS table self-documenting (column headers). This is one of the better design choices in the file. Do not remove.

### L-4: `DELTAS` table — appropriate structure
- **File:** `lib/poker/exploit.ts:67-73`
- **Analysis:** 5 opponent types × 4 deltas = 20 values, all referenced. An alternative would be a `switch` statement (~60 lines). The table is strictly better. No change.

### L-5: `sampleConfidenceMultiplier()` — as simple as it can be
- **File:** `lib/poker/exploit.ts:24-30`
- **Analysis:** 4 thresholds, 5 return values, tested with 9 unit tests directly. A lookup table or lerp would add complexity without benefit given the discrete tier structure. Correct as-is.

### L-6: `boardHasHighCard()` — simple enough
- **File:** `lib/poker/rule-tree.ts:71-76`
- **Analysis:** One minor note: `c.slice(0, -1).toUpperCase()` strips the suit then uppercases, but card ranks for A/K/Q are already uppercase in the canonical format. The `.toUpperCase()` is defensive but harmless — one could write `["A","K","Q"].includes(c.slice(0,-1))` and it would be equivalent for valid inputs. This is not worth changing.

### L-7: `lastTableTemperature` object vs a hand-count + type pair approach
- **File:** `extension/src/poker-content.ts:90`
- **Analysis:** The chosen shape `{ dominantType, handsObserved }` is correct. A separate `lastTableTemperatureHandCount` variable would require two variables to stay in sync — the single object is cleaner. No change.

### L-8: AP-1 through AP-4 guard conditions
- **File:** `lib/poker/exploit.ts:116-165`
- **Analysis:**
  - AP-1 (line 116): `isBluffLine(base, tier)` is the right call here — inlining would make the condition harder to parse.
  - AP-4 (line 126): `base.action === "CALL" && tier === "medium"` — clean.
  - AP-3 (line 136-148): `callAmount / (pot + callAmount) < 0.32` is a pot-odds calculation with a named threshold embedded inline. Consider extracting `0.32` as a named constant `LAG_CHEAP_CALL_THRESHOLD = 0.32` if this ever needs tuning. Low priority.
  - AP-2 (line 152-165): `!facingBet && highCardOrWetBoard` is clear. No simplification needed.

### L-9: Overly defensive null checks
- **File:** `lib/poker/exploit.ts:100-104`
- **Analysis:** The `if (!deltas) return base` guard at line 104 is dead in practice — `DELTAS` covers all 5 known opponent types plus `UNKNOWN`, and `opponentType` is validated upstream to be one of those. However, because `opponentType` is typed as `string` (not a union), the guard prevents runtime errors from unknown future values. This is borderline acceptable. If `opponentType` were typed as a union of the 5 known strings, this guard could be removed. Low priority.

---

## Passed / No Action Needed

- `DELTAS` table design — clear, compact, correct
- `ConfidenceDeltas` interface — earns its keep as column headers for the table
- `BLUFF_TIERS` / `VALUE_TIERS` Sets — right tool for membership checks
- `sampleConfidenceMultiplier()` — straightforward step function, well-tested
- `boardHasHighCard()` — simple one-liner, correctly placed
- `lastTableTemperature` object shape — cleaner than two separate variables
- AP-1, AP-4 guard conditions — readable and necessary
- `isBluffLine()` / `isValueBetLine()` — used multiple times, worth the name

---

## Final Assessment

Total potential LOC reduction: ~18 lines (~2% of the 850-line addition)
Complexity score: Low — this code is deliberately structured and mostly minimal
Recommended action: Two small targeted simplifications (H-1, H-2). Everything else is already at the right level of abstraction.
