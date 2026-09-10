import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { validateBrokerSettings } from "../../../shared/broker-settings.mjs";
export interface BrokerSettings { strikeOverrides: { ticker: string; side: string; expiry: string; minimumOtmPct: number }[]; excludedTickers: string[]; connection: string; quoteSource: string; pauseEntries: boolean; entryCapitalPct: number; maxTrades: number; callAllocationPct: number; putAllocationPct: number; reserveLeverageCeiling: number; minimumCreditRatio: number; maxEntrySpread: number; maxQuoteAgeSeconds: number; entryTimeoutSeconds: number; maxExitPremiumMultiple: number; }
export async function getBrokerSettings(): Promise<BrokerSettings> {
  if (!db) return validateBrokerSettings({}) as unknown as BrokerSettings;
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, "broker"));
  return validateBrokerSettings(rows[0]?.value ?? {}) as unknown as BrokerSettings;
}
export async function saveBrokerSettings(input: unknown) {
  if (!db) throw new Error("Database unavailable; settings were not saved");
  const settings = validateBrokerSettings(input);
  await db.insert(appSettings).values({ key: "broker", value: settings, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: settings, updatedAt: new Date() } });
  return settings;
}
export async function getBrokerStatus() {
  if (!db) return null;
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, "broker_status"));
  if (!rows[0]) return null;
  return { message: String(rows[0].value?.message ?? "Status unavailable"), ...rows[0].value, stale: Date.now() - rows[0].updatedAt.getTime() > 120000 };
}
