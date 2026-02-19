import { z } from "zod";
import { detectCards } from "@/lib/card-detection";

export const maxDuration = 10;

const requestSchema = z.object({
  image: z.string().min(1).max(10_000_000),
  hasPosition: z.boolean().optional(),
});

/** Lightweight detection-only endpoint. Returns cards + heroTurn, no Claude. */
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

  try {
    const detection = await detectCards(parsed.data.image, {
      skipDealerDetection: parsed.data.hasPosition,
    });

    return Response.json({
      heroCards: detection.heroCards,
      communityCards: detection.communityCards,
      detectedText: detection.detectedText,
      heroTurn: detection.heroTurn,
      heroPosition: detection.heroPosition,
      timing: detection.timing,
    });
  } catch (err) {
    console.error("[detect] Card detection failed:", err);
    return Response.json(
      { error: "Card detection failed." },
      { status: 500 },
    );
  }
}
