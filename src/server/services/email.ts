import { env } from "@/lib/env";

type AccessRequestNotification = {
  name: string;
  email: string;
  company?: string | null;
  message?: string | null;
};

function hasSendGridConfig() {
  return Boolean(env.sendGridApiKey && env.sendGridFromEmail);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendAccessRequestNotification(payload: AccessRequestNotification) {
  if (!hasSendGridConfig()) {
    console.warn("Access request email skipped: SendGrid is not configured.");
    return { sent: false as const, reason: "sendgrid-not-configured" as const };
  }
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.sendGridApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: env.accessRequestNotifyEmail }],
          subject: `New Polytheta access request: ${payload.name}`,
        },
      ],
      from: { email: env.sendGridFromEmail! },
      content: [
        {
          type: "text/plain",
          value: [
            "A new Polytheta access request was submitted.",
            "",
            `Name: ${payload.name}`,
            `Email: ${payload.email}`,
            `Company: ${payload.company || "Not provided"}`,
            "",
            "Context:",
            payload.message || "No message provided.",
            "",
            `Review requests: ${env.appUrl}/admin/users`,
          ].join("\n"),
        },
        {
          type: "text/html",
          value: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
              <h2 style="margin:0 0 16px">New Polytheta access request</h2>
              <p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>
              <p><strong>Email:</strong> ${escapeHtml(payload.email)}</p>
              <p><strong>Company:</strong> ${escapeHtml(payload.company || "Not provided")}</p>
              <p><strong>Context:</strong><br/>${escapeHtml(payload.message || "No message provided.").replace(/\n/g, "<br/>")}</p>
              <p><a href="${env.appUrl}/admin/users">Open the users admin page</a></p>
            </div>
          `,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SendGrid notification failed (${response.status}): ${body}`);
  }

  return { sent: true as const };
}

type StopBreachAlert = {
  ticker: string;
  side: string;
  strike: number;
  pnlAmount: number;
  margin: number;
  underlyingPrice: number;
  basketSlug: string;
};

// Policy v3: positions are held to expiry — the weekly tenor is the stop.
// This email is a HEADS-UP on a large adverse move, prompting a news check,
// not an exit instruction. Sent once per position.
export async function sendStopBreachAlert(payload: StopBreachAlert) {
  if (!hasSendGridConfig()) {
    console.warn("Adverse-move email skipped: SendGrid is not configured.");
    return { sent: false as const, reason: "sendgrid-not-configured" as const };
  }
  const lossPct = payload.margin ? ((payload.pnlAmount / payload.margin) * 100).toFixed(1) : "?";
  const subject = `Heads-up: ${payload.ticker} ${payload.side} down ${lossPct}% of allocation — check news`;
  const lines = [
    `${payload.ticker} ${payload.side} $${payload.strike} has moved sharply against the position.`,
    "",
    `Modeled P&L: $${Math.round(payload.pnlAmount).toLocaleString()} on $${payload.margin.toLocaleString()} margin (${lossPct}%)`,
    `Underlying: $${payload.underlyingPrice}`,
    "",
    "Policy v3: hold to expiry — the weekly tenor is the stop. Exit ONLY if the",
    "thesis changed: check for acquisition/downside-gap news on this name.",
    "Radar alerts fire separately when headlines match; a move this size with",
    "no headline is usually flow, not news.",
    "",
    `Basket: ${env.appUrl}/app/baskets/${payload.basketSlug}`,
  ];
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.sendGridApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        { to: [{ email: env.accessRequestNotifyEmail }], subject },
      ],
      from: { email: env.sendGridFromEmail! },
      content: [{ type: "text/plain", value: lines.join("\n") }],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SendGrid stop-breach alert failed (${response.status}): ${body}`);
  }
  return { sent: true as const };
}

type RadarAlertEmail = {
  ticker: string;
  side: string;
  strike: number;
  basketSlug: string;
  hits: Array<{ title: string; link: string; publisher: string; publishedAt: string }>;
};

// News-radar trigger — this one IS an exit signal per the trading system:
// any credible acquisition signal (call side) or downside-gap signal (put
// side) means immediate full exit on the name.
export async function sendRadarAlert(payload: RadarAlertEmail) {
  if (!hasSendGridConfig()) {
    console.warn("Radar email skipped: SendGrid is not configured.");
    return { sent: false as const, reason: "sendgrid-not-configured" as const };
  }
  const radarName = payload.side === "call" ? "ACQUISITION RADAR" : "DOWNSIDE-GAP RADAR";
  const subject = `${radarName}: ${payload.ticker} — exit signal, verify now`;
  const lines = [
    `${radarName} triggered on ${payload.ticker} ${payload.side} $${payload.strike}.`,
    "",
    "System rule: any credible signal means the radar is no longer clean and the",
    "position exits immediately. Verify the headline is credible, then act.",
    "",
    ...payload.hits.flatMap((h) => [
      `• ${h.title}`,
      `  ${h.publisher}${h.publishedAt ? ` — ${h.publishedAt.slice(0, 16)}Z` : ""}`,
      `  ${h.link}`,
      "",
    ]),
    `Basket: ${env.appUrl}/app/baskets/${payload.basketSlug}`,
  ];
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.sendGridApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: env.accessRequestNotifyEmail }], subject }],
      from: { email: env.sendGridFromEmail! },
      content: [{ type: "text/plain", value: lines.join("\n") }],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SendGrid radar alert failed (${response.status}): ${body}`);
  }
  return { sent: true as const };
}
