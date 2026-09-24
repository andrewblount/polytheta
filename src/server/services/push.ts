// Apple Push Notification service delivery for the iOS app.
//
// Device tokens are registered by the app (POST /api/mobile/devices) and kept
// in app_settings under 'push_devices'. Sending uses token-based APNs auth
// (an APNs Auth Key .p8 from the Apple developer portal) over HTTP/2:
//   APNS_KEY_ID        key identifier, e.g. AB12CD34EF
//   APNS_TEAM_ID       Apple team, ZAR4A6G772
//   APNS_PRIVATE_KEY   the .p8 contents (PEM; "\n" escapes or base64 are accepted)
//   APNS_TOPIC         bundle id, default com.andrewblount.polytheta
// Until those are set every send is a recorded no-op; the iMessage/SMS bridge
// still delivers the same alerts.
import http2 from "node:http2";
import { eq } from "drizzle-orm";
import { SignJWT, importPKCS8 } from "jose";

import { db } from "@/db";
import { appSettings } from "@/db/schema";

export interface PushDevice {
  token: string;
  platform: "ios";
  sandbox: boolean;
  label?: string;
  registeredAt: string;
  lastSeenAt: string;
}

const DEVICES_KEY = "push_devices";
const TOKEN_PATTERN = /^[0-9a-f]{32,200}$/i;

export async function listPushDevices(): Promise<PushDevice[]> {
  if (!db) return [];
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, DEVICES_KEY));
  const devices = (rows[0]?.value as { devices?: PushDevice[] } | undefined)?.devices;
  return Array.isArray(devices) ? devices.filter((d) => typeof d?.token === "string" && TOKEN_PATTERN.test(d.token)) : [];
}

async function savePushDevices(devices: PushDevice[]) {
  if (!db) return;
  await db.insert(appSettings).values({ key: DEVICES_KEY, value: { devices }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: { devices }, updatedAt: new Date() } });
}

export async function registerPushDevice(input: { token: string; platform?: string; sandbox?: boolean; label?: string }) {
  const token = String(input.token ?? "").trim().toLowerCase();
  if (!TOKEN_PATTERN.test(token)) throw new Error("Invalid device token");
  const now = new Date().toISOString();
  const devices = await listPushDevices();
  const existing = devices.find((d) => d.token === token);
  const device: PushDevice = { token, platform: "ios", sandbox: Boolean(input.sandbox), label: input.label?.slice(0, 80), registeredAt: existing?.registeredAt ?? now, lastSeenAt: now };
  await savePushDevices([...devices.filter((d) => d.token !== token), device].slice(-20));
  return device;
}

export async function unregisterPushDevice(token: string) {
  const devices = await listPushDevices();
  await savePushDevices(devices.filter((d) => d.token !== token.toLowerCase()));
}

function apnsConfig() {
  const keyId = process.env.APNS_KEY_ID, teamId = process.env.APNS_TEAM_ID;
  let key = process.env.APNS_PRIVATE_KEY ?? "";
  if (!keyId || !teamId || !key) return null;
  key = key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
  if (!key.includes("BEGIN PRIVATE KEY")) {
    try { key = Buffer.from(key, "base64").toString("utf8"); } catch { /* leave as is */ }
  }
  if (!key.includes("BEGIN PRIVATE KEY")) return null;
  return { keyId, teamId, key, topic: process.env.APNS_TOPIC ?? "com.andrewblount.polytheta" };
}

export function pushConfigured() {
  return apnsConfig() !== null;
}

let cachedJwt: { value: string; issuedAt: number; keyId: string } | null = null;
async function providerToken(config: NonNullable<ReturnType<typeof apnsConfig>>) {
  // APNs accepts a provider token for up to an hour; refresh every 50 minutes.
  if (cachedJwt && cachedJwt.keyId === config.keyId && Date.now() - cachedJwt.issuedAt < 50 * 60000) return cachedJwt.value;
  const key = await importPKCS8(config.key, "ES256");
  const value = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: config.keyId }).setIssuer(config.teamId).setIssuedAt().sign(key);
  cachedJwt = { value, issuedAt: Date.now(), keyId: config.keyId };
  return value;
}

function sendOne(host: string, path: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(host);
    const timer = setTimeout(() => { client.close(); reject(new Error("APNs request timed out")); }, 10000);
    client.on("error", (error) => { clearTimeout(timer); reject(error); });
    const request = client.request({ ":method": "POST", ":path": path, ...headers });
    let status = 0, data = "";
    request.on("response", (h) => { status = Number(h[":status"] ?? 0); });
    request.setEncoding("utf8");
    request.on("data", (chunk) => { data += chunk; });
    request.on("end", () => { clearTimeout(timer); client.close(); resolve({ status, body: data }); });
    request.on("error", (error) => { clearTimeout(timer); client.close(); reject(error); });
    request.end(body);
  });
}

export interface PushMessage {
  title: string;
  body: string;
  category?: string;
  data?: Record<string, unknown>;
  critical?: boolean;
}

// Send to every registered device. Never throws: delivery is best effort and
// the same alert is also written to the alert feed and the message bridge.
export async function sendPush(message: PushMessage) {
  const config = apnsConfig();
  const devices = await listPushDevices();
  if (!config) return { sent: 0, skipped: devices.length, reason: "apns-not-configured" as const };
  if (!devices.length) return { sent: 0, skipped: 0, reason: "no-devices" as const };
  let jwt: string;
  try { jwt = await providerToken(config); }
  catch (error) { console.error("APNs key unusable:", error); return { sent: 0, skipped: devices.length, reason: "apns-key-invalid" as const }; }
  const payload = JSON.stringify({
    aps: { alert: { title: message.title, body: message.body }, sound: message.critical ? "default" : "default", "interruption-level": message.critical ? "time-sensitive" : "active", category: message.category ?? "polytheta.alert" },
    data: message.data ?? {},
  });
  let sent = 0;
  const dead: string[] = [];
  for (const device of devices) {
    const host = device.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
    try {
      const result = await sendOne(host, `/3/device/${device.token}`, {
        authorization: `bearer ${jwt}`, "apns-topic": config.topic, "apns-push-type": "alert", "apns-priority": "10", "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
      }, payload);
      if (result.status === 200) sent += 1;
      else if (result.status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(result.body)) dead.push(device.token);
      else console.error(`APNs ${result.status} for ${device.token.slice(0, 8)}…: ${result.body}`);
    } catch (error) {
      console.error("APNs send failed:", error);
    }
  }
  if (dead.length) await savePushDevices(devices.filter((d) => !dead.includes(d.token)));
  return { sent, skipped: devices.length - sent, reason: null };
}
