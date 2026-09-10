import { eq } from "drizzle-orm";

import { db } from "@/db";
import { easternTime, marketSession, weeklyExpiry, sessionClose } from "../../../shared/market-calendar.mjs";
import { syncLogs, userProfiles } from "@/db/schema";
import { env } from "@/lib/env";

import { getCurrentBasket } from "@/server/repos/baskets";
import { getPerformanceReport } from "@/server/repos/performance";

import { alertEmailShell, kvRowsHtml } from "./email";
import { getNotificationSettings } from "./settings";
import { getMemberPerformance } from "./member-performance";
import { getBrokerPortfolio } from "./broker-portfolio";
import { sendTwilioMessage } from "./twilio";

// Actual P/L is exclusively the attributed IB portfolio. Recommended-basket
// snapshots remain a separate modeled record; premium cash flow is not P/L.
function fmtMoney(v: number) {
  const sign = v < 0 ? "-" : "+";
  return `${sign}$${Math.abs(Math.round(v)).toLocaleString()}`;
}

type BrokerBriefingState = { snapshot: Record<string, unknown> | null; stale: boolean };
export function actualBriefingSummary(broker: BrokerBriefingState, now = new Date()) {
  const snapshot = broker.snapshot;
  const age = +now - Date.parse(String(snapshot?.observedAt));
  const unavailable = (reason: string) => ({
    rows: [["PolyTheta actual P/L", reason]] as Array<[string, string]>,
    compact: `PolyTheta IB P/L unavailable (${reason})`, unrealizedPnl: null, realizedPnl: null,
  });
  if (!snapshot || snapshot.scope !== "PolyTheta only" || !Array.isArray(snapshot.positions)) return unavailable("No attributed IB snapshot available");
  if (broker.stale || !Number.isFinite(age) || age < -1000 || age > 120000) return unavailable("IB connection or snapshot is stale");
  const positions = snapshot.positions as Array<Record<string, unknown>>;
  if (positions.some(p => !p || typeof p !== "object")) return unavailable("IB positions need reconciliation");
  const open = positions.filter(p => typeof p.quantity === "number" && p.quantity > 0 || p.workingEntry === true);
  // A historical expiration awaiting its statement must not conceal current
  // reconciled open P/L. A missing current holding must remain unknown.
  const unresolvedCurrent = positions.some(p => {
    if (p.reconciled === true) return false;
    try { return !(p.quantity === 0 && !p.workingEntry && +sessionClose(String(p.expiry)) <= +now); }
    catch { return true; }
  });
  const unrealizedPnl = !unresolvedCurrent && open.every(p => p.reconciled === true && typeof p.unrealizedPnl === "number" && Number.isFinite(p.unrealizedPnl))
    ? open.reduce((sum, p) => sum + Number(p.unrealizedPnl), 0) : null;
  const realizedPnl = positions.every(p => p.reconciled === true && typeof p.realizedPnl === "number" && Number.isFinite(p.realizedPnl))
    ? positions.reduce((sum, p) => sum + Number(p.realizedPnl), 0) : null;
  const fees = typeof snapshot.fees === "number" && Number.isFinite(snapshot.fees) ? snapshot.fees : null;
  const feesComplete = positions.every(p => p.feesComplete === true);
  const rows: Array<[string, string]> = [
    ["PolyTheta open P/L (actual, before fees)", unrealizedPnl == null ? "Unavailable — marks or position reconciliation pending" : fmtMoney(unrealizedPnl)],
    ["PolyTheta realized P/L (actual, before fees)", realizedPnl == null ? "Unavailable — settlement or reconciliation pending" : fmtMoney(realizedPnl)],
    ["PolyTheta confirmed fees", fees == null ? "Unavailable" : `$${fees.toFixed(2)}${feesComplete ? "" : " (partial; awaiting IB)"}`],
    ["IB snapshot", `${snapshot.observedAt}${snapshot.complete === true ? "" : " · some figures remain incomplete"}`],
  ];
  return { rows, compact: `PolyTheta IB open P/L ${unrealizedPnl == null ? "unavailable (reconciliation pending)" : fmtMoney(unrealizedPnl)} before fees`, unrealizedPnl, realizedPnl };
}

type BriefingInputs = {
  basket: Awaited<ReturnType<typeof getCurrentBasket>>;
  report: Awaited<ReturnType<typeof getPerformanceReport>>;
  broker: BrokerBriefingState;
  now?: Date;
};

