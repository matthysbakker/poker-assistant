import { z } from "zod";
import { positionSchema } from "@/lib/card-detection/types";
import { tableTemperatureSchema } from "@/lib/poker/table-temperature";
import { writeHandRecord, type HandRecord } from "@/lib/storage/hand-records";
import type { HandAnalysis } from "@/lib/ai/schema";

const requestSchema = z.object({
  heroCards: z.array(z.string().max(4)).min(1).max(2),
  position: positionSchema,
  potSize: z.string().nullable(),
  heroStack: z.string().nullable(),
  action: z.enum(["FOLD", "CHECK", "CALL", "RAISE", "BET"]),
  amount: z.number().nullable(),
  reasoning: z.string().max(500),
  personaName: z.string().max(64),
  handContext: z.string().max(5000).nullable(),
  pokerHandId: z.string().nullable(),
  tableTemperature: tableTemperatureSchema.nullable(),
  tableReads: z.number().nullable(),
});

export async function POST(req: Request) {
  if (process.env.SAVE_HANDS !== "true") {
    return Response.json({ ok: true });
  }

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

  const data = parsed.data;
  const handId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const analysis: HandAnalysis = {
    cardReadingNotes: "Cards from DOM — ground truth (SVG filename parsing)",
    heroCards: data.heroCards.join(" "),
    communityCards: "",
    heroPosition: data.position,
    potSize: data.potSize ?? "unknown",
    heroStack: data.heroStack ?? "unknown",
    street: "PREFLOP",
    opponents: [],
    exploitAnalysis: `Persona: ${data.personaName}`,
    action: data.action,
    amount: data.amount != null ? `${data.amount} BB` : undefined,
    confidence: "HIGH",
    reasoning: data.reasoning,
    concept: "Preflop Chart",
  };

  const record: HandRecord = {
    id: handId,
    timestamp,
    captureMode: "continuous",
    sessionId: null,
    pokerHandId: data.pokerHandId ?? null,
    screenshotFile: "",
    detectedText: null,
    heroCardMatches: null,
    communityCardMatches: null,
    handContext: data.handContext ?? null,
    opponentHistory: null,
    systemPromptVariant: "with-detected-cards",
    tableTemperature: data.tableTemperature ?? null,
    tableReads: data.tableReads ?? null,
    heroPosition: data.position,
    personaSelected: {
      personaId: data.personaName.toLowerCase().replace(/\s+/g, "-"),
      personaName: data.personaName,
      action: data.action,
      temperature: data.tableTemperature ?? null,
    },
    analysis,
  };

  try {
    await writeHandRecord(record);
    console.log(`[record] Saved preflop hand ${handId} (${data.action})`);
  } catch (err) {
    // Log but return 200 — must not block the poker tab
    console.warn("[record] Failed to save preflop hand record:", err);
  }

  return Response.json({ ok: true });
}
