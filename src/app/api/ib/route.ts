import { getCurrentAppUser } from "@/server/auth/user";
import { getBrokerPortfolio, requestBrokerExit } from "@/server/services/broker-portfolio";
export const dynamic = "force-dynamic";
async function owner() { const user = await getCurrentAppUser(); return user?.status === "active" && user.role === "admin" ? user : null; }
export async function GET() {
  if (!await owner()) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await getBrokerPortfolio(), { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  // Browser cookie authentication also requires a same-origin request.
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const user = await owner();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try { return Response.json({ request: await requestBrokerExit(await request.json(), user.id) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Exit request failed" }, { status: 400 }); }
}
