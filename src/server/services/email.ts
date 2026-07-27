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

// Shared shell for all alert emails: clean card, big verdict banner, readable
// on phone mail clients. Inline styles only (email clients strip <style>).
// Keep visually in sync with the template in scripts/verify_basket_live.mjs.
export function alertEmailShell(opts: {
  banner: string;
  bannerColor: string; // e.g. "#b42318" red, "#b54708" amber, "#027a48" green
  title: string;
  bodyHtml: string;
  footerHtml?: string;
}) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#101828">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e4e7ec;border-radius:12px;overflow:hidden">
    <div style="background:${opts.bannerColor};color:#ffffff;padding:14px 20px;font-size:15px;font-weight:700;letter-spacing:.3px">${escapeHtml(opts.banner)}</div>
    <div style="padding:20px">
      <h1 style="margin:0 0 12px;font-size:18px;line-height:1.3">${escapeHtml(opts.title)}</h1>
      ${opts.bodyHtml}
    </div>
    ${opts.footerHtml ? `<div style="padding:12px 20px;border-top:1px solid #e4e7ec;font-size:12px;color:#667085">${opts.footerHtml}</div>` : ""}
  </div>
  <p style="max-width:600px;margin:12px auto 0;font-size:11px;color:#98a2b3;text-align:center">Polytheta · modeled from recommended entries — verify against your live broker positions.</p>
</body></html>`;
}

export function kvRowsHtml(rows: Array<[string, string]>) {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows
    .map(
      ([k, v], i) =>
        `<tr style="background:${i % 2 ? "#f9fafb" : "#ffffff"}"><td style="padding:8px 10px;color:#667085;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:8px 10px;font-weight:600;text-align:right">${escapeHtml(v)}</td></tr>`,
    )
    .join("")}</table>`;
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
      content: [
        { type: "text/plain", value: lines.join("\n") },
        {
          type: "text/html",
          value: alertEmailShell({
            banner: "HEADS-UP — LARGE ADVERSE MOVE",
            bannerColor: "#b54708",
            title: `${payload.ticker} ${payload.side} $${payload.strike} — ${lossPct}% of allocation`,
            bodyHtml:
              kvRowsHtml([
                ["Modeled P&L", `$${Math.round(payload.pnlAmount).toLocaleString()}`],
                ["Allocation (margin)", `$${payload.margin.toLocaleString()}`],
                ["Underlying", `$${payload.underlyingPrice}`],
              ]) +
              `<p style="margin:14px 0 0;font-size:14px;line-height:1.5;background:#fffaeb;border:1px solid #fedf89;border-radius:8px;padding:10px 12px"><strong>Policy v3: hold to expiry.</strong> Exit only if the thesis changed — check for acquisition or downside-gap news on this name. A move this size with no headline is usually flow, not news. Radar alerts fire separately on matching headlines.</p>`,
            footerHtml: `<a href="${env.appUrl}/app/baskets/${payload.basketSlug}" style="color:#2f6fed">Open basket →</a>`,
          }),
        },
      ],
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
  const hitsHtml = payload.hits
    .map(
      (h) => `<div style="border:1px solid #e4e7ec;border-radius:8px;padding:12px;margin:0 0 10px">
        <div style="font-size:14px;font-weight:600;line-height:1.4"><a href="${h.link}" style="color:#101828;text-decoration:none">${escapeHtml(h.title)}</a></div>
        <div style="font-size:12px;color:#667085;margin-top:4px">${escapeHtml(h.publisher)}${h.publishedAt ? ` · ${h.publishedAt.slice(0, 16).replace("T", " ")}Z` : ""} · <a href="${h.link}" style="color:#2f6fed">read →</a></div>
      </div>`,
    )
    .join("");
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.sendGridApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: env.accessRequestNotifyEmail }], subject }],
      from: { email: env.sendGridFromEmail! },
      content: [
        { type: "text/plain", value: lines.join("\n") },
        {
          type: "text/html",
          value: alertEmailShell({
            banner: `${radarName} — EXIT SIGNAL`,
            bannerColor: "#b42318",
            title: `${payload.ticker} ${payload.side} $${payload.strike}`,
            bodyHtml:
              `<p style="margin:0 0 14px;font-size:14px;line-height:1.5">System rule: <strong>any credible signal means immediate full exit</strong> on this name. Verify the headline, then act.</p>` +
              hitsHtml,
            footerHtml: `<a href="${env.appUrl}/app/baskets/${payload.basketSlug}" style="color:#2f6fed">Open basket →</a>`,
          }),
        },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SendGrid radar alert failed (${response.status}): ${body}`);
  }
  return { sent: true as const };
}
