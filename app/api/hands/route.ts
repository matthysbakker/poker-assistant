import { z } from "zod";
import { readHandRecords } from "@/lib/storage/hand-records";

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  action: z
    .enum(["FOLD", "CHECK", "CALL", "BET", "RAISE"])
    .optional(),
  position: z
    .enum(["UTG", "MP", "CO", "BTN", "SB", "BB"])
    .optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());

  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid query parameters." },
      { status: 400 },
    );
  }

  const { date, limit, offset, action, position } = parsed.data;

  // Fetch enough records to apply filters then paginate
  let records = await readHandRecords({ date, limit: 100, offset: 0 });

  // Apply filters (analysis is always present on HandRecord)
  if (action) records = records.filter((r) => r.analysis.action === action);
  if (position) {
    records = records.filter(
      (r) =>
        r.heroPosition === position ||
        r.analysis.heroPosition === position,
    );
  }

  const page = records.slice(offset, offset + limit);

  return Response.json({
    records: page,
    total: page.length,
    limit,
    offset,
  });
}
