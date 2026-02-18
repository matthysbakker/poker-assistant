import { z } from "zod";
import { writeFile } from "fs/promises";
import { join } from "path";
import { analyzeHand } from "@/lib/ai/analyze-hand";
import { detectCards } from "@/lib/card-detection";
import type { DetectionResult } from "@/lib/card-detection/types";
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
    actions: z.array(z.string()),
    inferredType: z.string(),
  }),
);

const requestSchema = z.object({
  image: z.string().min(1).max(10_000_000),
  opponentHistory: opponentHistorySchema.optional(),
  handContext: z.string().optional(),
  captureMode: z.enum(["manual", "continuous"]).optional(),
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

  // Save capture to disk (development only, disabled in continuous mode)
  if (process.env.SAVE_CAPTURES !== "false") {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = join(process.cwd(), "test/captures", `${timestamp}.png`);
    writeFile(filePath, Buffer.from(parsed.data.image, "base64")).catch(() => {});
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

  const result = analyzeHand(
    parsed.data.image,
    parsed.data.opponentHistory,
    detectedCards,
    parsed.data.handContext,
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
          captureMode: parsed.data.captureMode ?? "manual",
          screenshotFile: `${timestamp.slice(0, 10)}/${handId}.png`,
          detectedText: detectedCards ?? null,
          detectionDetails: buildDetectionDetails(detection),
          handContext: parsed.data.handContext ?? null,
          opponentHistory: parsed.data.opponentHistory ?? null,
          systemPromptVariant: detectedCards
            ? "with-detected-cards"
            : "standard",
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
