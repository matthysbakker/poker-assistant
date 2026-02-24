/**
 * Derives a "table temperature" from the session's accumulated opponent types.
 *
 * Selection matrix (used by persona-selector):
 *   tight_passive   → Exploit Hawk + LAG Assassin (they fold too much — steal wide)
 *   loose_passive   → TAG Shark (they call too much — value bet relentlessly)
 *   tight_aggressive → GTO Grinder + TAG Shark (they fight back — stay unexploitable)
 *   loose_aggressive → GTO Grinder (they bluff too much — GTO is non-exploitable)
 *   balanced/unknown → GTO Grinder (safe default)
 */

import { z } from "zod";

export const tableTemperatureSchema = z.enum([
  "tight_passive",
  "tight_aggressive",
  "loose_passive",
  "loose_aggressive",
  "balanced",
  "unknown",
]);

export type TableTemperature = z.infer<typeof tableTemperatureSchema>;

export interface TableProfile {
  temperature: TableTemperature;
  /** Number of opponents with a known (non-UNKNOWN) player type. */
  reads: number;
}

/** Minimum number of classified opponents needed before we trust the temperature. */
const MIN_READS = 3;

// Keys must match the inferredType values emitted by lib/ai/schema.ts → Opponent.inferredType
const TYPE_MAP: Record<string, TableTemperature> = {
  TIGHT_PASSIVE: "tight_passive",
  TIGHT_AGGRESSIVE: "tight_aggressive",
  LOOSE_PASSIVE: "loose_passive",
  LOOSE_AGGRESSIVE: "loose_aggressive",
};

/**
 * Classifies the table based on aggregated opponent player types from the
 * current session (PokerSession.opponents).
 *
 * A temperature is declared when one type has a strict majority (>50%).
 * With fewer than MIN_READS known opponents, returns "unknown".
 */
export function deriveTableTemperature(
  opponents: Record<number, { inferredType: string }>,
): TableProfile {
  const known = Object.values(opponents).filter(
    (o) => o.inferredType !== "UNKNOWN",
  );
  const reads = known.length;

  if (reads < MIN_READS) {
    return { temperature: "unknown", reads };
  }

  const counts: Record<string, number> = {};
  for (const o of known) {
    counts[o.inferredType] = (counts[o.inferredType] ?? 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [dominantType, dominantCount] = sorted[0];

  // Require a strict majority (>50%) to declare a temperature
  if (dominantCount / reads <= 0.5) {
    return { temperature: "balanced", reads };
  }

  return {
    temperature: TYPE_MAP[dominantType] ?? "balanced",
    reads,
  };
}
