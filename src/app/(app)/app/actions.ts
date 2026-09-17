"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { userProfiles } from "@/db/schema";
import { requireAppUser } from "@/server/auth/user";

// Members manage their own tracking base and briefing emails here. Admin
// equivalents live in the admin actions; this one only ever touches the
// signed-in user's own profile row.
export async function updateMyTrackingAction(formData: FormData) {
  const user = await requireAppUser();
  if (!db) return;

  const rawCapital = String(formData.get("startingCapital") ?? "").replace(/[$,\s]/g, "");
  let startingCapital: string | null = null;
  if (rawCapital.length > 0) {
    const parsed = Number(rawCapital);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error("Starting amount must be a positive number.");
    }
    startingCapital = parsed > 0 ? parsed.toFixed(2) : null;
  }

  const rawStart = String(formData.get("trackingStartDate") ?? "").trim();
  const trackingStartDate = /^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? rawStart : null;

  const notificationPrefs = {
    briefing_open_email: formData.get("briefing_open_email") === "on",
    briefing_close_email: formData.get("briefing_close_email") === "on",
  };

  await db
    .update(userProfiles)
    .set({
      startingCapital,
      trackingStartDate,
      notificationPrefs,
      updatedAt: new Date(),
    })
    .where(eq(userProfiles.id, user.id));

  revalidatePath("/app/settings");
  revalidatePath("/app/dashboard");
  revalidatePath("/app/performance");
}

export async function updateBrokerSettingsAction(formData: FormData) {
  await requireAppUser("admin");
  const { getBrokerSettings, saveBrokerSettings } = await import("@/server/services/broker-settings");
  const current = await getBrokerSettings();
  const updates: Record<string, unknown> = { ...current, connection: String(formData.get("connection")), pauseEntries: formData.get("pauseEntries") === "on" };
  updates.excludedTickers = String(formData.get("excludedTickers") ?? "");
  updates.strikeOverrides = JSON.parse(String(formData.get("strikeOverrides") ?? "[]"));
  for (const key of ["accountMode", "executionHostId", "twsHost", "webApiUrl", "twsRestartTime", "twsRestartTimezone", "entryTiming", "mondayEntryStart", "mondayEntryEnd"]) updates[key] = String(formData.get(key) ?? current[key as keyof typeof current]);
  for (const key of ["entryCapitalPct", "maxAccountLossPct", "maxTrades", "callAllocationPct", "putAllocationPct", "reserveLeverageCeiling", "minimumCreditRatio", "entryTimeoutSeconds", "maxExitPremiumMultiple", "twsPort", "twsClientId", "twsRestartGraceMinutes", "preparationLeadMinutes", "finalizeLeadMinutes", "vixIvSensitivity", "modelRiskFreeRatePct"]) updates[key] = Number(formData.get(key) ?? current[key as keyof typeof current]);
  await saveBrokerSettings(updates);
  revalidatePath("/app/settings");
}
