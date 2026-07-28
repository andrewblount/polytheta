import type { Config } from "@netlify/functions";

// Morning briefing shortly after the US open. Netlify cron is UTC and the
// open shifts with DST, so this fires at both candidate hours and the guard
// only proceeds in the 09:31–10:15 ET window on weekdays.
function inOpenWindow(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 31 && mins <= 10 * 60 + 15;
}

const handler = async () => {
  if (!inOpenWindow()) return new Response("skipped: outside open window", { status: 200 });
  const baseUrl = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) return new Response("Missing URL", { status: 500 });
  const response = await fetch(`${baseUrl}/api/internal/briefing?slot=open`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.INTERNAL_SYNC_TOKEN ?? ""}` },
  });
  return new Response(response.ok ? "ok" : "briefing failed", { status: response.ok ? 200 : 500 });
};

export default handler;

export const config: Config = {
  // 13:45 UTC = 9:45 ET during EDT; 14:45 UTC covers EST. The window guard
  // rejects whichever one lands outside 9:31–10:15 ET.
  schedule: "45 13,14 * * 1-5",
};
