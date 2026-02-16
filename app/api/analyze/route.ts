import { z } from "zod";
import { analyzeHand } from "@/lib/ai/analyze-hand";

export const maxDuration = 30;

const requestSchema = z.object({
  image: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request. Expected { image: string }." },
      { status: 400 }
    );
  }

  const result = analyzeHand(parsed.data.image);
  return result.toTextStreamResponse();
}
