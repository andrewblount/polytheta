import type { Config } from "@netlify/functions";

import { inBriefingWindow } from "../../shared/market-calendar.mjs";

const handler = async () => {
  if (!inBriefingWindow("open")) return new Response("skipped: outside open window", { status: 200 });
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
