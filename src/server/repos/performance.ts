import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { baskets, performanceSnapshots, positions } from "@/db/schema";
import { asNumber, asIsoString } from "./helpers";

const SETTLED_STATES = ["expired-otm", "expired-itm", "manually-closed"] as const;

export interface SettledLeg {
  positionId: string;
  ticker: string;
  side: "call" | "put";
  strike: number;
  entryCredit: number;
  contracts: number;
  margin: number;
  pnl: number;
  state: string;
  settledAt: string;
}

export interface WeeklyPerformance {
  weekOf: string;
  slug: string;
  title: string;
  gsrs: number;
  legs: number;
  settledLegs: number;
  wins: number;
  losses: number;
  pnl: number;
  margin: number;
  credit: number;
  romPct: number | null;
  worstLeg: SettledLeg | null;
  complete: boolean;
}

export interface PerformanceStats {
  totalPnl: number;
  completeWeeks: number;
  winningWeeks: number;
  losingWeeks: number;
  avgWeeklyPnl: number;
  avgWinningWeek: number;
  avgLosingWeek: number;
  bestWeek: number;
  worstWeek: number;
  legWinRatePct: number;
  settledLegs: number;
  maxDrawdown: number;
  worstLeg: SettledLeg | null;
}

export interface PerformanceReport {
  weeks: WeeklyPerformance[];
  cumulative: { weekOf: string; pnl: number; cumulative: number }[];
  stats: PerformanceStats;
}

// Settled-performance report across every basket. "Modeled" throughout:
// entries at the recommended credit, held to expiry, no doubles, no stops,
// no early profit-taking — the raw quality of the recommendations, not a
// record of executed trades.
export async function getPerformanceReport(): Promise<PerformanceReport | null> {
  if (!db) {
    return null;
  }

  const basketRows = await db.select().from(baskets);
  if (basketRows.length === 0) {
    return null;
  }
  const positionRows = await db.select().from(positions);
  const settledRows = await db
    .select()
    .from(performanceSnapshots)
    .where(inArray(performanceSnapshots.state, [...SETTLED_STATES]));

  // Latest settled snapshot wins per position.
  const settledByPosition = new Map<string, (typeof settledRows)[number]>();
  for (const snap of settledRows) {
    const existing = settledByPosition.get(snap.positionId);
    if (!existing || new Date(snap.observedAt) > new Date(existing.observedAt)) {
      settledByPosition.set(snap.positionId, snap);
    }
  }

  const positionsByBasket = new Map<string, (typeof positionRows)[number][]>();
  for (const row of positionRows) {
    const list = positionsByBasket.get(row.basketId) ?? [];
    list.push(row);
    positionsByBasket.set(row.basketId, list);
  }

  const weeks: WeeklyPerformance[] = [];
  for (const basket of basketRows) {
    const basketPositions = positionsByBasket.get(basket.id) ?? [];
    if (basketPositions.length === 0) continue;

    let pnl = 0;
    let wins = 0;
    let losses = 0;
    let settled = 0;
    let margin = 0;
    let credit = 0;
    let worstLeg: SettledLeg | null = null;

    for (const position of basketPositions) {
      margin += position.margin;
      credit += Math.round(asNumber(position.estimatedEntryCredit) * 100 * position.contracts);
      const snap = settledByPosition.get(position.id);
      if (!snap) continue;
      settled += 1;
      const legPnl = asNumber(snap.pnlAmount);
      pnl += legPnl;
      if (legPnl >= 0) wins += 1;
      else losses += 1;
      const leg: SettledLeg = {
        positionId: position.id,
        ticker: position.ticker,
        side: position.side,
        strike: asNumber(position.strike),
        entryCredit: asNumber(position.estimatedEntryCredit),
        contracts: position.contracts,
        margin: position.margin,
        pnl: legPnl,
        state: snap.state,
        settledAt: asIsoString(snap.observedAt),
      };
      if (!worstLeg || leg.pnl < worstLeg.pnl) worstLeg = leg;
    }

    weeks.push({
      weekOf: typeof basket.weekOf === "string" ? basket.weekOf : asIsoString(basket.weekOf).slice(0, 10),
      slug: basket.slug,
      title: basket.title,
      gsrs: asNumber(basket.gsrs),
      legs: basketPositions.length,
      settledLegs: settled,
      wins,
      losses,
      pnl: Math.round(pnl),
      margin,
      credit,
      romPct: margin > 0 ? +((pnl / margin) * 100).toFixed(2) : null,
      worstLeg,
      complete: settled === basketPositions.length && settled > 0,
    });
  }

  weeks.sort((a, b) => a.weekOf.localeCompare(b.weekOf));

  const completeWeeks = weeks.filter((w) => w.complete);
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const cumulative = completeWeeks.map((w) => {
    running += w.pnl;
    peak = Math.max(peak, running);
    maxDrawdown = Math.min(maxDrawdown, running - peak);
    return { weekOf: w.weekOf, pnl: w.pnl, cumulative: running };
  });

  const winningWeeks = completeWeeks.filter((w) => w.pnl >= 0);
  const losingWeeks = completeWeeks.filter((w) => w.pnl < 0);
  const totalWins = completeWeeks.reduce((a, w) => a + w.wins, 0);
  const totalLegs = completeWeeks.reduce((a, w) => a + w.settledLegs, 0);
  const allWorst = completeWeeks
    .map((w) => w.worstLeg)
    .filter((l): l is SettledLeg => l != null)
    .sort((a, b) => a.pnl - b.pnl);

  const stats: PerformanceStats = {
    totalPnl: Math.round(completeWeeks.reduce((a, w) => a + w.pnl, 0)),
    completeWeeks: completeWeeks.length,
    winningWeeks: winningWeeks.length,
    losingWeeks: losingWeeks.length,
    avgWeeklyPnl: completeWeeks.length
      ? Math.round(completeWeeks.reduce((a, w) => a + w.pnl, 0) / completeWeeks.length)
      : 0,
    avgWinningWeek: winningWeeks.length
      ? Math.round(winningWeeks.reduce((a, w) => a + w.pnl, 0) / winningWeeks.length)
      : 0,
    avgLosingWeek: losingWeeks.length
      ? Math.round(losingWeeks.reduce((a, w) => a + w.pnl, 0) / losingWeeks.length)
      : 0,
    bestWeek: completeWeeks.length ? Math.max(...completeWeeks.map((w) => w.pnl)) : 0,
    worstWeek: completeWeeks.length ? Math.min(...completeWeeks.map((w) => w.pnl)) : 0,
    legWinRatePct: totalLegs ? +((totalWins / totalLegs) * 100).toFixed(1) : 0,
    settledLegs: totalLegs,
    maxDrawdown: Math.round(maxDrawdown),
    worstLeg: allWorst[0] ?? null,
  };

  return { weeks, cumulative, stats };
}
