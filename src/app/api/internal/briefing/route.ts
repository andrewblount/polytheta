import { env } from "@/lib/env";
import { sendBriefing } from "@/server/services/briefing";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!env.syncSecret || token !== env.syncSecret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const slot = url.searchParams.get("slot") === "open" ? "open" : "close";
  const result = await sendBriefing(slot);
  return Response.json(result);
}
