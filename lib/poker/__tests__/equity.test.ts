import { describe, test, expect } from "bun:test";
import { parseCard, parseCards } from "../equity/card";
import { analyzeOuts } from "../equity/outs";
import { exactOutEquity } from "../equity/odds";
import { computePotOdds, parseCurrency } from "../equity/pot-odds";
import { impliedOddsBonus } from "../equity/implied-odds";

describe("parseCard", () => {
  test("parses standard cards", () => {
    expect(parseCard("Ah")).toEqual({ rank: 14, suit: 0 });
    expect(parseCard("Kd")).toEqual({ rank: 13, suit: 1 });
    expect(parseCard("2c")).toEqual({ rank: 2, suit: 2 });
    expect(parseCard("9s")).toEqual({ rank: 9, suit: 3 });
  });

  test("parses '10h' format", () => {
    expect(parseCard("10h")).toEqual({ rank: 10, suit: 0 });
    expect(parseCard("10s")).toEqual({ rank: 10, suit: 3 });
  });

  test("parses legacy 'Th' format", () => {
    expect(parseCard("Th")).toEqual({ rank: 10, suit: 0 });
  });

  test("returns null for invalid input", () => {
    expect(parseCard("")).toBeNull();
    expect(parseCard("X")).toBeNull();
    expect(parseCard("11h")).toBeNull();
  });

  test("parseCards skips invalid", () => {
    const cards = parseCards(["Ah", "invalid", "Kd"]);
    expect(cards).toHaveLength(2);
  });
});

describe("analyzeOuts", () => {
  test("flush draw = 9 outs", () => {
    const cards = parseCards(["Ah", "Jh", "8h", "5h", "2c"]);
    const out = analyzeOuts(cards);
    expect(out.flushOuts).toBe(9);
  });

  test("OESD = 8 outs", () => {
    const cards = parseCards(["9c", "8d", "7h", "6s", "2c"]);
    const out = analyzeOuts(cards);
    expect(out.oesd).toBe(8);
  });

  test("no draw", () => {
    const cards = parseCards(["Ah", "Kd", "7c", "3h", "2s"]);
    const out = analyzeOuts(cards);
    expect(out.totalRawOuts).toBe(0);
  });
});

describe("exactOutEquity", () => {
  test("flush draw on turn (1 street, 9 outs, 6 cards seen)", () => {
    // 9 / (52-6) = 9/46 ≈ 0.196
    const eq = exactOutEquity(9, 6, 1);
    expect(eq).toBeCloseTo(0.196, 2);
  });

  test("flush draw on flop (2 streets, 5 cards seen)", () => {
    // 1 - (37/47 * 36/46) ≈ 0.349
    const eq = exactOutEquity(9, 5, 2);
    expect(eq).toBeCloseTo(0.349, 2);
  });

  test("0 outs = 0 equity", () => {
    expect(exactOutEquity(0, 5, 1)).toBe(0);
  });
});

describe("computePotOdds", () => {
  test("call €0.04 into €0.08 pot = 33%", () => {
    // call 0.04 / (pot 0.08 + call 0.04) = 0.04/0.12 = 0.333
    expect(computePotOdds(0.04, 0.08)).toBeCloseTo(0.333, 2);
  });

  test("0 call = 0 odds", () => {
    expect(computePotOdds(0, 0.10)).toBe(0);
  });
});

describe("parseCurrency", () => {
  test("parses euro string", () => {
    expect(parseCurrency("€0.06")).toBeCloseTo(0.06);
    expect(parseCurrency("€1.50")).toBeCloseTo(1.5);
  });

  test("handles null/undefined", () => {
    expect(parseCurrency(null)).toBe(0);
    expect(parseCurrency(undefined)).toBe(0);
    expect(parseCurrency("")).toBe(0);
  });
});

describe("impliedOddsBonus", () => {
  test("flush draw gets positive bonus", () => {
    const bonus = impliedOddsBonus(9, 0, 5);
    expect(bonus).toBeGreaterThan(0);
  });

  test("no draws = 0 bonus", () => {
    expect(impliedOddsBonus(0, 0, 5)).toBe(0);
  });

  test("deep stacks multiply bonus", () => {
    const shallow = impliedOddsBonus(9, 0, 3);
    const deep = impliedOddsBonus(9, 0, 15);
    expect(deep).toBeGreaterThan(shallow);
  });

  test("bonus never exceeds 0.15", () => {
    expect(impliedOddsBonus(9, 8, 20)).toBeLessThanOrEqual(0.15);
  });
});
