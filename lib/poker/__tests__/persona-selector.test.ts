import { describe, test, expect } from "bun:test";
import { selectPersona } from "../persona-selector";

describe("selectPersona", () => {
  test("returns null for unparseable hero cards", () => {
    expect(selectPersona("unknown", "?? ??", "BTN")).toBeNull();
  });

  // unknown / balanced / loose_aggressive → GTO Grinder
  test("unknown temperature → GTO Grinder", () => {
    const result = selectPersona("unknown", "Ah Kd", "CO");
    expect(result!.persona.id).toBe("gto_grinder");
    expect(result!.rotated).toBe(false);
  });

  test("balanced temperature → GTO Grinder", () => {
    const result = selectPersona("balanced", "Ah Kd", "CO");
    expect(result!.persona.id).toBe("gto_grinder");
  });

  test("loose_aggressive temperature → GTO Grinder", () => {
    const result = selectPersona("loose_aggressive", "Ah Kd", "BTN");
    expect(result!.persona.id).toBe("gto_grinder");
  });

  // loose_passive → TAG Shark (single candidate, no rotation)
  test("loose_passive temperature → TAG Shark", () => {
    const result = selectPersona("loose_passive", "Ah Kd", "CO");
    expect(result!.persona.id).toBe("tag_shark");
    expect(result!.rotated).toBe(false);
  });

  // tight_passive → Exploit Hawk or LAG Assassin (tied, random)
  test("tight_passive temperature → exploit_hawk or lag_assassin", () => {
    const result = selectPersona("tight_passive", "Ah Kd", "BTN");
    expect(["exploit_hawk", "lag_assassin"]).toContain(result!.persona.id);
    expect(result!.rotated).toBe(true);
  });

  test("tight_passive rotation — both options reachable", () => {
    const ids = new Set<string>();
    // With enough iterations both should appear
    for (let i = 0; i < 200; i++) {
      const result = selectPersona("tight_passive", "Ah Kd", "BTN", Math.random);
      if (result) ids.add(result.persona.id);
    }
    expect(ids.has("exploit_hawk")).toBe(true);
    expect(ids.has("lag_assassin")).toBe(true);
  });

  test("tight_passive rotation — injectable rng picks correctly", () => {
    // rng=0 → first candidate
    const first = selectPersona("tight_passive", "Ah Kd", "BTN", () => 0);
    // rng=0.99 → last candidate
    const last = selectPersona("tight_passive", "Ah Kd", "BTN", () => 0.99);
    expect(first!.persona.id).not.toBe(last!.persona.id);
    expect(["exploit_hawk", "lag_assassin"]).toContain(first!.persona.id);
    expect(["exploit_hawk", "lag_assassin"]).toContain(last!.persona.id);
  });

  // tight_aggressive → GTO Grinder or TAG Shark (tied, random)
  test("tight_aggressive temperature → gto_grinder or tag_shark", () => {
    const result = selectPersona("tight_aggressive", "Ah Kd", "CO");
    expect(["gto_grinder", "tag_shark"]).toContain(result!.persona.id);
    expect(result!.rotated).toBe(true);
  });

  test("tight_aggressive rotation — both options reachable", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const result = selectPersona("tight_aggressive", "Ah Kd", "CO", Math.random);
      if (result) ids.add(result.persona.id);
    }
    expect(ids.has("gto_grinder")).toBe(true);
    expect(ids.has("tag_shark")).toBe(true);
  });

  // All 6 temperatures return non-null for a parseable hand across all positions
  test.each(["tight_passive", "loose_passive", "tight_aggressive", "loose_aggressive", "balanced", "unknown"] as const)(
    "temperature %s returns non-null for AKs CO",
    (temp) => {
      const result = selectPersona(temp, "Ah Kd", "CO");
      expect(result).not.toBeNull();
      expect(["RAISE", "CALL", "FOLD"]).toContain(result!.action);
    },
  );

  // Returns a valid action from the persona chart
  test("returns correct action from persona chart", () => {
    // AKs from CO is RAISE for all profitable personas
    const result = selectPersona("unknown", "Ah Kd", "CO");
    expect(result!.action).toBe("RAISE");
  });

  // Works for all 6 positions
  test.each(["UTG", "MP", "CO", "BTN", "SB", "BB"] as const)(
    "works for position %s",
    (pos: "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB") => {
      const result = selectPersona("unknown", "Ah Kd", pos);
      expect(result).not.toBeNull();
      expect(["RAISE", "CALL", "FOLD"]).toContain(result!.action);
    },
  );
});
