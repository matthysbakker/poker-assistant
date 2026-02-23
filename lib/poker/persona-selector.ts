/**
 * Selects the most profitable persona for the current table temperature.
 *
 * When two personas are equally suited (tie in the selection matrix), one is
 * chosen randomly per hand — making the hero's style unreadable to regulars.
 */

import { PERSONAS } from "@/lib/poker/personas";
import type { Persona, PersonaAction, ChartPosition } from "@/lib/poker/personas";
import { getPersonaRecommendations } from "@/lib/poker/persona-lookup";
import type { TableTemperature } from "@/lib/poker/table-temperature";

export interface SelectedPersona {
  persona: Persona;
  action: PersonaAction;
  /** Other equally valid personas for this table (shown in UI as alternatives). */
  alternatives: Persona[];
  /** True when this was a random pick from multiple tied candidates. */
  rotated: boolean;
}

/**
 * Persona IDs recommended for each table temperature.
 *
 * Rationale:
 *   tight_passive   → Exploit Hawk steals from folders; LAG Assassin applies relentless pressure
 *   loose_passive   → TAG Shark extracts max value from callers
 *   tight_aggressive → GTO Grinder is unexploitable; TAG Shark stays disciplined
 *   loose_aggressive → GTO Grinder only (balanced, non-exploitable vs maniacs)
 *   balanced/unknown → GTO Grinder (safest default against unknown population)
 */
const SELECTION_MATRIX: Record<TableTemperature, string[]> = {
  tight_passive: ["exploit_hawk", "lag_assassin"],
  loose_passive: ["tag_shark"],
  tight_aggressive: ["gto_grinder", "tag_shark"],
  loose_aggressive: ["gto_grinder"],
  balanced: ["gto_grinder"],
  unknown: ["gto_grinder"],
};

/** Fallback persona ID when something goes wrong. */
const FALLBACK_ID = "gto_grinder";

/**
 * Picks the best persona for the given table temperature + hero hand.
 *
 * @param temperature - Derived from deriveTableTemperature()
 * @param heroCards   - e.g. "Ah Kd"
 * @param position    - e.g. "CO"
 * @param rng         - Random number generator (injectable for tests, defaults to Math.random)
 * @returns SelectedPersona, or null if heroCards can't be parsed
 */
export function selectPersona(
  temperature: TableTemperature,
  heroCards: string,
  position: ChartPosition,
  rng: () => number = Math.random,
): SelectedPersona | null {
  const recs = getPersonaRecommendations(heroCards, position);
  if (!recs) return null;

  const candidateIds = SELECTION_MATRIX[temperature];
  const candidates = recs.filter((r) => candidateIds.includes(r.persona.id));

  if (candidates.length === 0) {
    // Safety fallback: always return GTO Grinder
    const fallback = recs.find((r) => r.persona.id === FALLBACK_ID);
    if (!fallback) return null;
    return {
      persona: fallback.persona,
      action: fallback.action,
      alternatives: [],
      rotated: false,
    };
  }

  if (candidates.length === 1) {
    const [chosen] = candidates;
    return {
      persona: chosen.persona,
      action: chosen.action,
      alternatives: [],
      rotated: false,
    };
  }

  // Multiple tied candidates — rotate randomly to prevent predictability
  const idx = Math.floor(rng() * candidates.length);
  const chosen = candidates[idx];
  const alternatives = candidates
    .filter((_, i) => i !== idx)
    .map((r) => r.persona);

  return {
    persona: chosen.persona,
    action: chosen.action,
    alternatives,
    rotated: true,
  };
}
