import { getBrokerSettings, saveBrokerSettings, getBrokerStatus, getExecutionHosts, mergeBrokerSettingsUpdate } from "@/server/services/broker-settings";
import {
  DEFAULT_NOTIFICATIONS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  getNotificationSettings,
  saveNotificationSettings,
} from "@/server/services/settings";

import { getModelSettings, saveModelSettings } from "@/server/services/model-settings";

import { mobileAuthOk, unauthorized } from "../auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  const [notifications, broker, brokerStatus, executionHosts, model] = await Promise.all([getNotificationSettings(), getBrokerSettings(), getBrokerStatus(), getExecutionHosts(), getModelSettings()]);
  return Response.json({ notifications, broker, brokerStatus, executionHosts, model }, { headers: { "Cache-Control": "no-store" } });
}

// Body: { notifications: { briefing_close: { email: false }, ... } } — partial
// updates merge into the stored value.
export async function POST(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();

  let body: { broker?: Record<string, unknown>; model?: Record<string, unknown>; notifications?: Record<string, Record<string, unknown>> };
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid settings payload");
    if (body.notifications != null && (typeof body.notifications !== "object" || Array.isArray(body.notifications))) throw new Error("Invalid notification settings");
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  let broker;
  if (body.broker !== undefined) {
    try { broker = await saveBrokerSettings(mergeBrokerSettingsUpdate(await getBrokerSettings(), body.broker)); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid trading settings" }, { status: 400 }); }
  }
  let model;
  if (body.model !== undefined) {
    try { model = await saveModelSettings(body.model); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid model settings" }, { status: 400 }); }
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
  return Response.json({ notifications: merged, broker: broker ?? await getBrokerSettings(), model: model ?? await getModelSettings() });
}
