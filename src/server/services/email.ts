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

// Hard-stop rule from the trading system: close the name at a 25% loss on its
// allocated risk. The hourly sync calls this ONCE per position when the
// modeled P&L first crosses the threshold.
export async function sendStopBreachAlert(payload: StopBreachAlert) {
  if (!hasSendGridConfig()) {
    console.warn("Stop-breach email skipped: SendGrid is not configured.");
    return { sent: false as const, reason: "sendgrid-not-configured" as const };
  }
  const lossPct = payload.margin ? ((payload.pnlAmount / payload.margin) * 100).toFixed(1) : "?";
  const subject = `STOP BREACH: ${payload.ticker} ${payload.side} — ${lossPct}% of allocation`;
  const lines = [
    `${payload.ticker} ${payload.side} $${payload.strike} has breached the 25% name-stop.`,
    "",
    `Modeled P&L: $${Math.round(payload.pnlAmount).toLocaleString()} on $${payload.margin.toLocaleString()} margin (${lossPct}%)`,
    `Underlying: $${payload.underlyingPrice}`,
    "",
    "System rule: close the entire name when loss reaches 25% of its allocated risk.",
    "Verify against your live broker position before acting — this is modeled from the recommended entry.",
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
