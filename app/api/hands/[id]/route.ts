import { readHandRecord } from "@/lib/storage/hand-records";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await readHandRecord(id);
  if (!record) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }
  return Response.json(record);
}
