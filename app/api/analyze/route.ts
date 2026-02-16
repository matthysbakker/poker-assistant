import { z } from "zod";
import { analyzeHand } from "@/lib/ai/analyze-hand";

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

  const result = analyzeHand(parsed.data.image, parsed.data.opponentHistory);
  return result.toTextStreamResponse();
}
