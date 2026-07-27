import type { Config } from "@netlify/functions";

// Skip syncs when US markets are closed: prices don't move, so hourly
// re-pricing overnight and on weekends only burns Neon compute and network
// transfer (the free-plan allowance nearly ran out in July 2026 doing
// exactly that). Window is generous around the 9:30–16:00 ET session, in
// UTC to sidestep server timezones (13:00–22:00 UTC covers EDT and EST).
// Saturday settlement is handled by settle-weekend.mts.
function marketLikelyOpen(now = new Date()) {
  const day = now.getUTCDay(); // 0 Sun ... 6 Sat
  if (day === 0 || day === 6) return false;
  const hour = now.getUTCHours();
  return hour >= 13 && hour <= 22;
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
