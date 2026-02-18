import { z } from "zod";
import { detectCards } from "@/lib/card-detection";

const requestSchema = z.object({
  image: z.string().min(1),
});

/** Lightweight detection-only endpoint. Returns cards + heroTurn, no Claude. */
export async function POST(req: Request) {
  const body = await req.json();
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request. Expected { image: string }." },
      { status: 400 },
    );
  }

  const detection = await detectCards(parsed.data.image);

  return Response.json({
    heroCards: detection.heroCards,
    communityCards: detection.communityCards,
    detectedText: detection.detectedText,
    heroTurn: detection.heroTurn,
    timing: detection.timing,
  });
}
