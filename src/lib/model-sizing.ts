// Model performance sizing — pure, dependency-free, and shared by the server
// report, the browser (live recalculation while the sliders move) and, as a
// port, the iOS app (ModelSizing.swift). Keep the three in step.
//
// Every historical leg is re-sized from the model settings: backing = equity ×
// share traded × margin available, split equally across the legs of a basket
// (times the basket's allocation scale), side toggles removing legs entirely.
// Per-contract economics (credit, P&L, margin) come from the published leg and
// scale with the contract count.

export interface SizingSettings {
  modelEquity: number;
  accountTradedPct: number;
  marginAvailablePct: number;
  sellCalls: boolean;
  sellPuts: boolean;
}

// One published leg with its settled outcome (pnl null while open).
export interface PerformanceLegSource {
  positionId: string;
  ticker: string;
  side: "call" | "put";
  strike: number;
  entryPrice: number;
  entryCredit: number;
  contracts: number;
  margin: number;
  credit: number;
  pnl: number | null;
  state: string | null;
  settledAt: string | null;
}

export interface PerformanceWeekSource {
  weekOf: string;
  slug: string;
  title: string;
  gsrs: number;
  cashNeeded: number;
  allocationScale: number;
  legs: PerformanceLegSource[];
}

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

// How the legs were sized for a report. "model": every historical leg is
// re-sized from the model settings, so changing them changes the whole track
// record. "published": the contracts each basket was published with.
export interface PerformanceBasis {
  sizing: "model" | "published";
  modelEquity: number | null;
  accountTradedPct: number | null;
  marginAvailablePct: number | null;
  sellCalls: boolean;
  sellPuts: boolean;
  backing: number | null;
}

export interface ModelPerformance {
  weeks: WeeklyPerformance[];
  cumulative: { weekOf: string; pnl: number; cumulative: number }[];
  stats: PerformanceStats;
  basis: PerformanceBasis;
}

export const SLIDER_RANGES = {
  accountTradedPct: { min: 0, max: 100, step: 1 },
  marginAvailablePct: { min: 100, max: 1000, step: 25 },
} as const;

// Dollars of strike-or-spot notional the settings back. Mirrors
// shared/broker-settings.mjs sizingBacking without importing it, so this file
// stays safe to ship to the browser.
export function modelBacking(settings: SizingSettings) {
  const traded = Number(settings.accountTradedPct);
  const margin = Number(settings.marginAvailablePct);
  return Math.max(0, Number(settings.modelEquity) || 0) * (Number.isFinite(traded) ? traded : 100) / 100 * (Number.isFinite(margin) ? margin : 100) / 100;
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

export function sideEnabled(side: "call" | "put", settings: SizingSettings) {
  return side === "call" ? settings.sellCalls : settings.sellPuts;
}

// Settled-performance report across every basket under a sizing policy
// (null = the published contracts). "Modeled" throughout: entries at the
// recommended credit, held to expiry or exited on a radar signal — the raw
// quality of the recommendations, not a record of executed trades.
export function computeModelPerformance(source: PerformanceWeekSource[], model: SizingSettings | null): ModelPerformance {
  const backing = model ? modelBacking(model) : null;
  const basis: PerformanceBasis = model
    ? { sizing: "model", modelEquity: model.modelEquity, accountTradedPct: model.accountTradedPct, marginAvailablePct: model.marginAvailablePct, sellCalls: model.sellCalls, sellPuts: model.sellPuts, backing }
    : { sizing: "published", modelEquity: null, accountTradedPct: null, marginAvailablePct: null, sellCalls: true, sellPuts: true, backing: null };

  const weeks: WeeklyPerformance[] = [];
  for (const week of source) {
    // Side toggles remove legs from the model entirely; the remaining legs share the backing.
    const legs = model ? week.legs.filter((leg) => sideEnabled(leg.side, model)) : week.legs;
    if (legs.length === 0) continue;
    const perTrade = backing != null ? (backing * (week.allocationScale || 1)) / legs.length : null;

    let pnl = 0, wins = 0, losses = 0, settled = 0, margin = 0, credit = 0;
    let worstLeg: SettledLeg | null = null;
    for (const leg of legs) {
      const sized = perTrade != null ? resizeLeg(leg, perTrade) : leg;
      margin += sized.margin;
      credit += sized.credit;
      if (sized.pnl == null || leg.state == null || leg.settledAt == null) continue;
      settled += 1;
      pnl += sized.pnl;
      if (sized.pnl >= 0) wins += 1;
      else losses += 1;
      const settledLeg: SettledLeg = {
        positionId: leg.positionId, ticker: leg.ticker, side: leg.side, strike: leg.strike, entryCredit: leg.entryCredit,
        contracts: sized.contracts, margin: sized.margin, pnl: Math.round(sized.pnl), state: leg.state, settledAt: leg.settledAt,
      };
      if (!worstLeg || settledLeg.pnl < worstLeg.pnl) worstLeg = settledLeg;
    }

    weeks.push({
      weekOf: week.weekOf, slug: week.slug, title: week.title, gsrs: week.gsrs,
      legs: legs.length, settledLegs: settled, wins, losses, pnl: Math.round(pnl), margin, cashNeeded: week.cashNeeded, credit,
      romPct: margin > 0 ? +((pnl / margin) * 100).toFixed(2) : null,
      worstLeg, complete: settled === legs.length && settled > 0,
    });
  }
  weeks.sort((a, b) => a.weekOf.localeCompare(b.weekOf));

  const completeWeeks = weeks.filter((w) => w.complete);
  let running = 0, peak = 0, maxDrawdown = 0;
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
  const allWorst = completeWeeks.map((w) => w.worstLeg).filter((l): l is SettledLeg => l != null).sort((a, b) => a.pnl - b.pnl);
  const sum = (list: WeeklyPerformance[]) => list.reduce((a, w) => a + w.pnl, 0);

  const stats: PerformanceStats = {
    totalPnl: Math.round(sum(completeWeeks)),
    completeWeeks: completeWeeks.length,
    winningWeeks: winningWeeks.length,
    losingWeeks: losingWeeks.length,
    avgWeeklyPnl: completeWeeks.length ? Math.round(sum(completeWeeks) / completeWeeks.length) : 0,
    avgWinningWeek: winningWeeks.length ? Math.round(sum(winningWeeks) / winningWeeks.length) : 0,
    avgLosingWeek: losingWeeks.length ? Math.round(sum(losingWeeks) / losingWeeks.length) : 0,
    bestWeek: completeWeeks.length ? Math.max(...completeWeeks.map((w) => w.pnl)) : 0,
    worstWeek: completeWeeks.length ? Math.min(...completeWeeks.map((w) => w.pnl)) : 0,
    legWinRatePct: totalLegs ? +((totalWins / totalLegs) * 100).toFixed(1) : 0,
    settledLegs: totalLegs,
    maxDrawdown: Math.round(maxDrawdown),
    worstLeg: allWorst[0] ?? null,
  };

  return { weeks, cumulative, stats, basis };
}
