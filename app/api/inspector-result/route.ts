/**
 * POST /api/inspector-result
 *
 * Receives DOM inspector results from the extension background script and
 * writes them to data/inspector-result.json so Claude Code can read them
 * directly without copy/paste.
 *
 * Body: { best, hits, depth, example, all[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dataDir = join(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    join(dataDir, "inspector-result.json"),
    JSON.stringify({ ...body as object, recordedAt: new Date().toISOString() }, null, 2),
  );

  return NextResponse.json({ ok: true });
}
