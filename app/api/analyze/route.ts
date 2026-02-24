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

/** Replace obvious Claude OCR outliers with "[misread]" */
function sanitizeAmount(value: string, maxReasonable: number): string {
  const num = parseFloat(value.replace(/[€$£, ]/g, ""));
  if (!isNaN(num) && num > maxReasonable) return "[misread]";
  return value;
}

/**
 * Parse hero and community cards from the DOM-scraped handContext string.
 * The poker client renders cards as SVG filenames — 100% accurate ground truth.
 * Format: "Hero holds: 6d Qs — OFFSUIT ..." and "Board: Jh Qd 5c"
 */
function parseDomCards(handContext: string | undefined): {
  heroCards: string[];
  communityCards: string[];
} {
  if (!handContext) return { heroCards: [], communityCards: [] };

  const heroMatch = handContext.match(/Hero holds:\s+([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?)/);
  const boardMatch = handContext.match(/Board:\s+([A-Za-z0-9 ]+?)(?:\s*\n|$)/m);

  return {
    heroCards: heroMatch ? heroMatch[1].trim().split(/\s+/).filter(Boolean) : [],
    communityCards: boardMatch ? boardMatch[1].trim().split(/\s+/).filter(Boolean) : [],
  };
}

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

  // DOM cards: parsed from handContext — 100% accurate (SVG filenames from poker client)
  const domCards = parseDomCards(parsed.data.handContext);

  // Image detection: run for dealer button / position only
  let detection: DetectionResult | null = null;
  try {
    detection = await detectCards(parsed.data.image);
  } catch (err) {
    console.error("[card-detection] Failed:", err);
  }

  // Build detectedCards string for Claude: DOM cards take priority over image detection
  let detectedCards: string | undefined;
  {
    const parts: string[] = [];
    const position = detection?.heroPosition;
    if (position) parts.push(`Hero position: ${position}`);

    if (domCards.heroCards.length > 0) {
      parts.push(`Hero: ${domCards.heroCards.join(" ")}`);
      console.log(`[dom-cards] Hero: ${domCards.heroCards.join(" ")}`);
    } else {
      // Fallback to image detection for hero cards
      const imgHero = detection?.heroCards
        .filter((m) => m.confidence === "HIGH" || m.confidence === "MEDIUM")
        .map((m) => m.card).filter(Boolean).join(" ");
      if (imgHero) parts.push(`Hero: ${imgHero}`);
    }

    if (domCards.communityCards.length > 0) {
      parts.push(`Board: ${domCards.communityCards.join(" ")}`);
    } else {
      // Fallback to image detection for community cards
      const imgBoard = detection?.communityCards
        .filter((m) => m.confidence === "HIGH" || m.confidence === "MEDIUM")
        .map((m) => m.card).filter(Boolean).join(" ");
      if (imgBoard) parts.push(`Board: ${imgBoard}`);
    }

    detectedCards = parts.length > 0 ? parts.join(", ") : undefined;
    if (detectedCards) console.log(`[detected] ${detectedCards}`);
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
      .then(async (rawAnalysis) => {
        if (!rawAnalysis.action) return;

        // Sanitize obvious OCR outliers and enforce detected cards as ground truth
        let analysis = {
          ...rawAnalysis,
          potSize: sanitizeAmount(rawAnalysis.potSize, 500),
          heroStack: sanitizeAmount(rawAnalysis.heroStack, 2000),
        };

        // Enforce ground truth cards in stored record — DOM cards take absolute priority
        if (domCards.heroCards.length > 0) {
          analysis = { ...analysis, heroCards: domCards.heroCards.join(" ") };
        } else if (detection) {
          // Fallback: image detection with placeholder for missing cards
          const imgHero = detection.heroCards
            .filter((m) => m.confidence === "HIGH" || m.confidence === "MEDIUM")
            .map((m) => m.card).filter(Boolean).join(" ");
          if (imgHero) {
            const count = imgHero.split(" ").length;
            const withPlaceholders = count < 2 ? imgHero + " ??".repeat(2 - count) : imgHero;
            analysis = { ...analysis, heroCards: withPlaceholders.trim() };
          }
        }

        if (domCards.communityCards.length > 0) {
          analysis = { ...analysis, communityCards: domCards.communityCards.join(" ") };
        } else if (detection) {
          const imgBoard = detection.communityCards
            .filter((m) => m.confidence === "HIGH" || m.confidence === "MEDIUM")
            .map((m) => m.card).filter(Boolean).join(" ");
          if (imgBoard) analysis = { ...analysis, communityCards: imgBoard };
        }

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
