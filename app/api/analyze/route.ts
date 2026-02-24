import { z } from "zod";
import { writeFile } from "fs/promises";
import { join } from "path";
import { analyzeHand } from "@/lib/ai/analyze-hand";
import { detectCards } from "@/lib/card-detection";
import type { DetectionResult } from "@/lib/card-detection/types";
import { positionSchema } from "@/lib/card-detection/types";
import { tableTemperatureSchema } from "@/lib/poker/table-temperature";
import {
  buildDetectionDetails,
  writeHandRecord,
  type HandRecord,
} from "@/lib/storage/hand-records";

export const maxDuration = 30;

const opponentHistorySchema = z.record(
  z.coerce.number(),
  z.object({
    username: z.string().optional(),
    handsObserved: z.number(),
    actions: z.array(z.string().max(200)).max(20),
    inferredType: z.string(),
    notes: z.string().max(500).optional(),
  }),
);

const requestSchema = z.object({
  image: z.string().min(1).max(10_000_000),
  opponentHistory: opponentHistorySchema.optional(),
  handContext: z.string().max(5000).optional(),
  captureMode: z.enum(["manual", "continuous"]).optional(),
  // Capture context for hand record enrichment
  sessionId: z.string().uuid().optional(),
  pokerHandId: z.string().uuid().nullable().optional(),
  tableTemperature: tableTemperatureSchema.nullable().optional(),
  tableReads: z.number().nullable().optional(),
  heroPosition: positionSchema.nullable().optional(),
  personaSelected: z
    .object({
      personaId: z.string().max(64),
      personaName: z.string().max(64),
      action: z.string().max(64),
      temperature: tableTemperatureSchema.nullable(),
    })
    .nullable()
    .optional(),
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
    return Response.json(
      { error: "Invalid request. Expected { image: string }." },
      { status: 400 },
    );
  }

  // Save capture to disk (opt-in via SAVE_CAPTURES=true)
  if (process.env.SAVE_CAPTURES === "true") {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = join(process.cwd(), "test/captures", `${timestamp}.png`);
    writeFile(filePath, Buffer.from(parsed.data.image, "base64")).catch(
      (err: unknown) => {
        console.error("[captures] Failed to write capture file:", err);
      },
    );
  }

  // Run deterministic card detection before Claude
  let detectedCards: string | undefined;
  let detection: DetectionResult | null = null;
  try {
    detection = await detectCards(parsed.data.image);
    if (detection.detectedText) {
      detectedCards = detection.detectedText;
      console.log(`[card-detection] ${detection.detectedText} (${detection.timing}ms)`);
    }
  } catch (err) {
    console.error("[card-detection] Failed, falling back to Vision:", err);
  }

  const captureMode = parsed.data.captureMode ?? "manual";

  const result = analyzeHand(
    parsed.data.image,
    parsed.data.opponentHistory,
    detectedCards,
    parsed.data.handContext,
    captureMode,
  );

  // Non-blocking: save hand record to disk when stream completes
  if (process.env.SAVE_HANDS === "true") {
    const imageBuffer = Buffer.from(parsed.data.image, "base64");
    const handId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    result.object
      .then(async (analysis) => {
        if (!analysis.action) return;

        const record: HandRecord = {
          id: handId,
          timestamp,
          captureMode,
          sessionId: parsed.data.sessionId ?? null,
          pokerHandId: parsed.data.pokerHandId ?? null,
          screenshotFile: `${timestamp.slice(0, 10)}/${handId}.png`,
          detectedText: detectedCards ?? null,
          detectionDetails: buildDetectionDetails(detection),
          handContext: parsed.data.handContext ?? null,
          opponentHistory: parsed.data.opponentHistory ?? null,
          systemPromptVariant: detectedCards
            ? "with-detected-cards"
            : "standard",
          tableTemperature: parsed.data.tableTemperature ?? null,
          tableReads: parsed.data.tableReads ?? null,
          heroPosition: parsed.data.heroPosition ?? null,
          personaSelected: parsed.data.personaSelected ?? null,
          analysis,
        };

        await writeHandRecord(record, imageBuffer);
        console.log(`[hands] Saved ${handId} (${record.captureMode})`);
      })
      .catch((err: unknown) => {
        console.warn("[hands] Failed to save hand record:", err);
      });
  }

  return result.toTextStreamResponse();
}
