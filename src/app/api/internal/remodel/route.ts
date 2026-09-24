import { env } from "@/lib/env";
import { remodelBaskets } from "@/server/repos/model-remodel";
import { mobileAuthOk } from "../../mobile/auth";

export const dynamic = "force-dynamic";

// Re-size every stored basket (historical and current) to the model settings.
// Saving model settings already does this; this endpoint exists for backfills
// and for confirming the stored baskets match the settings on demand.
export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const internalOk = Boolean(env.syncSecret) && token === env.syncSecret;
  if (!internalOk && !mobileAuthOk(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const summary = await remodelBaskets();
  if (!summary) return Response.json({ error: "database unavailable" }, { status: 503 });
  return Response.json(summary);
}
