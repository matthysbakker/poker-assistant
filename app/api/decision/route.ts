import { z } from "zod";

const decisionSchema = z.object({
  action: z.enum(["FOLD", "CHECK", "CALL", "RAISE", "BET"]),
  amount: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  source: z.enum(["local", "claude"]),
});

/**
 * POST /api/decision — receives a decision from the local rule engine or Claude
 * forwarded by the browser extension background script.
 *
 * This makes local engine decisions visible to the web app (and any agent
 * querying it), enabling observability and hand history logging.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid decision shape.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const decision = parsed.data;
  console.log(
    `[decision] ${decision.source} → ${decision.action}${decision.amount != null ? ` €${decision.amount}` : ""} (conf ${decision.confidence.toFixed(2)}) — ${decision.reasoning}`,
  );

  return Response.json({ ok: true });
}
