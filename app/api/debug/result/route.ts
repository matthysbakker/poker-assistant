import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const FILE = join(process.cwd(), "data", "debug-result.json");

// GET: Claude reads the result
export async function GET() {
  try {
    const raw = await readFile(FILE, "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json(null);
  }
}

// POST: extension submits result
export async function POST(req: NextRequest) {
  const body = await req.json();
  await writeFile(FILE, JSON.stringify({ ...body, receivedAt: new Date().toISOString() }, null, 2));
  return NextResponse.json({ ok: true });
}
