---
status: pending
priority: p2
issue_id: "037"
tags: [code-review, correctness, autopilot, poker-logic]
dependencies: []
---

# Position Calculation Uses Hardcoded `mod 6`, Ignores `activeSeatCount`

## Problem Statement

`getPosition()` accepts `activeSeatCount` but never uses it in the offset calculation — the modulo is always 6. At 3-handed play with non-consecutive seat numbers (e.g. seats 1, 3, 5), a player can be assigned `"CO"` or `"MP"` when only BTN/SB/BB exist. Claude's system prompt applies position-specific strategy, so wrong labels directly degrade decision quality.

## Findings

- `extension/src/poker-content.ts:400-413` — `const offset = ((seat - dealerSeat + 6) % 6)` always uses 6
- `activeSeatCount` parameter validated (`< 2` guard) but then unused in the offset math
- `POSITIONS_6MAX` array at line 398 covers 6 seats; short-handed games don't have CO/MP
- Architecture review (2026-02-23, H1): "With 3 active players, seats at offset 3, 4, 5 relative to the dealer are labeled UTG, MP, CO — positions that don't exist at a 3-handed table"
- Pattern review (2026-02-23): "`activeSeatCount` is accepted but misleads"

## Proposed Solutions

### Option A: Map positions based on activeSeatCount (Recommended)
Use seat-count-appropriate position tables:
```typescript
const POSITIONS_BY_COUNT: Record<number, string[]> = {
  2: ["BTN/SB", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["BTN", "SB", "BB", "UTG"],
  5: ["BTN", "SB", "BB", "UTG", "CO"],
  6: ["BTN", "SB", "BB", "UTG", "MP", "CO"],
};

function getPosition(seat: number, dealerSeat: number, activeSeatCount: number): string {
  if (dealerSeat < 0 || activeSeatCount < 2) return "??";
  const positions = POSITIONS_BY_COUNT[activeSeatCount] ?? POSITIONS_6MAX;
  const offset = ((seat - dealerSeat + activeSeatCount) % activeSeatCount);
  return offset < positions.length ? positions[offset] : "??";
}
```
**Pros:** Correct at all table sizes; uses the parameter as documented
**Cons:** Requires offline verification of position order at each seat count
**Effort:** Small
**Risk:** Low (only affects text labels in Claude context)

### Option B: Add a disclaimer to position output when < 6 players
Keep mod 6 but append a note when `activeSeatCount < 6`:
```typescript
const pos = POSITIONS_6MAX[offset] ?? "??";
return activeSeatCount < 6 ? `~${pos}` : pos;
```
**Pros:** Zero logic change; signals uncertainty to Claude
**Cons:** Claude may not correctly interpret `~CO`; doesn't fix the wrong label
**Effort:** 1 line
**Risk:** None

### Option C: Status quo
Accept position mislabeling for short-handed play.
**Pros:** None
**Cons:** Strategy degraded at non-6-max tables
**Risk:** Medium (strategy errors at 3-max)

## Recommended Action

Option A. The fix is straightforward and the parameter already conveys the intent.

## Technical Details

- **File:** `extension/src/poker-content.ts:400-413`

## Acceptance Criteria

- [ ] 6-max positions match existing behavior: BTN, SB, BB, UTG, MP, CO
- [ ] 3-max positions: BTN, SB, BB (offset mod 3)
- [ ] Heads-up: BTN/SB, BB (offset mod 2)
- [ ] `activeSeatCount` actually used in the offset modulo
- [ ] Unit test or comment verifying each position order

## Work Log

- 2026-02-23: Created from feat/dom-autopilot code review. Flagged by architecture-strategist (H1), pattern-recognition-specialist.
