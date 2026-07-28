import { eq } from "drizzle-orm";

import { db } from "@/db";
import { appSettings } from "@/db/schema";

export const NOTIFICATION_CHANNELS = ["email", "imessage", "sms", "whatsapp"] as const;
export const NOTIFICATION_CATEGORIES = [
  "briefing_open",
  "briefing_close",
  "radar_alerts",
  "adverse_move",
] as const;

export type NotificationSettings = Record<string, Record<string, boolean>>;

export const DEFAULT_NOTIFICATIONS: NotificationSettings = Object.fromEntries(
  NOTIFICATION_CATEGORIES.map((c) => [
    c,
    // SMS on for the urgent categories only — briefings would burn segments
    // twice a day for information that isn't time-critical.
    {
      email: true,
      imessage: true,
      sms: c === "radar_alerts" || c === "adverse_move",
      whatsapp: false,
    },
  ]),
);

export async function getNotificationSettings(): Promise<NotificationSettings> {
  if (!db) return DEFAULT_NOTIFICATIONS;
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, "notifications"));
  if (rows.length === 0) return DEFAULT_NOTIFICATIONS;
  return { ...DEFAULT_NOTIFICATIONS, ...(rows[0].value as NotificationSettings) };
}

export async function saveNotificationSettings(merged: NotificationSettings) {
  if (!db) return;
  await db
    .insert(appSettings)
    .values({ key: "notifications", value: merged, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: merged, updatedAt: new Date() } });
}
