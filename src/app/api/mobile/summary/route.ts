import type { PositionData } from "@/lib/types";
import { getCurrentBasket } from "@/server/repos/baskets";

import { mobileAuthOk, unauthorized } from "../auth";

export const dynamic = "force-dynamic";

function leanPosition(p: PositionData) {
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
    cautionFlags: p.cautionFlags,
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
  };
}

export async function GET(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();

  const basket = await getCurrentBasket();
  if (!basket) {
    return Response.json({ basket: null });
  }

  return Response.json({
    basket: {
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
    },
  });
}
