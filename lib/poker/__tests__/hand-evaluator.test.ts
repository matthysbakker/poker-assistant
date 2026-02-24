import { describe, test, expect, beforeEach } from "bun:test";
import { evaluateHand, clearEvalCache, type HandTier } from "../hand-evaluator";

beforeEach(() => clearEvalCache());

// Helper: assert tier
function tier(heroCards: string[], community: string[]): HandTier {
  return evaluateHand(heroCards, community).tier;
}

describe("evaluateHand — made hands", () => {
  test("straight flush", () => {
    expect(tier(["9h", "8h"], ["7h", "6h", "5h"])).toBe("nut");
  });

  test("quads", () => {
    expect(tier(["Ah", "Ad"], ["Ac", "As", "Kd"])).toBe("nut");
  });

  test("nut flush (A-high)", () => {
    expect(tier(["Ah", "Jh"], ["8h", "5h", "2h"])).toBe("nut");
  });

  test("non-nut flush", () => {
    expect(tier(["Kh", "Jh"], ["8h", "5h", "2h"])).toBe("strong");
  });

  test("full house", () => {
    expect(tier(["Ah", "Ad"], ["Ac", "Kh", "Kd"])).toBe("strong");
  });

  test("straight", () => {
    expect(tier(["9h", "8d"], ["7c", "6s", "5h"])).toBe("strong");
  });

  test("set (trips using hole card)", () => {
    expect(tier(["Ah", "Ad"], ["Ac", "Kd", "7c"])).toBe("strong");
  });

  test("trips on board (weaker)", () => {
    // Hero has K/Q, board has trip Aces — hero doesn't hold an Ace
    expect(tier(["Kh", "Qd"], ["Ac", "Ad", "As"])).toBe("medium");
  });

  test("two pair", () => {
    expect(tier(["Ah", "Kh"], ["Ad", "Kd", "7c"])).toBe("strong");
  });

  test("TPTK", () => {
    expect(tier(["Ah", "Qd"], ["Ac", "Kd", "7c"])).toBe("top_pair_gk");
  });

  test("top pair weak kicker", () => {
    expect(tier(["Ah", "4d"], ["Ac", "Kd", "7c"])).toBe("medium");
  });

  test("overpair", () => {
    expect(tier(["Ah", "Ad"], ["Kd", "7c", "3h"])).toBe("top_pair_gk");
  });

  test("middle pair", () => {
    expect(tier(["7h", "6d"], ["Ac", "7d", "3c"])).toBe("medium");
  });

  test("bottom pair", () => {
    expect(tier(["3h", "2d"], ["Ac", "Kd", "3c"])).toBe("weak");
  });

  test("underpair", () => {
    expect(tier(["5h", "5d"], ["Ac", "Kd", "Qc"])).toBe("weak");
  });
});

describe("evaluateHand — draws", () => {
  test("flush draw (9 outs)", () => {
    expect(tier(["Ah", "Jh"], ["8h", "5h", "2c"])).toBe("draw");
  });

  test("OESD (8 outs)", () => {
    expect(tier(["9c", "8d"], ["7h", "6s", "2c"])).toBe("draw");
  });

  test("gutshot (4 outs)", () => {
    expect(tier(["9c", "5d"], ["7h", "6s", "2c"])).toBe("weak_draw");
  });

  test("air", () => {
    expect(tier(["Ah", "Kd"], ["7c", "5h", "3s"])).toBe("air");
  });
});

describe("evaluateHand — caching", () => {
  test("returns same result on repeated calls", () => {
    const r1 = evaluateHand(["Ah", "Kd"], ["Ac", "7c", "3h"]);
    const r2 = evaluateHand(["Ah", "Kd"], ["Ac", "7c", "3h"]);
    expect(r1).toBe(r2); // same object reference from cache
  });

  test("cache is cleared by clearEvalCache", () => {
    const r1 = evaluateHand(["Ah", "Kd"], ["Ac", "7c", "3h"]);
    clearEvalCache();
    const r2 = evaluateHand(["Ah", "Kd"], ["Ac", "7c", "3h"]);
    expect(r1).not.toBe(r2); // different objects after clear
    expect(r1.tier).toBe(r2.tier); // but same result
  });
});

describe("evaluateHand — card format variants", () => {
  test("accepts '10h' format", () => {
    expect(tier(["10h", "10d"], ["10c", "10s", "Ks"])).toBe("nut"); // four tens = quads
  });

  test("accepts 'Th' legacy format", () => {
    expect(tier(["Th", "Td"], ["Tc", "Ts", "Ks"])).toBe("nut"); // four tens = quads
  });

  test("10h and Th are equivalent", () => {
    const r1 = evaluateHand(["10h", "Kd"], ["Ac", "10d", "3h"]);
    const r2 = evaluateHand(["Th", "Kd"], ["Ac", "10d", "3h"]);
    expect(r1.tier).toBe(r2.tier);
  });
});
