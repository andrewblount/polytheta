import {
  DEFAULT_NOTIFICATIONS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  getNotificationSettings,
  saveNotificationSettings,
} from "@/server/services/settings";

import { mobileAuthOk, unauthorized } from "../auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  return Response.json({ notifications: await getNotificationSettings() });
}

// Body: { notifications: { briefing_close: { email: false }, ... } } — partial
// updates merge into the stored value.
export async function POST(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();

  let body: { notifications?: Record<string, Record<string, unknown>> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const incoming = body.notifications ?? {};
  const current = await getNotificationSettings();
  const merged = { ...DEFAULT_NOTIFICATIONS, ...current };
  for (const cat of NOTIFICATION_CATEGORIES) {
    if (!incoming[cat]) continue;
    merged[cat] = { ...merged[cat] };
    for (const ch of NOTIFICATION_CHANNELS) {
      if (typeof incoming[cat][ch] === "boolean") merged[cat][ch] = incoming[cat][ch] as boolean;
    }
  }
  await saveNotificationSettings(merged);
  return Response.json({ notifications: merged });
}
