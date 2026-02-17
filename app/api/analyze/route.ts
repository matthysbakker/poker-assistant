import { z } from "zod";
import { writeFile } from "fs/promises";
import { join } from "path";
import { analyzeHand } from "@/lib/ai/analyze-hand";
import { detectCards } from "@/lib/card-detection";

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
  image: z.string().min(1),
  opponentHistory: opponentHistorySchema.optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request. Expected { image: string }." },
      { status: 400 },
    );
  }

  // Save capture to disk for card detection development
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = join(process.cwd(), "test/captures", `${timestamp}.png`);
  writeFile(filePath, Buffer.from(parsed.data.image, "base64")).catch(() => {});

  // Run deterministic card detection before Claude
  let detectedCards: string | undefined;
  try {
    const detection = await detectCards(parsed.data.image);
    if (detection.detectedText) {
      detectedCards = detection.detectedText;
      console.log(`[card-detection] ${detection.detectedText} (${detection.timing}ms)`);
    }
  } catch (err) {
    console.error("[card-detection] Failed, falling back to Vision:", err);
  }

  const result = analyzeHand(parsed.data.image, parsed.data.opponentHistory, detectedCards);
  return result.toTextStreamResponse();
}
