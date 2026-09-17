import { desc, eq, like } from "drizzle-orm";
import postgres from "postgres";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { env } from "@/lib/env";
import { validateExitRequest } from "../../../shared/broker-portfolio.mjs";
import { planExitRequestQueue } from "../../../shared/exit-request-policy.mjs";

type StoredState = Record<string, unknown>;
export function brokerPortfolioIsStale({ snapshot, status, settings, settingsUpdatedAt }: {
  snapshot: StoredState | null; status: StoredState | null; settings: StoredState | null; settingsUpdatedAt?: Date | string;
}, now = new Date()) {
  const observedAt = Date.parse(String(snapshot?.observedAt));
  const age = +now - observedAt;
  const settingsAt = settingsUpdatedAt == null ? NaN : +new Date(settingsUpdatedAt);
  return !Number.isFinite(age) || age < -1000 || age > 120000 ||
    !Number.isFinite(settingsAt) || observedAt < settingsAt || !settings?.executionHostId ||
    snapshot?.hostId !== settings.executionHostId || status?.hostId !== settings.executionHostId ||
    (settings.accountMode != null && (snapshot?.mode !== settings.accountMode || status?.mode !== settings.accountMode)) ||
    snapshot?.connection !== settings.connection || status?.connection !== settings.connection || status?.connected !== true;
}

export async function getBrokerPortfolio() {
  if (!db) return { snapshot: null, requests: [], stale: true };
  const [snapshots, requests, statuses, settings] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.key, "broker_portfolio")),
    db.select().from(appSettings).where(like(appSettings.key, "ib_exit:%")).orderBy(desc(appSettings.updatedAt)).limit(30),
    db.select().from(appSettings).where(eq(appSettings.key, "broker_status")),
    db.select().from(appSettings).where(eq(appSettings.key, "broker")),
  ]);
  const stored = snapshots[0]?.value ?? null;
  const mode = settings[0]?.value.accountMode ?? 'live';
  const snapshot = stored && (stored.mode ?? 'live') === mode ? stored : null;
  const stale = brokerPortfolioIsStale({ snapshot, status: statuses[0]?.value ?? null, settings: settings[0]?.value ?? null, settingsUpdatedAt: settings[0]?.updatedAt });
  return { snapshot, requests: requests.map(r => r.value).filter(request => request.accountKey === snapshot?.accountKey), stale };
}

type ExitQueueQuery = (text: string, parameters?: string[]) => Promise<{ value: StoredState }[]>;
// The caller supplies an interactive transaction. neon-http's transaction()
// cannot run this read/decide/write flow, so production uses postgres.js below.
export async function queueBrokerExit(command: StoredState, query: ExitQueueQuery) {
  await query("select pg_advisory_xact_lock(72762413)");
  const key = `ib_exit:${command.requestId}`;
  const existing = await query("select value from app_settings where key=$1", [key]);
  const pending = await query("select value from app_settings where key like 'ib_exit:%' and value->>'status' in ('queued','monitoring')");
  const queued = planExitRequestQueue(command, { existing: existing[0]?.value, pending: pending.map(row => row.value) });
  if (!queued.create) return queued.request;
  await query("insert into app_settings (key,value,updated_at) values ($1,$2::jsonb,now())", [key, JSON.stringify(queued.request)]);
  if (command.scope === "all") {
    await query(`insert into app_settings (key,value,updated_at) values ('broker','{"pauseEntries":true}'::jsonb,now())
      on conflict(key) do update set value=app_settings.value || '{"pauseEntries":true}'::jsonb,updated_at=now()`);
  }
  return queued.request;
}

export async function requestBrokerExit(input: unknown, actor: string) {
  if (!db || env.useDemoData) throw new Error("Live account controls require the production database and authenticated owner.");
  const state = await getBrokerPortfolio();
  if (state.stale) throw new Error("IB position data is stale. Restore the connection before requesting an exit.");
  const command = { ...validateExitRequest(input, state.snapshot), actor };
  const sql = postgres(env.databaseUrl!, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    return await sql.begin(async tx => queueBrokerExit(command, async (text, parameters = []) =>
      Array.from(await tx.unsafe<{ value: StoredState }[]>(text, parameters))));
  } finally { await sql.end({ timeout: 5 }); }
}
