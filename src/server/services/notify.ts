// One place to raise a trading alert. Every alert is written to the alert feed
// (sync_logs level 'alert', which the iOS Alerts tab and the Mac iMessage
// bridge read), fanned out to the SMS/WhatsApp channels the settings enable,
// and pushed to the phone through APNs when that is configured.
import { db } from "@/db";
import { syncLogs } from "@/db/schema";

import { sendPush } from "./push";
import { getNotificationSettings } from "./settings";
import { sendTwilioMessage } from "./twilio";

export type AlertKind = "radar" | "adverse-move" | "trade-warning" | "model-exit" | "ib-exit" | "ib-warning" | "briefing" | "system";

export interface AlertInput {
  kind: AlertKind;
  title: string;
  message: string;
  meta?: Record<string, unknown>;
  jobId?: string | null;
  // Which notification category's channel preferences apply.
  category?: "radar_alerts" | "adverse_move" | "briefing_open" | "briefing_close";
  critical?: boolean;
}

export async function raiseAlert(input: AlertInput) {
  const category = input.category ?? (input.kind === "radar" || input.kind === "model-exit" || input.kind === "ib-exit" ? "radar_alerts" : "adverse_move");
  let logged = false;
  if (db) {
    try {
      await db.insert(syncLogs).values({ jobId: input.jobId ?? null, level: "alert", message: input.message, metadata: { kind: input.kind, title: input.title, ...(input.meta ?? {}) } });
      logged = true;
    } catch (error) { console.error("alert log failed:", error); }
  }
  let sms = false, whatsapp = false;
  try {
    const prefs = (await getNotificationSettings())[category] ?? {};
    if (prefs.sms) sms = (await sendTwilioMessage("sms", input.message)).sent;
    if (prefs.whatsapp) whatsapp = (await sendTwilioMessage("whatsapp", input.message)).sent;
  } catch (error) { console.error("urgent channel failed:", error); }
  const push = await sendPush({ title: input.title, body: input.message, category: `polytheta.${input.kind}`, data: { kind: input.kind, ...(input.meta ?? {}) }, critical: input.critical ?? (input.kind === "radar" || input.kind === "model-exit" || input.kind === "ib-exit") });
  return { logged, sms, whatsapp, push };
}
