import { env } from "@/lib/env";
import { sendBriefing } from "@/server/services/briefing";

import { mobileAuthOk } from "../../mobile/auth";

export const dynamic = "force-dynamic";

// Accepts the internal scheduler token OR the mobile app token — the latter
// enables on-demand briefings from the apps.
export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const internalOk = Boolean(env.syncSecret) && token === env.syncSecret;
  if (!internalOk && !mobileAuthOk(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const slot = url.searchParams.get("slot") === "open" ? "open" : "close";
  const result = await sendBriefing(slot);
  return Response.json(result);
}
