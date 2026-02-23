// Debug endpoint removed — background.ts AUTOPILOT_DEBUG handler provides
// the same logging via the extension console without an unauthenticated HTTP endpoint.
// See extension/src/background.ts lines for the AUTOPILOT_DEBUG message handler.

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(
    { error: "Debug endpoint disabled. Use background console logging instead." },
    { status: 410 },
  );
}
