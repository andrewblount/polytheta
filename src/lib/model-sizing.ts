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
  // Underlying at settlement (expiry close, or the exit price on a model exit).
  expiryPrice: number | null;
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
  entryPrice: number;
  expiryPrice: number | null;
  // % the underlying had to move to reach the strike at entry.
  cushionPct: number;
}

export interface SidePerformance {
  legs: number;
  wins: number;
  pnl: number;
  credit: number;
  winRatePct: number;
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
  settled: SettledLeg[];
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
  // Gross wins ÷ gross losses across settled weeks (∞ when nothing lost → null).
  profitFactor: number | null;
  // Mean settled-leg P&L.
  expectancyPerLeg: number;
  // P&L as a share of credit collected on settled legs (100 = kept every dollar).
  creditCapturePct: number | null;
  // P&L over the margin those legs tied up.
  returnOnMarginPct: number | null;
  // Weekly mean ÷ weekly standard deviation, annualised (√52); null under 3 weeks.
  sharpe: number | null;
  longestLosingStreak: number;
  currentStreak: number; // +n winning weeks in a row, −n losing
  avgCushionPct: number | null; // mean entry cushion, all settled legs
  avgCushionWinnersPct: number | null;
  avgCushionLosersPct: number | null;
  calls: SidePerformance;
  puts: SidePerformance;
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
    const settledLegs: SettledLeg[] = [];
    for (const leg of legs) {
      const sized = perTrade != null ? resizeLeg(leg, perTrade) : leg;
      margin += sized.margin;
      credit += sized.credit;
      if (sized.pnl == null || leg.state == null || leg.settledAt == null) continue;
      settled += 1;
      pnl += sized.pnl;
      if (sized.pnl >= 0) wins += 1;
      else losses += 1;
      const cushion = leg.side === "call" ? leg.strike - leg.entryPrice : leg.entryPrice - leg.strike;
      const settledLeg: SettledLeg = {
        positionId: leg.positionId, ticker: leg.ticker, side: leg.side, strike: leg.strike, entryCredit: leg.entryCredit,
        contracts: sized.contracts, margin: sized.margin, pnl: Math.round(sized.pnl), state: leg.state, settledAt: leg.settledAt,
        entryPrice: leg.entryPrice, expiryPrice: leg.expiryPrice ?? null,
        cushionPct: leg.entryPrice > 0 ? +((cushion / leg.entryPrice) * 100).toFixed(2) : 0,
      };
      settledLegs.push(settledLeg);
      if (!worstLeg || settledLeg.pnl < worstLeg.pnl) worstLeg = settledLeg;
    }

    weeks.push({
      weekOf: week.weekOf, slug: week.slug, title: week.title, gsrs: week.gsrs,
      legs: legs.length, settledLegs: settled, wins, losses, pnl: Math.round(pnl), margin, cashNeeded: week.cashNeeded, credit,
      romPct: margin > 0 ? +((pnl / margin) * 100).toFixed(2) : null,
      worstLeg, complete: settled === legs.length && settled > 0, settled: settledLegs,
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

  // Leg-level statistics across settled weeks.
  const allLegs = completeWeeks.flatMap((w) => w.settled);
  const grossWins = sum(winningWeeks), grossLosses = -sum(losingWeeks);
  const legCredit = allLegs.reduce((a, l) => a + l.entryCredit * 100 * l.contracts, 0);
  const legMargin = allLegs.reduce((a, l) => a + l.margin, 0);
  const legPnl = allLegs.reduce((a, l) => a + l.pnl, 0);
  const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const weeklyPnls = completeWeeks.map((w) => w.pnl);
  const weeklyMean = mean(weeklyPnls) ?? 0;
  const weeklySd = weeklyPnls.length >= 3 ? Math.sqrt(weeklyPnls.reduce((a, p) => a + (p - weeklyMean) ** 2, 0) / (weeklyPnls.length - 1)) : 0;
  let longestLosing = 0, run = 0;
  for (const w of completeWeeks) { run = w.pnl < 0 ? run + 1 : 0; longestLosing = Math.max(longestLosing, run); }
  let currentStreak = 0;
  for (let i = completeWeeks.length - 1; i >= 0; i--) {
    const sign = completeWeeks[i].pnl >= 0 ? 1 : -1;
    if (currentStreak === 0) currentStreak = sign;
    else if (Math.sign(currentStreak) === sign) currentStreak += sign;
    else break;
  }
  const side = (s: "call" | "put"): SidePerformance => {
    const legs = allLegs.filter((l) => l.side === s);
    const wins = legs.filter((l) => l.pnl >= 0).length;
    return { legs: legs.length, wins, pnl: Math.round(legs.reduce((a, l) => a + l.pnl, 0)), credit: Math.round(legs.reduce((a, l) => a + l.entryCredit * 100 * l.contracts, 0)), winRatePct: legs.length ? +((wins / legs.length) * 100).toFixed(1) : 0 };
  };
  const round1 = (n: number | null) => (n == null ? null : +n.toFixed(1));

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
    profitFactor: grossLosses > 0 ? +(grossWins / grossLosses).toFixed(2) : null,
    expectancyPerLeg: allLegs.length ? Math.round(legPnl / allLegs.length) : 0,
    creditCapturePct: legCredit > 0 ? +((legPnl / legCredit) * 100).toFixed(1) : null,
    returnOnMarginPct: legMargin > 0 ? +((legPnl / legMargin) * 100).toFixed(2) : null,
    sharpe: weeklySd > 0 ? +((weeklyMean / weeklySd) * Math.sqrt(52)).toFixed(2) : null,
    longestLosingStreak: longestLosing,
    currentStreak,
    avgCushionPct: round1(mean(allLegs.map((l) => l.cushionPct))),
    avgCushionWinnersPct: round1(mean(allLegs.filter((l) => l.pnl >= 0).map((l) => l.cushionPct))),
    avgCushionLosersPct: round1(mean(allLegs.filter((l) => l.pnl < 0).map((l) => l.cushionPct))),
    calls: side("call"),
    puts: side("put"),
  };

  return { weeks, cumulative, stats, basis };
}
