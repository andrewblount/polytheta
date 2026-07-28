import type { Config } from "@netlify/functions";

// Evening briefing after the US close, with the same DST-proof double-fire +
// ET window guard as brief-open (16:02–16:45 ET, weekdays).
function inCloseWindow(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 16 * 60 + 2 && mins <= 16 * 60 + 45;
}

const handler = async () => {
  if (!inCloseWindow()) return new Response("skipped: outside close window", { status: 200 });
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) return new Response("Missing URL", { status: 500 });
  const response = await fetch(`${baseUrl}/api/internal/briefing?slot=close`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.INTERNAL_SYNC_TOKEN ?? ""}` },
  });
  return new Response(response.ok ? "ok" : "briefing failed", { status: response.ok ? 200 : 500 });
};

export default handler;

export const config: Config = {
  // 20:10 UTC = 16:10 ET during EDT; 21:10 UTC covers EST.
  schedule: "10 20,21 * * 1-5",
};
