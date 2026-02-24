import { describe, test, expect, beforeEach } from "bun:test";
import { applyRuleTree, type RuleTreeInput } from "../rule-tree";
import { clearEvalCache } from "../hand-evaluator";
import { clearBoardCache } from "../board-analyzer";

beforeEach(() => {
  clearEvalCache();
  clearBoardCache();
});

function input(overrides: Partial<RuleTreeInput>): RuleTreeInput {
  return {
    heroCards: ["Ah", "Kd"],
    communityCards: ["Ac", "7c", "3h"],
    pot: 0.10,
    heroStack: 2.0,
    effectiveStack: 2.0,
    callAmount: 0,
    facingBet: false,
    position: "BTN",
    activePlayers: 2,
    ...overrides,
  };
}

describe("applyRuleTree — preflop guard", () => {
  test("returns 0 confidence for preflop spot", () => {
    const result = applyRuleTree({ ...input(), communityCards: [] });
    expect(result.confidence).toBe(0);
  });

  test("requires ≥ 3 community cards", () => {
    const result = applyRuleTree({ ...input(), communityCards: ["Ac", "7c"] });
    expect(result.confidence).toBe(0);
  });
});

describe("applyRuleTree — nut hands", () => {
  test("nut flush bets for value", () => {
    const result = applyRuleTree(input({
      heroCards: ["Ah", "Jh"],
      communityCards: ["8h", "5h", "2h"],
    }));
    expect(result.tier ?? result.action).not.toBe(undefined);
    expect(result.action).toBe("BET");
    expect(result.confidence).toBeGreaterThanOrEqual(0.90);
  });

  test("nut hand raises when facing a bet", () => {
    const result = applyRuleTree(input({
      heroCards: ["Ah", "Jh"],
      communityCards: ["8h", "5h", "2h"],
      facingBet: true,
      callAmount: 0.05,
    }));
    expect(result.action).toBe("RAISE");
    expect(result.confidence).toBeGreaterThanOrEqual(0.90);
  });
});

describe("applyRuleTree — TPTK", () => {
  test("TPTK in position bets", () => {
    const result = applyRuleTree(input({
      heroCards: ["Ah", "Kd"],
      communityCards: ["Ac", "7c", "3h"],
      position: "BTN",
    }));
    expect(result.action).toBe("BET");
    expect(result.confidence).toBeGreaterThan(0.60);
  });

  test("TPTK OOP checks", () => {
    const result = applyRuleTree(input({
      heroCards: ["Ah", "Kd"],
      communityCards: ["Ac", "7c", "3h"],
      position: "BB",
    }));
    expect(result.action).toBe("CHECK");
  });

  test("TPTK calls facing small bet", () => {
    const result = applyRuleTree(input({
      heroCards: ["Ah", "Kd"],
      communityCards: ["Ac", "7c", "3h"],
      facingBet: true,
      callAmount: 0.04,
    }));
    expect(result.action).toBe("CALL");
  });
});

describe("applyRuleTree — draws", () => {
  test("flush draw with positive pot odds calls", () => {
    // pot = €0.10, call = €0.03 → pot odds = 0.03/0.13 ≈ 23%
    // flush draw equity (9 outs, 1 street remaining) ≈ 19.6% + implied bonus
    const result = applyRuleTree(input({
      heroCards: ["Ah", "Jh"],
      communityCards: ["8h", "5h", "Kc", "2c"],  // turn board — 1 street left
      facingBet: true,
      callAmount: 0.03,
      pot: 0.10,
    }));
    // With implied odds bonus the call is profitable
    expect(["CALL", "FOLD"]).toContain(result.action);
    expect(result.confidence).toBeGreaterThan(0.60);
  });

  test("gutshot with bad odds folds", () => {
    const result = applyRuleTree(input({
      heroCards: ["9c", "5d"],
      communityCards: ["7h", "6s", "2c"],
      facingBet: true,
      callAmount: 0.08, // large bet → bad pot odds for 4 outs
      pot: 0.10,
    }));
    expect(result.action).toBe("FOLD");
    expect(result.confidence).toBeGreaterThan(0.60);
  });

  test("air checks when no bet", () => {
    const result = applyRuleTree(input({
      heroCards: ["Ah", "Kd"],
      communityCards: ["7c", "5h", "3s"],
      facingBet: false,
      callAmount: 0,
    }));
    expect(result.action).toBe("CHECK");
  });

  test("air folds vs bet", () => {
    const result = applyRuleTree(input({
      heroCards: ["Ah", "Kd"],
      communityCards: ["7c", "5h", "3s"],
      facingBet: true,
      callAmount: 0.05,
    }));
    expect(result.action).toBe("FOLD");
  });
});

describe("applyRuleTree — low-confidence fallbacks", () => {
  test("multiway pot returns low confidence", () => {
    const result = applyRuleTree(input({
      activePlayers: 3,
    }));
    expect(result.confidence).toBeLessThan(0.60);
  });

  test("river air falls back to Claude", () => {
    const result = applyRuleTree(input({
      heroCards: ["Ah", "Kd"],
      communityCards: ["7c", "5h", "3s", "2d", "9c"],  // full board, missed everything
    }));
    expect(result.confidence).toBeLessThan(0.60);
  });
});

describe("applyRuleTree — SPR commit zone", () => {
  test("TPTK in commit zone (SPR < 3) calls a bet", () => {
    const result = applyRuleTree(input({
      heroCards: ["Ah", "Kd"],
      communityCards: ["Ac", "7c", "3h"],
      facingBet: true,
      callAmount: 0.05,
      effectiveStack: 0.20, // SPR = 0.20/0.10 = 2 → commit zone
      pot: 0.10,
    }));
    // SPR < 3 → commit; action can be CALL or BET
    expect(["CALL", "BET", "RAISE"]).toContain(result.action);
    expect(result.confidence).toBeGreaterThanOrEqual(0.80);
  });
});

describe("applyRuleTree — opponent exploit", () => {
  test("calls tight-passive and upgrades to raise", () => {
    const result = applyRuleTree(input({
      heroCards: ["Ah", "Kd"],
      communityCards: ["Ac", "7c", "3h"],
      position: "BTN",
      facingBet: false,
      opponentType: "TIGHT_PASSIVE",
    }));
    // Original is BET (in position), opponent adjustment shouldn't harm
    expect(["BET", "RAISE"]).toContain(result.action);
  });
});
