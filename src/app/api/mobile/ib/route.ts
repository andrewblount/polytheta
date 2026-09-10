import { mobileAuthOk, unauthorized } from "../auth";
import { getBrokerPortfolio, requestBrokerExit } from "@/server/services/broker-portfolio";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  return Response.json(await getBrokerPortfolio(), { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  try { return Response.json({ request: await requestBrokerExit(await request.json(), "owner-mobile") }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Exit request failed" }, { status: 400 }); }
}
