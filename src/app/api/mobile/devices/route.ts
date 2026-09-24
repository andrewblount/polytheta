import { listPushDevices, pushConfigured, registerPushDevice, unregisterPushDevice } from "@/server/services/push";

import { mobileAuthOk, unauthorized } from "../auth";

export const dynamic = "force-dynamic";

// The iOS app registers its APNs device token here after the user allows
// notifications. Tokens are kept in app_settings; nothing else identifies the
// device.
export async function GET(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  const devices = await listPushDevices();
  return Response.json({ configured: pushConfigured(), devices: devices.map((d) => ({ token: `${d.token.slice(0, 8)}…`, sandbox: d.sandbox, label: d.label ?? null, lastSeenAt: d.lastSeenAt })) });
}

export async function POST(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  let body: { token?: string; platform?: string; sandbox?: boolean; label?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  try {
    const device = await registerPushDevice({ token: String(body.token ?? ""), platform: body.platform, sandbox: Boolean(body.sandbox), label: body.label });
    return Response.json({ ok: true, configured: pushConfigured(), sandbox: device.sandbox });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid device" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  const token = new URL(request.url).searchParams.get("token") ?? "";
  await unregisterPushDevice(token);
  return Response.json({ ok: true });
}
