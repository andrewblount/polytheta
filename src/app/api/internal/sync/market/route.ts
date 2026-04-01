import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getCurrentAppUser } from "@/server/auth/user";
import { runMarketSync } from "@/server/services/market-sync";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const internalToken = authHeader?.replace("Bearer ", "");
  const appUser = await getCurrentAppUser();

  if (env.syncSecret && internalToken !== env.syncSecret && appUser?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runMarketSync(appUser?.email ?? "internal-route");
  return NextResponse.json(result);
}
