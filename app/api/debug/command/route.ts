import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";

const FILE = join(process.cwd(), "data", "debug-command.json");

// GET: extension polls this to pick up a pending command
export async function GET() {
  try {
    const raw = await readFile(FILE, "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json(null);
  }
}

// POST: Claude (or anyone) queues a command
export async function POST(req: NextRequest) {
  const body = await req.json();
  await writeFile(FILE, JSON.stringify({ ...body, issuedAt: new Date().toISOString() }));
  return NextResponse.json({ ok: true });
}

// DELETE: clear pending command (called by extension after pickup)
export async function DELETE() {
  try { await unlink(FILE); } catch {}
  return NextResponse.json({ ok: true });
}
