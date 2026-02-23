import { z } from "zod";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { autopilotActionSchema } from "@/lib/ai/autopilot-schema";
import { AUTOPILOT_SYSTEM_PROMPT } from "@/lib/ai/autopilot-prompt";

export const maxDuration = 15;

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000), // one poker street of context is well under this
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(20), // max ~5 streets × 4 messages
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
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"),
      schema: autopilotActionSchema,
      system: AUTOPILOT_SYSTEM_PROMPT,
      messages: parsed.data.messages,
    });

    console.log(
      `[autopilot] ${object.action}${object.amount ? ` €${object.amount}` : ""} — ${object.reasoning}`,
    );

    return Response.json(object);
  } catch (err) {
    console.error("[autopilot] Claude API error:", err);
    return Response.json({ error: "Claude API unavailable" }, { status: 503 });
  }
}
