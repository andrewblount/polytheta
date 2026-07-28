import { desc, gte } from "drizzle-orm";

import { db } from "@/db";
import { schwabSnapshots, syncLogs, trades } from "@/db/schema";
import { env } from "@/lib/env";

import { getCurrentBasket } from "@/server/repos/baskets";
import { getPerformanceReport } from "@/server/repos/performance";

import { alertEmailShell, kvRowsHtml } from "./email";
import { getNotificationSettings } from "./settings";

// Daily briefings: a morning read on the basket right after the open, and an
// evening scorecard after the close. Day P&L is the change in each position's
// modeled P&L versus the previous session's last snapshot; week-to-date is
// the position's latest P&L outright (entries start at zero). Total return
// combines the settled record with the live week. Actual account numbers
// come from the trades ledger (net premium) and, when the Mac-side fetcher
// has posted a fresh snapshot, from Schwab.

function fmtMoney(v: number) {
  const sign = v < 0 ? "-" : "+";
  return `${sign}$${Math.abs(Math.round(v)).toLocaleString()}`;
}

async function latestSchwab() {
  if (!db) return null;
  const rows = await db
    .select()
    .from(schwabSnapshots)
    .orderBy(desc(schwabSnapshots.takenAt))
    .limit(1);
  if (rows.length === 0) return null;
  const snap = rows[0];
  const ageH = (Date.now() - snap.takenAt.getTime()) / 3600000;
  if (ageH > 20) return null; // stale — omit rather than mislead
  return {
    liquidationValue: snap.liquidationValue ? Number(snap.liquidationValue) : null,
    dayPl: snap.dayPl ? Number(snap.dayPl) : null,
    takenAt: snap.takenAt.toISOString(),
  };
}

export async function composeBriefing(slot: "open" | "close") {
  const basket = await getCurrentBasket();
  const report = await getPerformanceReport();
  const schwab = await latestSchwab();

  const positions = basket ? [...basket.callPositions, ...basket.putPositions] : [];
  const today = new Date().toISOString().slice(0, 10);

  let dayPnl = 0;
  let weekPnl = 0;
  const rows: Array<[string, string]> = [];
  for (const p of positions) {
    const history = [...p.performanceHistory].sort(
      (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
    );
    const latest = history[history.length - 1] ?? p.latestPerformance;
    const prevSession = [...history].reverse().find((s) => s.observedAt.slice(0, 10) < today);
    const latestPnl = latest?.pnlAmount ?? 0;
    const prevPnl = prevSession?.pnlAmount ?? 0;
    const d = latest && latest.observedAt.slice(0, 10) === today ? latestPnl - prevPnl : 0;
    dayPnl += d;
    weekPnl += latestPnl;
    rows.push([
      `${p.ticker} ${p.side === "call" ? "C" : "P"} $${p.strike}`,
      `${fmtMoney(latestPnl)} wk · ${fmtMoney(d)} day · ${latest?.state ?? "no data"}`,
    ]);
  }

  const settledTotal = report?.stats.totalPnl ?? 0;
  const totalReturn = settledTotal + weekPnl;

  // Actuals from the trades ledger.
  let actualNetPremium = 0;
  let fillsThisWeek = 0;
  if (db) {
    const weekStart = new Date();
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7)); // Monday
    weekStart.setUTCHours(0, 0, 0, 0);
    const allTrades = await db.select().from(trades);
    for (const t of allTrades) {
      const gross = Number(t.price) * 100 * t.quantity;
      actualNetPremium += (t.action === "sell-to-open" ? gross : -gross) - Number(t.fees);
      if (t.executedAt >= weekStart) fillsThisWeek += 1;
    }
  }

  const isFriday = new Date().getUTCDay() === 5;
  const title =
    slot === "open"
      ? `Open briefing — ${today}`
      : `Close briefing — ${today}: day ${fmtMoney(dayPnl)}, week ${fmtMoney(weekPnl)}`;

  const summaryRows: Array<[string, string]> = [
    ["Day P&L (modeled)", fmtMoney(dayPnl)],
    ["Week to date (modeled)", fmtMoney(weekPnl)],
    ["Total system return (modeled)", fmtMoney(totalReturn)],
    ["Settled weeks", `${report?.stats.completeWeeks ?? 0} (${report?.stats.winningWeeks ?? 0} wins, leg OTM ${report?.stats.legWinRatePct ?? 0}%)`],
    ["Actual net premium (your fills)", `${fmtMoney(actualNetPremium)} · ${fillsThisWeek} fills this week`],
  ];
  if (schwab?.liquidationValue != null) {
    summaryRows.push([
      "Schwab account (actual)",
      `$${Math.round(schwab.liquidationValue).toLocaleString()}${schwab.dayPl != null ? ` · day ${fmtMoney(schwab.dayPl)}` : ""}`,
    ]);
  }
  if (basket) summaryRows.push(["GSRS at entry", String(basket.gsrs)]);

  const bodyHtml =
    kvRowsHtml(summaryRows) +
    (positions.length
      ? `<h2 style="margin:16px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#667085">Positions${basket ? ` — ${basket.title}` : ""}</h2>` +
        kvRowsHtml(rows)
      : `<p style="margin:14px 0 0;font-size:14px;color:#b42318;font-weight:600">No positions in the current basket.</p>`) +
    (slot === "close" && isFriday
      ? `<p style="margin:14px 0 0;font-size:13px;background:#eff8ff;border:1px solid #b2ddff;border-radius:8px;padding:10px 12px">Expiry day: positions settle after today's close — the weekend settlement pass records final results, and Monday's briefing carries the completed week.</p>`
      : "") +
    `<p style="margin:14px 0 0;font-size:11px;color:#98a2b3">Modeled figures assume recommended entries held to expiry. Verify actuals at the broker.</p>`;

  const html = alertEmailShell({
    banner: slot === "open" ? "OPEN BRIEFING" : "CLOSE BRIEFING",
    bannerColor: slot === "open" ? "#175cd3" : "#0b1524",
    title,
    bodyHtml,
    footerHtml: `<a href="${env.appUrl}/app/dashboard" style="color:#2f6fed">Open dashboard →</a>`,
  });

  const compact =
    `${slot === "open" ? "☀️" : "🌙"} ${slot === "open" ? "Open" : "Close"}: day ${fmtMoney(dayPnl)} | wk ${fmtMoney(weekPnl)} | total ${fmtMoney(totalReturn)}` +
    (schwab?.liquidationValue != null ? ` | Schwab $${Math.round(schwab.liquidationValue).toLocaleString()}` : "") +
    (positions.length ? ` | ${positions.map((p) => p.ticker).join(" ")}` : " | no positions");

  return { title, html, compact, dayPnl, weekPnl, totalReturn };
}

export async function sendBriefing(slot: "open" | "close") {
  const settings = await getNotificationSettings();
  const prefs = settings[slot === "open" ? "briefing_open" : "briefing_close"] ?? {};
  if (!prefs.email && !prefs.imessage) {
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

  if (prefs.imessage && db) {
    // The Mac alert bridge polls these rows and forwards them as iMessages.
    await db.insert(syncLogs).values({
      level: "alert",
      message: briefing.compact,
      metadata: { kind: "briefing", slot },
    });
    results.imessage = "queued-for-bridge";
  }

  return { sent: true as const, slot, results, compact: briefing.compact };
}
