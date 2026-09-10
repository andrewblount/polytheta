import { eq, like } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { validateBrokerSettings } from "../../../shared/broker-settings.mjs";
export interface BrokerSettings { strikeOverrides: { ticker: string; side: string; expiry: string; minimumOtmPct: number }[]; excludedTickers: string[]; connection: string; quoteSource: string; pauseEntries: boolean; entryCapitalPct: number; maxTrades: number; callAllocationPct: number; putAllocationPct: number; reserveLeverageCeiling: number; minimumCreditRatio: number; maxEntrySpread: number; maxQuoteAgeSeconds: number; entryTimeoutSeconds: number; maxExitPremiumMultiple: number;
 executionHostId: string; twsHost: string; twsPort: number; twsClientId: number; webApiUrl: string; twsRestartTime: string; twsRestartTimezone: string; twsRestartGraceMinutes: number;
 entryTiming: string; mondayEntryStart: string; mondayEntryEnd: string; fridayHolidayPolicy: string; preparationLeadMinutes: number; finalizeLeadMinutes: number; vixIvSensitivity: number; modelRiskFreeRatePct: number; maxAccountLossPct: number; }
export async function getExecutionHosts() {
  if (!db) return [];
  const rows = await db.select().from(appSettings).where(like(appSettings.key, "ib_host:%"));
  return rows.filter(row => typeof row.value.id === "string" && /^[a-f0-9-]{36}$/i.test(row.value.id) && typeof row.value.label === "string")
    .map(row => ({ id: String(row.value.id), label: String(row.value.label), lastSeen: String(row.value.lastSeen) }));
}
export function mergeBrokerSettingsUpdate(current: BrokerSettings, update: unknown): BrokerSettings {
  if (!update || typeof update !== "object" || Array.isArray(update)) throw new Error("Trading settings must be an object");
  // Older installed clients send only the settings they know. Keep the selected
  // host, schedule and other newer fields when those keys are absent.
  return validateBrokerSettings({ ...current, ...update }) as unknown as BrokerSettings;
}
export async function getBrokerSettings(): Promise<BrokerSettings> {
  if (!db) return validateBrokerSettings({}) as unknown as BrokerSettings;
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, "broker"));
  return validateBrokerSettings(rows[0]?.value ?? {}) as unknown as BrokerSettings;
}
export async function saveBrokerSettings(input: unknown) {
  if (!db) throw new Error("Database unavailable; settings were not saved");
  const settings = validateBrokerSettings(input);
  if (settings.executionHostId && !(await getExecutionHosts()).some(h => h.id === settings.executionHostId)) throw new Error("Register the execution computer before selecting it.");
  await db.insert(appSettings).values({ key: "broker", value: settings, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: settings, updatedAt: new Date() } });
  return settings;
}
export async function getBrokerStatus() {
  if (!db) return null;
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, "broker_status"));
  if (!rows[0]) return null;
  const [configured] = await db.select().from(appSettings).where(eq(appSettings.key, "broker"));
  const age = Date.now() - rows[0].updatedAt.getTime();
  return { message: String(rows[0].value?.message ?? "Status unavailable"), ...rows[0].value,
    stale: age < -1000 || age > 120000 || !configured?.value.executionHostId ||
      rows[0].value.hostId !== configured.value.executionHostId || rows[0].value.connection !== configured.value.connection ||
      rows[0].updatedAt < configured.updatedAt };
}
