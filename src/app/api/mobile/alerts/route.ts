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

// The execution service on the Mac raises its own alerts here (exit orders
// submitted, loss stops triggered, entry warnings) so they reach the same
// feed, channels and phone push as the model's alerts.
export async function POST(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  let body: { kind?: string; title?: string; message?: string; meta?: Record<string, unknown>; critical?: boolean };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const kinds = ["radar", "adverse-move", "trade-warning", "model-exit", "ib-exit", "ib-warning", "briefing", "system"] as const;
  const kind = kinds.find((k) => k === body.kind) ?? "system";
  const message = String(body.message ?? "").slice(0, 1000);
  if (!message) return Response.json({ error: "message required" }, { status: 400 });
  const { raiseAlert } = await import("@/server/services/notify");
  const result = await raiseAlert({ kind, title: String(body.title ?? "Polytheta").slice(0, 120), message, meta: body.meta && typeof body.meta === "object" ? body.meta : {}, critical: body.critical });
  return Response.json({ ok: true, ...result });
}
