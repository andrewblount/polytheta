import { db } from "@/db";
import { schwabSnapshots } from "@/db/schema";

import { mobileAuthOk, unauthorized } from "../auth";

export const dynamic = "force-dynamic";

// The Mac-side fetcher (scripts/schwab_snapshot.mjs) posts read-only account
// snapshots here. Credentials never reach this server — only the numbers.
export async function POST(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  if (!db) return Response.json({ error: "no database" }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : null);
  const [row] = await db
    .insert(schwabSnapshots)
    .values({
      liquidationValue: num(body.liquidationValue),
      equity: num(body.equity),
      dayPl: num(body.dayPl),
      raw: typeof body.raw === "object" && body.raw ? (body.raw as Record<string, unknown>) : null,
    })
    .returning({ id: schwabSnapshots.id, takenAt: schwabSnapshots.takenAt });
  return Response.json({ snapshot: row }, { status: 201 });
}
