export async function POST(req: Request) {
  const data = await req.json();

  console.log("\n========== AUTOPILOT DEBUG ==========");
  console.log("Type:", data.type);
  console.log("Hand:", data.handId);
  console.log("State:", JSON.stringify(data.state, null, 2));
  if (data.dom?.heroCards) {
    console.log("\n--- Hero Cards DOM ---");
    console.log(data.dom.heroCards);
  }
  if (data.dom?.communityCards) {
    console.log("\n--- Community Cards DOM ---");
    console.log(data.dom.communityCards);
  }
  if (data.dom?.actionsArea) {
    console.log("\n--- Actions Area DOM ---");
    console.log(data.dom.actionsArea);
  }
  console.log("======================================\n");

  return Response.json({ ok: true });
}
