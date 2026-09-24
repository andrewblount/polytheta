import type { BasketData, PositionData, TradeRecord } from "@/lib/types";

// Shared serializers for the mobile API so the current basket and any
// historical basket return an identical shape — the apps use one decoder.

export function leanPosition(p: PositionData) {
  return {
    id: p.id,
    ticker: p.ticker,
    side: p.side,
    strike: p.strike,
    expiry: p.expiry,
    entryPrice: p.entryUnderlyingPrice,
    entryCredit: p.estimatedEntryCredit,
    contracts: p.contracts,
    margin: p.margin,
    delta: p.delta,
    buffer: p.buffer ?? null,
    shortInterestPctFloat: p.shortInterestPctFloat,
    thesisSummary: p.thesisSummary,
    thesisBullets: p.thesisBullets,
    cautionFlags: p.cautionFlags,
    signals: {
      ivRank: p.ivRank,
      shortInterestPctFloat: p.shortInterestPctFloat,
      fanScore: p.fanScore,
      glassdoorScore: p.glassdoorScore,
      buybackScore: p.buybackScore,
    },
    latest: p.latestPerformance
      ? {
          observedAt: p.latestPerformance.observedAt,
          state: p.latestPerformance.state,
          underlyingPrice: p.latestPerformance.underlyingPrice,
          pnlAmount: p.latestPerformance.pnlAmount,
          creditCapturePct: p.latestPerformance.creditCapturePct,
          daysToExpiry: p.latestPerformance.daysToExpiry,
          distanceToStrike: p.latestPerformance.distanceToStrike,
        }
      : null,
    stopBreach:
      p.latestPerformance != null &&
      p.margin > 0 &&
      p.latestPerformance.pnlAmount <= -0.25 * p.margin,
    // Settlement: the underlying price the leg settled at (expiry close, or the
    // exit price on a model exit) and the resulting outcome.
    settled: p.latestPerformance && SETTLED.has(p.latestPerformance.state)
      ? { state: p.latestPerformance.state, underlyingPrice: p.latestPerformance.underlyingPrice, observedAt: p.latestPerformance.observedAt, pnlAmount: p.latestPerformance.pnlAmount, exitDate: p.manualCloseDate ?? null }
      : null,
    breakeven: p.side === "call" ? +(p.strike + p.estimatedEntryCredit).toFixed(2) : +(p.strike - p.estimatedEntryCredit).toFixed(2),
    atr: p.atr14d ?? null,
  };
}

const SETTLED = new Set(["expired-otm", "expired-itm", "manually-closed"]);

export function leanBasket(basket: BasketData) {
  return {
    slug: basket.slug,
    title: basket.title,
    weekOf: basket.weekOf,
    status: basket.status,
    gsrs: basket.gsrs,
    radarStatus: basket.radarStatus,
    lastRefreshAt: basket.lastRefreshAt,
    market: {
      vix: basket.marketConditions.vix,
      skew: basket.marketConditions.skew,
      hyOas: basket.marketConditions.hyOas,
      move: basket.marketConditions.move,
      putCallRatio: basket.marketConditions.putCallRatio,
      gsrsNote: basket.marketConditions.gsrsNote,
    },
    metrics: {
      totalMargin: basket.portfolioSummary.totalMargin,
      cashNeeded: basket.portfolioSummary.cashNeeded,
      totalEstimatedCredit: basket.portfolioSummary.totalEstimatedCredit,
      dailyTheta: basket.portfolioSummary.dailyTheta,
      gsrsConstraintNote: basket.portfolioSummary.gsrsConstraintNote,
    },
    calls: basket.callPositions.map(leanPosition),
    puts: basket.putPositions.map(leanPosition),
    // The trading thesis and the model provenance travel with every basket so
    // the archive drill-down can show why the model chose what it chose.
    thesis: basket.thesis,
    model: basket.model,
    notes: basket.freeformNotes,
  };
}

export function leanTrade(t: TradeRecord) {
  return {
    id: t.id,
    positionId: t.positionId,
    ticker: t.ticker,
    side: t.side,
    action: t.action,
    strike: t.strike,
    expiry: t.expiry,
    quantity: t.quantity,
    price: t.price,
    fees: t.fees,
    broker: t.broker,
    executedAt: t.executedAt,
    notes: t.notes,
  };
}
