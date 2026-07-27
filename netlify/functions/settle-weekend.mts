import type { Config } from "@netlify/functions";

// One settlement pass on Saturday morning: after Friday's expiry, positions
// that somehow missed their final Expiry-Resolved snapshot during market
// hours get resolved here. market-sync.mts skips weekends entirely, so this
// is the only weekend DB touch.
const handler = async () => {
  const baseUrl =
    process.env.URL ??
    process.env.DEPLOY_PRIME_URL ??
    process.env.NEXT_PUBLIC_APP_URL;

  if (!baseUrl) {
    console.error("No base URL configured for weekend settlement pass.");
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
    console.error("Weekend settlement pass failed:", body);
    return new Response("Settlement failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
};

export default handler;

export const config: Config = {
  // Saturday 14:00 UTC
  schedule: "0 14 * * 6",
};
