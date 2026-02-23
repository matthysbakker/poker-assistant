import { describe, test, expect } from "bun:test";
import { deriveTableTemperature } from "../table-temperature";

function makeOpponents(types: string[]): Record<number, { inferredType: string }> {
  return Object.fromEntries(types.map((t, i) => [i, { inferredType: t }]));
}

describe("deriveTableTemperature", () => {
  test("returns unknown with fewer than 3 reads", () => {
    expect(deriveTableTemperature(makeOpponents([])).temperature).toBe("unknown");
    expect(deriveTableTemperature(makeOpponents(["TIGHT_PASSIVE"])).temperature).toBe("unknown");
    expect(deriveTableTemperature(makeOpponents(["TIGHT_PASSIVE", "LOOSE_AGGRESSIVE"])).temperature).toBe("unknown");
  });

  test("returns unknown reads count correctly", () => {
    const result = deriveTableTemperature(makeOpponents(["TIGHT_PASSIVE", "UNKNOWN"]));
    expect(result.temperature).toBe("unknown");
    expect(result.reads).toBe(1); // UNKNOWN is excluded
  });

  test("ignores UNKNOWN opponents in classification", () => {
    // 3 TIGHT_PASSIVE + 2 UNKNOWN — should classify as tight_passive
    const opps = makeOpponents(["TIGHT_PASSIVE", "TIGHT_PASSIVE", "TIGHT_PASSIVE", "UNKNOWN", "UNKNOWN"]);
    expect(deriveTableTemperature(opps).temperature).toBe("tight_passive");
    expect(deriveTableTemperature(opps).reads).toBe(3);
  });

  test("classifies tight_passive majority", () => {
    const opps = makeOpponents(["TIGHT_PASSIVE", "TIGHT_PASSIVE", "TIGHT_AGGRESSIVE"]);
    expect(deriveTableTemperature(opps).temperature).toBe("tight_passive");
  });

  test("classifies loose_passive majority", () => {
    const opps = makeOpponents(["LOOSE_PASSIVE", "LOOSE_PASSIVE", "TIGHT_AGGRESSIVE"]);
    expect(deriveTableTemperature(opps).temperature).toBe("loose_passive");
  });

  test("classifies tight_aggressive majority", () => {
    const opps = makeOpponents(["TIGHT_AGGRESSIVE", "TIGHT_AGGRESSIVE", "LOOSE_PASSIVE"]);
    expect(deriveTableTemperature(opps).temperature).toBe("tight_aggressive");
  });

  test("classifies loose_aggressive majority", () => {
    const opps = makeOpponents(["LOOSE_AGGRESSIVE", "LOOSE_AGGRESSIVE", "TIGHT_PASSIVE"]);
    expect(deriveTableTemperature(opps).temperature).toBe("loose_aggressive");
  });

  test("returns balanced when no strict majority", () => {
    // 2 tight_passive + 2 loose_aggressive = 50% each → balanced
    const opps = makeOpponents(["TIGHT_PASSIVE", "TIGHT_PASSIVE", "LOOSE_AGGRESSIVE", "LOOSE_AGGRESSIVE"]);
    expect(deriveTableTemperature(opps).temperature).toBe("balanced");
  });

  test("returns balanced with mixed 4-way split", () => {
    const opps = makeOpponents([
      "TIGHT_PASSIVE",
      "TIGHT_AGGRESSIVE",
      "LOOSE_PASSIVE",
      "LOOSE_AGGRESSIVE",
    ]);
    expect(deriveTableTemperature(opps).temperature).toBe("balanced");
  });

  test("reports correct reads count", () => {
    const opps = makeOpponents(["TIGHT_PASSIVE", "TIGHT_PASSIVE", "LOOSE_AGGRESSIVE"]);
    expect(deriveTableTemperature(opps).reads).toBe(3);
  });

  test("strict majority threshold — exactly 50% is balanced", () => {
    const opps = makeOpponents(["TIGHT_PASSIVE", "TIGHT_PASSIVE", "TIGHT_PASSIVE", "TIGHT_AGGRESSIVE", "TIGHT_AGGRESSIVE", "TIGHT_AGGRESSIVE"]);
    expect(deriveTableTemperature(opps).temperature).toBe("balanced");
  });
});
