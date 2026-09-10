import { and, desc, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { env } from "@/lib/env";
import { validateExitRequest } from "../../../shared/broker-portfolio.mjs";
import { planExitRequestQueue } from "../../../shared/exit-request-policy.mjs";

export async function getBrokerPortfolio() {
  if (!db) return { snapshot: null, requests: [], stale: true };
  const [snapshots, requests, statuses] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.key, "broker_portfolio")),
    db.select().from(appSettings).where(like(appSettings.key, "ib_exit:%")).orderBy(desc(appSettings.updatedAt)).limit(30),
    db.select().from(appSettings).where(eq(appSettings.key, "broker_status")),
  ]);
  const snapshot = snapshots[0]?.value ?? null;
  const age = Date.now() - Date.parse(String(snapshot?.observedAt));
  const stale = !Number.isFinite(age) || age < -1000 || age > 120000 || statuses[0]?.value.connected !== true;
  return { snapshot, requests: requests.map(r => r.value), stale };
}

export async function requestBrokerExit(input: unknown, actor: string) {
  if (!db || env.useDemoData) throw new Error("Live account controls require the production database and authenticated owner.");
  const state = await getBrokerPortfolio();
  if (state.stale) throw new Error("IB position data is stale. Restore the connection before requesting an exit.");
  const command = { ...validateExitRequest(input, state.snapshot), actor };
  const database = db;
  return database.transaction(async tx => {
    // Serializes button double-taps across web, phone and watch.
    await tx.execute(sql`select pg_advisory_xact_lock(72762413)`);
    const existing = await tx.select().from(appSettings).where(eq(appSettings.key, `ib_exit:${command.requestId}`));
    const pending = await tx.select().from(appSettings).where(and(like(appSettings.key, "ib_exit:%"), sql`${appSettings.value}->>'status' in ('queued','monitoring')`));
    const queued = planExitRequestQueue(command, { existing: existing[0]?.value, pending: pending.map(row => row.value) });
    if (!queued.create) return queued.request;
    await tx.insert(appSettings).values({ key: `ib_exit:${command.requestId}`, value: queued.request });
    if (command.scope === "all") {
      // Preserve concurrent settings changes while pausing new entries.
      await tx.insert(appSettings).values({ key: "broker", value: { pauseEntries: true } })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`${appSettings.value} || '{"pauseEntries":true}'::jsonb`, updatedAt: new Date() } });
    }
    return queued.request;
  });
}
