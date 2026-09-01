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
