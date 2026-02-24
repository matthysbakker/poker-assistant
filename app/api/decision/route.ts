import { z } from "zod";
import { writeDecisionRecord } from "@/lib/storage/decision-records";

const decisionSchema = z.object({
  action: z.enum(["FOLD", "CHECK", "CALL", "RAISE", "BET"]),
  amount: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500),
  source: z.enum(["local", "claude"]),
  street: z.string().optional(),
  heroCards: z.string().nullable().optional(),
  communityCards: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
});

/**
 * POST /api/decision — receives a decision from the local rule engine or Claude,
 * forwarded by the browser extension background script.
 *
 * Logs the decision and, when SAVE_HANDS=true, persists it to disk under
 * data/decisions/<date>/<id>.json for hand-history review and debugging.
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

  const saving = process.env.SAVE_HANDS === "true";
  if (saving) {
    const record = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action: decision.action,
      amount: decision.amount != null ? String(decision.amount) : null,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      street: decision.street ?? "unknown",
      source: decision.source,
      heroCards: decision.heroCards ?? null,
      communityCards: decision.communityCards ?? null,
      position: decision.position ?? null,
    };
    writeDecisionRecord(record).catch((err) =>
      console.error("[decision] Failed to write record:", err),
    );
  }

  return Response.json({ ok: true, saved: saving });
}
