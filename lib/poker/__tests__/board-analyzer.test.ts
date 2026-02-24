import { describe, test, expect, beforeEach } from "bun:test";
import { analyzeBoard, betFractionFromWetScore, clearBoardCache } from "../board-analyzer";

beforeEach(() => clearBoardCache());

describe("analyzeBoard — suitedness", () => {
  test("rainbow (3 different suits)", () => {
    const b = analyzeBoard(["Ah", "Kd", "7c"]);
    expect(b.suitedness).toBe(0);
  });

  test("two-tone (2 same suit)", () => {
    const b = analyzeBoard(["Ah", "Kh", "7c"]);
    expect(b.suitedness).toBe(1);
  });

  test("monotone (3 same suit)", () => {
    const b = analyzeBoard(["Ah", "Kh", "7h"]);
    expect(b.suitedness).toBe(2);
  });
});

describe("analyzeBoard — paired", () => {
  test("unpaired board", () => {
    expect(analyzeBoard(["Ah", "Kd", "7c"]).paired).toBe(false);
  });

  test("paired board", () => {
    expect(analyzeBoard(["Ah", "Ad", "7c"]).paired).toBe(true);
  });
});

describe("analyzeBoard — connectivity", () => {
  test("connected board (max gap ≤ 2)", () => {
    const b = analyzeBoard(["9h", "8d", "7c"]);
    expect(b.connected).toBe(true);
  });

  test("semi-connected (gap = 3)", () => {
    const b = analyzeBoard(["Jh", "8d", "5c"]);
    expect(b.semiConnected).toBe(true);
    expect(b.connected).toBe(false);
  });

  test("disconnected board", () => {
    const b = analyzeBoard(["Ah", "7d", "2c"]);
    expect(b.connected).toBe(false);
    expect(b.semiConnected).toBe(false);
  });
});

describe("analyzeBoard — high/low cards", () => {
  test("high card board (has Q+)", () => {
    expect(analyzeBoard(["Ah", "Kd", "7c"]).highCards).toBe(true);
  });

  test("low card board (all ≤ 7)", () => {
    const b = analyzeBoard(["7h", "5d", "2c"]);
    expect(b.lowCards).toBe(true);
    expect(b.highCards).toBe(false);
  });
});

describe("analyzeBoard — street detection", () => {
  test("flop = 3 cards", () => {
    expect(analyzeBoard(["Ah", "Kd", "7c"]).street).toBe("flop");
  });

  test("turn = 4 cards", () => {
    expect(analyzeBoard(["Ah", "Kd", "7c", "2h"]).street).toBe("turn");
  });

  test("river = 5 cards", () => {
    expect(analyzeBoard(["Ah", "Kd", "7c", "2h", "Js"]).street).toBe("river");
  });
});

describe("analyzeBoard — wetScore and bet fractions", () => {
  test("monotone board → wetScore 4 → 33% bet", () => {
    const b = analyzeBoard(["Ah", "Kh", "7h"]);
    expect(b.wetScore).toBe(4);
    expect(betFractionFromWetScore(b.wetScore)).toBe(0.33);
  });

  test("dry paired rainbow → wetScore 0 → 33% bet", () => {
    const b = analyzeBoard(["Ah", "Ad", "7c"]);
    expect(b.wetScore).toBe(0);
    expect(betFractionFromWetScore(b.wetScore)).toBe(0.33);
  });

  test("connected two-tone → wetScore 3 → 66% bet", () => {
    const b = analyzeBoard(["9h", "8h", "7c"]);
    expect(b.wetScore).toBe(3);
    expect(betFractionFromWetScore(b.wetScore)).toBe(0.66);
  });

  test("semi-connected rainbow → wetScore 2 → 50% bet", () => {
    const b = analyzeBoard(["Jh", "8d", "5c"]);
    expect(b.wetScore).toBe(2);
    expect(betFractionFromWetScore(b.wetScore)).toBe(0.50);
  });
});

describe("analyzeBoard — caching", () => {
  test("same object reference on repeated calls", () => {
    const r1 = analyzeBoard(["Ah", "Kd", "7c"]);
    const r2 = analyzeBoard(["Ah", "Kd", "7c"]);
    expect(r1).toBe(r2);
  });
});
