import type { Config } from "@netlify/functions";

import { inBriefingWindow } from "../../shared/market-calendar.mjs";

const handler = async () => {
  if (!inBriefingWindow("close")) return new Response("skipped: outside close window", { status: 200 });
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
  // Include 13:10 ET early closes, plus normal closes in EDT/EST.
  schedule: "10 17,18,20,21 * * 1-5",
};
