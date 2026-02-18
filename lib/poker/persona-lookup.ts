import { PERSONAS, type Persona, type PersonaAction, type ChartPosition } from "./personas";
import { toHandNotation } from "./hand-notation";

export interface PersonaRecommendation {
  persona: Persona;
  action: PersonaAction;
}

/**
 * Look up all 4 persona recommendations for a given hand + position.
 *
 * @param heroCards - AI format, e.g. "Ah Kd"
 * @param position - Table position, e.g. "CO"
 * @returns Array of 4 persona recommendations, or null if hand can't be parsed
 */
export function getPersonaRecommendations(
  heroCards: string,
  position: ChartPosition,
): PersonaRecommendation[] | null {
  const handKey = toHandNotation(heroCards);
  if (!handKey) return null;

  return PERSONAS.map((persona) => ({
    persona,
    action: persona.charts[position]?.[handKey] ?? "FOLD",
  }));
}