export function buildBriefing(slot: "open" | "close", { basket, report, broker, now = new Date() }: BriefingInputs) {
  const allPositions = basket ? [...basket.callPositions, ...basket.putPositions] : [];
  const positions = allPositions.filter(p => Number.isFinite(Date.parse(p.entryTimestamp)) && Date.parse(p.entryTimestamp) <= +now);
  const plannedCount = allPositions.length - positions.length;
  const today = easternTime(now).date;
  const actual = actualBriefingSummary(broker, now);

  let dayPnl = 0;
  let weekPnl = 0;
  const rows: Array<[string, string]> = [];
  for (const p of positions) {
    const history = [...p.performanceHistory].filter(s => Date.parse(s.observedAt) <= +now).sort(
      (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
    );
    const fallback = Date.parse(p.latestPerformance.observedAt) <= +now ? p.latestPerformance : null;
    const latest = history.at(-1) ?? fallback;
    const prevSession = [...history].reverse().find((s) => easternTime(new Date(s.observedAt)).date < today);
    const latestPnl = latest?.pnlAmount ?? 0;
    const prevPnl = prevSession?.pnlAmount ?? 0;
    const d = latest && easternTime(new Date(latest.observedAt)).date === today ? latestPnl - prevPnl : 0;
    dayPnl += d;
    weekPnl += latestPnl;
    rows.push([
      `${p.ticker} ${p.side === "call" ? "C" : "P"} $${p.strike}`,
      latest ? `${fmtMoney(latestPnl)} basket · ${fmtMoney(d)} day · ${latest.state}` : "No modeled snapshot available",
    ]);
  }

  const settledTotal = report?.stats.totalPnl ?? 0;
  const currentSettled = report?.weeks.find(w => w.weekOf === basket?.weekOf)?.pnl ?? 0;
  const totalReturn = settledTotal + weekPnl - currentSettled;
  const isFriday = today === weeklyExpiry(today);
  const title = slot === "open" ? `Open briefing — ${today}`
    : `Close briefing — ${today}: modeled day ${fmtMoney(dayPnl)}, basket ${fmtMoney(weekPnl)}`;

  const summaryRows: Array<[string, string]> = [
    ["Day P&L (modeled)", fmtMoney(dayPnl)],
    ["Basket to date (modeled)", fmtMoney(weekPnl)],
    ["Total system return (modeled)", fmtMoney(totalReturn)],
    ["Settled weeks (modeled)", `${report?.stats.completeWeeks ?? 0} (${report?.stats.winningWeeks ?? 0} wins, leg OTM ${report?.stats.legWinRatePct ?? 0}%)`],
  ];
  if (basket) summaryRows.push(["GSRS at entry", String(basket.gsrs)]);

  const bodyHtml = kvRowsHtml(summaryRows) +
    (positions.length
      ? `<h2 style="margin:16px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#667085">Modeled basket positions</h2>` + kvRowsHtml(rows)
      : `<p style="margin:14px 0 0;font-size:14px;color:#b42318;font-weight:600">${basket ? "The published basket has no entries whose planned start has arrived." : "This week’s basket is not available. No previous week is being presented as current."}</p>`) +
    (plannedCount ? `<p style="margin:14px 0 0;font-size:13px">${plannedCount} planned positions are excluded from modeled P/L until their entry time.</p>` : "") +
    (slot === "close" && isFriday
      ? `<p style="margin:14px 0 0;font-size:13px;background:#eff8ff;border:1px solid #b2ddff;border-radius:8px;padding:10px 12px">Weekly expiry day: modeled settlement results are recorded after the close. Actual IB results remain pending until the broker records and positions reconcile.</p>`
      : "") +
    `<p style="margin:14px 0 0;font-size:11px;color:#98a2b3">Modeled figures assume recommended entries held to expiry. They are separate from actual PolyTheta fills and holdings.</p>`;

  // Member emails contain their modeled tracking figures, never the owner's
  // private IB portfolio. Calling with no personal rows builds the owner email.
  const buildHtml = (personalRows?: Array<[string, string]>) => alertEmailShell({
    banner: slot === "open" ? "OPEN BRIEFING" : "CLOSE BRIEFING",
    bannerColor: slot === "open" ? "#175cd3" : "#0b1524",
    title,
    bodyHtml: (personalRows !== undefined
      ? (personalRows.length ? `<h2 style="margin:0 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#667085">Your modeled tracking</h2>${kvRowsHtml(personalRows)}<div style="height:14px"></div>` : "")
      : `<h2 style="margin:0 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#667085">PolyTheta only · IB actuals</h2>${kvRowsHtml(actual.rows)}<div style="height:14px"></div>`) + bodyHtml,
    footerHtml: `<a href="${env.appUrl}/app/dashboard" style="color:#2f6fed">Open dashboard →</a>`,
  });
  const modeledCompact = `${slot === "open" ? "☀️ Open" : "🌙 Close"}: modeled day ${fmtMoney(dayPnl)} | basket ${fmtMoney(weekPnl)} | total ${fmtMoney(totalReturn)}` +
    (positions.length ? ` | ${positions.map(p => p.ticker).join(" ")}` : " | no started modeled positions");
  const compact = `${modeledCompact} | ${actual.compact}`;
  return { title, html: buildHtml(), buildHtml, compact, modeledCompact, dayPnl, weekPnl, totalReturn };
}

export async function composeBriefing(slot: "open" | "close") {
  const [basket, report, broker] = await Promise.all([
    getCurrentBasket(), getPerformanceReport(),
    getBrokerPortfolio().catch(() => ({ snapshot: null, stale: true })),
  ]);
  return buildBriefing(slot, { basket, report, broker });
}

export async function sendBriefing(slot: "open" | "close") {
  if (!marketSession(easternTime().date).open) return { sent: false, reason: "market-holiday-or-weekend" };
  const settings = await getNotificationSettings();
  const prefs = settings[slot === "open" ? "briefing_open" : "briefing_close"] ?? {};
  if (!prefs.email && !prefs.imessage && !prefs.sms && !prefs.whatsapp) {
    return { sent: false as const, reason: "disabled-in-settings" };
  }

  const briefing = await composeBriefing(slot);
  const results: Record<string, unknown> = {};

  if (prefs.email && env.sendGridApiKey && env.sendGridFromEmail) {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.sendGridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: env.accessRequestNotifyEmail }], subject: briefing.title }],
        from: { email: env.sendGridFromEmail },
        content: [
          { type: "text/plain", value: briefing.compact },
          { type: "text/html", value: briefing.html },
        ],
      }),
    });
    results.email = response.ok;
  }

  // Fan out to members who opted into briefing emails in their own settings,
  // each with their tracked account line up top. Andrew's env address is
  // handled above, so it's excluded here to avoid doubles.
  if (env.sendGridApiKey && env.sendGridFromEmail && db) {
    const prefKey = slot === "open" ? "briefing_open_email" : "briefing_close_email";
    const memberRows = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.status, "active"));
    const recipients = memberRows.filter(
      (member) =>
        member.notificationPrefs?.[prefKey] === true &&
        member.email &&
        member.email.toLowerCase() !== env.accessRequestNotifyEmail.toLowerCase(),
    );
    let memberSends = 0;
    for (const member of recipients) {
      try {
        const mine = await getMemberPerformance({
          startingCapital:
            member.startingCapital != null ? Number(member.startingCapital) : null,
          trackingStartDate: member.trackingStartDate ?? null,
        });
        const personalRows: Array<[string, string]> = mine
          ? [
              ["Your tracked value (modeled)", `$${Math.round(mine.currentValue).toLocaleString()}`],
              [
                "Your total return (modeled)",
                `${mine.totalReturn >= 0 ? "+" : "-"}$${Math.abs(Math.round(mine.totalReturn)).toLocaleString()} (${mine.totalReturnPct >= 0 ? "+" : ""}${mine.totalReturnPct}%)`,
              ],
              ...(mine.liveWeekPnl != null
                ? ([[
                    "Your week so far (modeled)",
                    `${mine.liveWeekPnl >= 0 ? "+" : "-"}$${Math.abs(mine.liveWeekPnl).toLocaleString()}`,
                  ]] as Array<[string, string]>)
                : []),
            ]
          : [];
        const compactLine = mine
          ? `${briefing.modeledCompact} | your modeled value $${Math.round(mine.currentValue).toLocaleString()}`
          : briefing.modeledCompact;
        const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.sendGridApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: member.email }], subject: briefing.title }],
            from: { email: env.sendGridFromEmail },
            content: [
              { type: "text/plain", value: compactLine },
              { type: "text/html", value: briefing.buildHtml(personalRows) },
            ],
          }),
        });
        if (response.ok) memberSends += 1;
      } catch (error) {
        console.error(
          `member briefing email failed for ${member.email}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    if (recipients.length > 0) results.memberEmails = `${memberSends}/${recipients.length}`;
  }

  if (prefs.imessage && db) {
    // The Mac alert bridge polls these rows and forwards them as iMessages.
    await db.insert(syncLogs).values({
      level: "alert",
      message: briefing.compact,
      metadata: { kind: "briefing", slot },
    });
    results.imessage = "queued-for-bridge";
  }

  if (prefs.sms) results.sms = await sendTwilioMessage("sms", briefing.compact);
  if (prefs.whatsapp) results.whatsapp = await sendTwilioMessage("whatsapp", briefing.compact);

  return { sent: true as const, slot, results, compact: briefing.compact };
}
