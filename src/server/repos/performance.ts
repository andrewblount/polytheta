import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { basketMetrics, baskets, performanceSnapshots, positions } from "@/db/schema";
import { getModelSettings, type ModelSettings } from "@/server/services/model-settings";
import { sizingBacking } from "../../../shared/broker-settings.mjs";
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
  cashNeeded: number;
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

// How the legs were sized for this report. "model": every historical leg is
// re-sized from the current model settings (equity × share traded × margin
// available, split equally, side toggles applied), so changing the settings
// changes the whole track record. "published": the contracts each basket was
// published with.
export interface PerformanceBasis {
  sizing: "model" | "published";
  modelEquity: number | null;
  accountTradedPct: number | null;
  marginAvailablePct: number | null;
  sellCalls: boolean;
  sellPuts: boolean;
  backing: number | null;
}

export interface PerformanceReport {
  weeks: WeeklyPerformance[];
  cumulative: { weekOf: string; pnl: number; cumulative: number }[];
  stats: PerformanceStats;
  basis: PerformanceBasis;
}

export interface PerformanceOptions {
  sizing?: "model" | "published";
  model?: ModelSettings;
}

// Re-size one leg under a sizing policy. Per-contract economics come from the
// published leg; the contract count is what the policy would have bought.
export function resizeLeg(leg: { entryPrice: number; strike: number; contracts: number; margin: number; credit: number; pnl: number | null }, perTradeBacking: number) {
  const unit = Math.max(leg.entryPrice, leg.strike) * 100;
  const contracts = unit > 0 && perTradeBacking > 0 ? Math.floor(perTradeBacking / unit) : 0;
  const ratio = leg.contracts > 0 ? contracts / leg.contracts : 0;
  return {
    contracts,
    margin: Math.round(leg.margin * ratio),
    credit: Math.round(leg.credit * ratio),
    pnl: leg.pnl == null ? null : leg.pnl * ratio,
  };
}

// Settled-performance report across every basket. "Modeled" throughout:
// entries at the recommended credit, held to expiry, no doubles, no stops,
// no early profit-taking — the raw quality of the recommendations, not a
// record of executed trades.
export async function getPerformanceReport(options: PerformanceOptions = {}): Promise<PerformanceReport | null> {
  if (!db) {
    return null;
  }

  const basketRows = await db.select().from(baskets);
  if (basketRows.length === 0) {
    return null;
  }
  const sizing = options.sizing ?? "model";
  const model = sizing === "model" ? options.model ?? (await getModelSettings()) : null;
  const metricRows = await db.select({ basketId: basketMetrics.basketId, otherMetrics: basketMetrics.otherMetrics }).from(basketMetrics);
  const scaleByBasket = new Map(metricRows.map((m) => [m.basketId, Number((m.otherMetrics as { allocation_scale?: unknown } | null)?.allocation_scale ?? 1) || 1]));
  const backing = model ? sizingBacking(model.modelEquity, model) : null;
  const basis: PerformanceBasis = model
    ? { sizing: "model", modelEquity: model.modelEquity, accountTradedPct: model.accountTradedPct, marginAvailablePct: model.marginAvailablePct, sellCalls: model.sellCalls, sellPuts: model.sellPuts, backing }
    : { sizing: "published", modelEquity: null, accountTradedPct: null, marginAvailablePct: null, sellCalls: true, sellPuts: true, backing: null };
  const positionRows = await db.select().from(positions);
  const settledRows = await db
    .select()
    .from(performanceSnapshots)
    .where(inArray(performanceSnapshots.state, [...SETTLED_STATES]));

  // Latest settled snapshot wins per position.
  const settledByPosition = new Map<string, (typeof settledRows)[number]>();
  for (const snap of settledRows) {
    const existing = settledByPosition.get(snap.positionId);
    // A model exit (manually-closed) is final; a later expiry settlement never overrides it.
    const outranks = !existing || (snap.state === "manually-closed" && existing.state !== "manually-closed") ||
      (existing.state !== "manually-closed" && new Date(snap.observedAt) > new Date(existing.observedAt));
    if (outranks) settledByPosition.set(snap.positionId, snap);
  }

  const positionsByBasket = new Map<string, (typeof positionRows)[number][]>();
  for (const row of positionRows) {
    const list = positionsByBasket.get(row.basketId) ?? [];
    list.push(row);
    positionsByBasket.set(row.basketId, list);
  }

  const weeks: WeeklyPerformance[] = [];
  for (const basket of basketRows) {
    const allPositions = positionsByBasket.get(basket.id) ?? [];
    // Side toggles remove legs from the model entirely; the remaining legs share the backing.
    const basketPositions = model ? allPositions.filter((p) => (p.side === "call" ? model.sellCalls : model.sellPuts)) : allPositions;
    if (basketPositions.length === 0) continue;
    const perTrade = backing != null ? (backing * (scaleByBasket.get(basket.id) ?? 1)) / basketPositions.length : null;

    let pnl = 0;
    let wins = 0;
    let losses = 0;
    let settled = 0;
    let margin = 0;
    let credit = 0;
    let worstLeg: SettledLeg | null = null;

    for (const position of basketPositions) {
      const snap = settledByPosition.get(position.id);
      const published = {
        entryPrice: asNumber(position.entryUnderlyingPrice), strike: asNumber(position.strike), contracts: position.contracts, margin: position.margin,
        credit: Math.round(asNumber(position.estimatedEntryCredit) * 100 * position.contracts), pnl: snap ? asNumber(snap.pnlAmount) : null,
      };
      const sized = perTrade != null ? resizeLeg(published, perTrade) : published;
      margin += sized.margin;
      credit += sized.credit;
      if (!snap || sized.pnl == null) continue;
      settled += 1;
      const legPnl = sized.pnl;
      pnl += legPnl;
      if (legPnl >= 0) wins += 1;
      else losses += 1;
      const leg: SettledLeg = {
        positionId: position.id,
        ticker: position.ticker,
        side: position.side,
        strike: asNumber(position.strike),
        entryCredit: asNumber(position.estimatedEntryCredit),
        contracts: sized.contracts,
        margin: sized.margin,
        pnl: Math.round(legPnl),
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
      cashNeeded: basket.cashNeeded,
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

  return { weeks, cumulative, stats, basis };
}
