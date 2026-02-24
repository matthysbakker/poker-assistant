import { z } from "zod";
import { selectPersona } from "@/lib/poker/persona-selector";
import { getPersonaRecommendations } from "@/lib/poker/persona-lookup";
import type { TableTemperature } from "@/lib/poker/table-temperature";
import type { ChartPosition } from "@/lib/poker/personas";

const VALID_POSITIONS = ["UTG", "MP", "CO", "BTN", "SB", "BB"] as const;
const VALID_TEMPERATURES = [
  "tight_passive", "loose_passive", "tight_aggressive",
  "loose_aggressive", "balanced", "unknown",
] as const;

const requestSchema = z.object({
  heroCards: z.string().min(1),
  position: z.string(),
  temperature: z.string().optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const { heroCards, position, temperature } = parsed.data;

  // Normalise position — "BTN/SB" (heads-up) → "BTN"
  const normalisedPosition = position.split("/")[0];
  if (!VALID_POSITIONS.includes(normalisedPosition as ChartPosition)) {
    return Response.json({ error: `Unknown position: ${position}` }, { status: 400 });
  }

  const temp: TableTemperature = VALID_TEMPERATURES.includes(temperature as TableTemperature)
    ? (temperature as TableTemperature)
    : "unknown";

  const selection = selectPersona(temp, heroCards, normalisedPosition as ChartPosition);
  if (!selection) {
    return Response.json({ error: "Could not select persona for given cards/position." }, { status: 422 });
  }

  const allRecs = getPersonaRecommendations(heroCards, normalisedPosition as ChartPosition) ?? [];

  return Response.json({
    personaName: selection.persona.name,
    action: selection.action,
    temperature: temp,
    rotated: selection.rotated,
    allPersonas: allRecs.map(r => ({
      name: r.persona.name,
      action: r.action,
      selected: r.persona.id === selection.persona.id,
    })),
  });
}
