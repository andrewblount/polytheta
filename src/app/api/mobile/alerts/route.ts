import { and, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import { syncLogs } from "@/db/schema";

import { mobileAuthOk, unauthorized } from "../auth";

export const dynamic = "force-dynamic";

// Actionable alerts feed (radar triggers, adverse-move heads-ups) written by
// the hourly sync. Consumed by scripts/alert_bridge.mjs on the Mac, which
// turns them into iMessages. `since` = ISO timestamp of the last alert seen.
export async function GET(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  if (!db) return Response.json({ alerts: [] });

  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 3600 * 1000);
  if (Number.isNaN(sinceDate.getTime())) {
    return Response.json({ error: "bad since" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(syncLogs)
    .where(and(eq(syncLogs.level, "alert"), gt(syncLogs.createdAt, sinceDate)))
    .orderBy(syncLogs.createdAt)
    .limit(50);

  return Response.json({
    alerts: rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      message: r.message,
      meta: r.metadata ?? null,
    })),
  });
}
