import type { Config } from "@netlify/functions";

const handler = async () => {
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
