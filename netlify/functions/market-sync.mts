import type { Config } from "@netlify/functions";

import { easternTime, marketSession } from "../../shared/market-calendar.mjs";

function marketLikelyOpen(now = new Date()) {
  const t = easternTime(now), session = marketSession(t.date);
  return session.open && t.minutes >= session.openMinute && t.minutes <= session.closeMinute + 30;
}

const handler = async () => {
  if (!marketLikelyOpen()) {
    return new Response("skipped: market closed", { status: 200 });
  }

  const baseUrl =
    process.env.URL ??
    process.env.DEPLOY_PRIME_URL ??
    process.env.NEXT_PUBLIC_APP_URL;

  if (!baseUrl) {
    console.error("No base URL configured for scheduled market sync.");
    return new Response("Missing URL", { status: 500 });
  }

  const response = await fetch(`${baseUrl}/api/internal/sync/market`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.INTERNAL_SYNC_TOKEN ?? ""}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("Scheduled market sync failed:", body);
    return new Response("Sync failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
};

export default handler;

export const config: Config = {
  schedule: "@hourly",
};
