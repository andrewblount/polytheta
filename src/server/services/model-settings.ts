import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { validateModelSettings } from "../../../shared/model-settings.mjs";

// Sizing settings for the MODEL (app_settings key 'model'). They size the weekly
// model basket and re-size every historical leg in the model performance
// report. The IB account's own sizing lives in the broker settings and its
// performance report always shows real fills, whatever these say.
export interface ModelSettings {
  modelEquity: number;
  accountTradedPct: number;
  marginAvailablePct: number;
  sellCalls: boolean;
  sellPuts: boolean;
}

export async function getModelSettings(): Promise<ModelSettings> {
  if (!db) return validateModelSettings({}) as ModelSettings;
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, "model"));
  return validateModelSettings(rows[0]?.value ?? {}) as ModelSettings;
}

export async function saveModelSettings(input: unknown) {
  if (!db) throw new Error("Database unavailable; settings were not saved");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Model settings must be an object");
  const settings = validateModelSettings({ ...(await getModelSettings()), ...(input as Record<string, unknown>) }) as ModelSettings;
  await db.insert(appSettings).values({ key: "model", value: { ...settings }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: { ...settings }, updatedAt: new Date() } });
  // A change to the starting equity or any sizing setting re-sizes every stored
  // basket, historical and current, so the site, the apps and the performance
  // report all show the model at this size.
  const { remodelBaskets } = await import("../repos/model-remodel");
  await remodelBaskets(settings);
  return settings;
}
