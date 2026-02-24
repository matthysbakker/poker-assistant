import { z } from "zod";
import { writeFile } from "fs/promises";
import { join } from "path";
import { analyzeHand } from "@/lib/ai/analyze-hand";
import { detectCards } from "@/lib/card-detection";
import type { DetectionResult } from "@/lib/card-detection/types";
import { positionSchema } from "@/lib/card-detection/types";
import { tableTemperatureSchema } from "@/lib/poker/table-temperature";
import {
  writeHandRecord,
  type HandRecord,
} from "@/lib/storage/hand-records";
import { parseDomCards } from "@/lib/hand-tracking/hand-context";

export const maxDuration = 30;

let lastAnalyzeMs = 0;
const MIN_ANALYZE_INTERVAL_MS = 3000;

/** Replace obvious Claude OCR outliers with "[misread]" */
function sanitizeAmount(value: string, maxReasonable: number): string {
  const num = parseFloat(value.replace(/[€$£, ]/g, ""));
  if (!isNaN(num) && num > maxReasonable) return "[misread]";
  return value;
}

/** Filter card matches to HIGH/MEDIUM confidence and join into a space-separated string. */
function extractConfidentCards(matches: { card: string | null; confidence: string }[]): string {
  return matches
    .filter((m) => m.confidence === "HIGH" || m.confidence === "MEDIUM")
    .map((m) => m.card)
    .filter((c): c is string => c !== null && c.length > 0)
    .join(" ");
}

/** DOM cards take absolute priority; fall back to image detection. */
function resolveHeroCards(domCards: string[], detection: DetectionResult | null): string {
  if (domCards.length > 0) return domCards.join(" ");
  return extractConfidentCards(detection?.heroCards ?? []);
}

/** DOM cards take absolute priority; fall back to image detection. */
function resolveCommunityCards(domCards: string[], detection: DetectionResult | null): string {
  if (domCards.length > 0) return domCards.join(" ");
  return extractConfidentCards(detection?.communityCards ?? []);
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
  const now = Date.now();
  if (now - lastAnalyzeMs < MIN_ANALYZE_INTERVAL_MS) {
    return Response.json({ error: "Rate limit: too many requests." }, { status: 429 });
  }
  lastAnalyzeMs = now;

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

  const imageBytes = Buffer.byteLength(parsed.data.image, "base64");
  if (imageBytes > 8_000_000) {
    return Response.json({ error: "Image too large." }, { status: 413 });
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

  // Image detection: only run if heroPosition is not already provided by the client.
  // When heroPosition is known (DOM-scraped), we skip the expensive detectCards call.
  let detection: DetectionResult | null = null;
  if (!parsed.data.heroPosition) {
    try {
      detection = await detectCards(parsed.data.image);
    } catch (err) {
      console.error("[card-detection] Failed:", err);
    }
  }

  // Build detectedCards string for Claude: DOM cards take priority over image detection
  let detectedCards: string | undefined;
  {
    const parts: string[] = [];
    // Position: prefer image detection result, fall back to request body value
    const position = detection?.heroPosition ?? parsed.data.heroPosition ?? null;
    if (position) parts.push(`Hero position: ${position}`);

    const hero = resolveHeroCards(domCards.heroCards, detection);
    if (hero) {
      parts.push(`Hero: ${hero}`);
      if (domCards.heroCards.length > 0) console.log(`[dom-cards] Hero: ${hero}`);
    }

    const board = resolveCommunityCards(domCards.communityCards, detection);
    if (board) parts.push(`Board: ${board}`);

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

        // Enforce ground truth cards in stored record — DOM cards take absolute priority.
        // Note: storage path intentionally adds ?? placeholders for missing hero cards
        // (unlike the Claude prompt path which omits partial cards). This divergence is
        // deliberate: storage must always record two card slots for Texas Hold'em hands.
        const storedHero = (() => {
          if (domCards.heroCards.length > 0) return domCards.heroCards.join(" ");
          const imgHero = resolveHeroCards(domCards.heroCards, detection);
          if (!imgHero) return null;
          const count = imgHero.split(" ").length;
          return count < 2 ? (imgHero + " ??".repeat(2 - count)).trim() : imgHero;
        })();
        if (storedHero) analysis = { ...analysis, heroCards: storedHero };

        const storedBoard = resolveCommunityCards(domCards.communityCards, detection);
        if (storedBoard) analysis = { ...analysis, communityCards: storedBoard };

        const record: HandRecord = {
          id: handId,
          timestamp,
          captureMode,
          sessionId: parsed.data.sessionId ?? null,
          pokerHandId: parsed.data.pokerHandId ?? null,
          screenshotFile: `${timestamp.slice(0, 10)}/${handId}.png`,
          detectedText: detectedCards ?? null,
          heroCardMatches: detection?.heroCards?.map((m) => ({ card: m.card ?? "", confidence: m.confidence })) ?? null,
          communityCardMatches: detection?.communityCards?.map((m) => ({ card: m.card ?? "", confidence: m.confidence })) ?? null,
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
