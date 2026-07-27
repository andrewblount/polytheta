import { eq } from "drizzle-orm";

import { db } from "@/db";
import { trades } from "@/db/schema";

import { mobileAuthOk, unauthorized } from "../../auth";

export const dynamic = "force-dynamic";

// Correcting or removing a mis-entered fill in the personal trade ledger.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!mobileAuthOk(request)) return unauthorized();
  if (!db) return Response.json({ error: "no database" }, { status: 503 });
  const { id } = await params;
  const deleted = await db.delete(trades).where(eq(trades.id, id)).returning({ id: trades.id });
  if (deleted.length === 0) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ deleted: deleted[0].id });
}
