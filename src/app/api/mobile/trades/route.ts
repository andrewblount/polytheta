import { desc } from "drizzle-orm";

import { db } from "@/db";
import { trades } from "@/db/schema";

import { mobileAuthOk, unauthorized } from "../auth";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["sell-to-open", "buy-to-close"]);
const SIDES = new Set(["call", "put"]);

function serialize(row: typeof trades.$inferSelect) {
  return {
    id: row.id,
    positionId: row.positionId,
    ticker: row.ticker,
    side: row.side,
    action: row.action,
    strike: Number(row.strike),
    expiry: String(row.expiry),
    quantity: row.quantity,
    price: Number(row.price),
    fees: Number(row.fees),
    broker: row.broker,
    executedAt: row.executedAt.toISOString(),
    notes: row.notes,
  };
}

export async function GET(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  if (!db) return Response.json({ trades: [] });
  const rows = await db.select().from(trades).orderBy(desc(trades.executedAt)).limit(500);
  return Response.json({ trades: rows.map(serialize) });
}

export async function POST(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  if (!db) return Response.json({ error: "no database" }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  const side = String(body.side ?? "");
  const action = String(body.action ?? "");
  const strike = Number(body.strike);
  const quantity = Number(body.quantity);
  const price = Number(body.price);
  const fees = Number(body.fees ?? 0);
  const expiry = String(body.expiry ?? "");
  const executedAt = body.executedAt ? new Date(String(body.executedAt)) : new Date();

  if (!ticker || ticker.length > 16) return Response.json({ error: "bad ticker" }, { status: 400 });
  if (!SIDES.has(side)) return Response.json({ error: "bad side" }, { status: 400 });
  if (!ACTIONS.has(action)) return Response.json({ error: "bad action" }, { status: 400 });
  if (!Number.isFinite(strike) || strike <= 0) return Response.json({ error: "bad strike" }, { status: 400 });
  if (!Number.isInteger(quantity) || quantity <= 0) return Response.json({ error: "bad quantity" }, { status: 400 });
  if (!Number.isFinite(price) || price < 0) return Response.json({ error: "bad price" }, { status: 400 });
  if (!Number.isFinite(fees) || fees < 0) return Response.json({ error: "bad fees" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return Response.json({ error: "bad expiry" }, { status: 400 });
  if (Number.isNaN(executedAt.getTime())) return Response.json({ error: "bad executedAt" }, { status: 400 });

  const [row] = await db
    .insert(trades)
    .values({
      positionId: typeof body.positionId === "string" && body.positionId ? body.positionId : null,
      ticker,
      side: side as "call" | "put",
      action: action as "sell-to-open" | "buy-to-close",
      strike: strike.toFixed(2),
      expiry,
      quantity,
      price: price.toFixed(4),
      fees: fees.toFixed(2),
      broker: typeof body.broker === "string" && body.broker ? body.broker.slice(0, 32) : null,
      executedAt,
      notes: typeof body.notes === "string" && body.notes ? body.notes : null,
    })
    .returning();

  return Response.json({ trade: serialize(row) }, { status: 201 });
}
