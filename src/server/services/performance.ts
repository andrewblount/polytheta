import { differenceInCalendarDays } from "date-fns";

import { clamp } from "@/lib/utils";
import type {
  PerformanceConfidence,
  PerformanceSnapshotData,
  PositionData,
  PositionState,
} from "@/lib/types";

import type { MarketDataProvider } from "@/server/market/provider";

function normalCdf(x: number) {
  const sign = x >= 0 ? 1 : -1;
  const absolute = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * absolute);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf =
    sign *
    (1 -
      ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
        t *
        Math.exp(-absolute * absolute));
  return (1 + erf) / 2;
}

function blackScholesValue({
  spot,
  strike,
  timeToExpiryYears,
  volatility,
  rate,
  optionType,
}: {
  spot: number;
  strike: number;
  timeToExpiryYears: number;
  volatility: number;
  rate: number;
  optionType: "call" | "put";
}) {
  if (timeToExpiryYears <= 0) {
    return optionType === "call"
      ? Math.max(spot - strike, 0)
      : Math.max(strike - spot, 0);
  }

  const sigmaSqrtT = volatility * Math.sqrt(timeToExpiryYears);
  if (sigmaSqrtT <= 0) {
    return optionType === "call"
      ? Math.max(spot - strike, 0)
      : Math.max(strike - spot, 0);
  }

  const d1 =
    (Math.log(spot / strike) + (rate + (volatility ** 2) / 2) * timeToExpiryYears) /
    sigmaSqrtT;
  const d2 = d1 - sigmaSqrtT;

  if (optionType === "call") {
    return spot * normalCdf(d1) - strike * Math.exp(-rate * timeToExpiryYears) * normalCdf(d2);
  }

  return (
    strike * Math.exp(-rate * timeToExpiryYears) * normalCdf(-d2) -
    spot * normalCdf(-d1)
  );
}

export function getPositionState(
  position: Pick<
    PositionData,
    "side" | "strike" | "breakAlert1" | "expiry" | "manualCloseDate"
  >,
  underlyingPrice: number,
  observedAt: string,
): PositionState {
  const expiry = new Date(position.expiry);
  const observedDate = new Date(observedAt);

  if (position.manualCloseDate) {
    return "manually-closed";
  }

  if (observedDate >= expiry) {
    if (position.side === "call") {
      return underlyingPrice < position.strike ? "expired-otm" : "expired-itm";
    }
    return underlyingPrice > position.strike ? "expired-otm" : "expired-itm";
  }

  if (position.side === "call") {
    if (underlyingPrice >= position.strike) {
      return "breached";
    }
    if (position.breakAlert1 && underlyingPrice >= position.breakAlert1) {
      return "approaching-strike";
    }
    return "safe";
  }

  if (underlyingPrice <= position.strike) {
    return "breached";
  }
  if (position.breakAlert1 && underlyingPrice <= position.breakAlert1) {
    return "approaching-strike";
  }
  return "safe";
}

export function buildSnapshot({
  position,
  observedAt,
  underlyingPrice,
  optionMark,
  estimatedOptionValue,
  impliedVolatility,
  confidence,
  sourceLabel,
}: {
  position: PositionData;
  observedAt: string;
  underlyingPrice: number;
  optionMark?: number | null;
  estimatedOptionValue?: number | null;
  impliedVolatility?: number | null;
  confidence: PerformanceConfidence;
  sourceLabel: string;
}): PerformanceSnapshotData {
  const state = getPositionState(position, underlyingPrice, observedAt);
  const currentValue = optionMark ?? estimatedOptionValue ?? position.estimatedEntryCredit;
  const creditCapturePct = clamp(
    (position.estimatedEntryCredit - currentValue) / position.estimatedEntryCredit,
    -2,
    1,
  );
  const pnlAmount =
    (position.estimatedEntryCredit - currentValue) * 100 * position.contracts;
  const pnlPercent = pnlAmount / Math.max(position.margin, 1);
  const distanceToStrike =
    position.side === "call"
      ? position.strike - underlyingPrice
      : underlyingPrice - position.strike;
  const safetyBufferPct = distanceToStrike / underlyingPrice;

  return {
    id: `${position.id}-${observedAt}`,
    observedAt,
    underlyingPrice,
    optionMark,
    estimatedOptionValue,
    impliedVolatility,
    confidence,
    state,
    underlyingMovePct:
      (underlyingPrice - position.entryUnderlyingPrice) / position.entryUnderlyingPrice,
    distanceToStrike,
    safetyBufferPct,
    daysToExpiry: differenceInCalendarDays(new Date(position.expiry), new Date(observedAt)),
    creditCapturePct,
    pnlAmount,
    pnlPercent,
    sourceLabel,
  };
}

export async function generateLiveSnapshot(
  position: PositionData,
  provider: MarketDataProvider,
  observedAt = new Date().toISOString(),
) {
  const quote = await provider.getQuote(position.ticker);
  const underlyingPrice = quote?.regularMarketPrice ?? position.entryUnderlyingPrice;
  const optionQuote = await provider.getOptionQuote(
    position.ticker,
    position.expiry,
    position.strike,
    position.optionType,
  );

  const actualMark =
    optionQuote?.lastPrice ??
    (optionQuote?.bid && optionQuote?.ask
      ? (optionQuote.bid + optionQuote.ask) / 2
      : null);

  if (actualMark !== null && actualMark !== undefined) {
    return buildSnapshot({
      position,
      observedAt,
      underlyingPrice,
      optionMark: actualMark,
      impliedVolatility: optionQuote?.impliedVolatility ?? null,
      confidence: "Actual",
      sourceLabel: "Yahoo option quote",
    });
  }

  const daysToExpiry = Math.max(
    differenceInCalendarDays(new Date(position.expiry), new Date(observedAt)),
    0,
  );
  const timeToExpiryYears = Math.max(daysToExpiry / 365, 1 / 365);
  const volatility =
    optionQuote?.impliedVolatility ??
    clamp(0.22 + (position.ivRank / 100) * 0.7, 0.2, 1.1);
  const estimatedOptionValue = blackScholesValue({
    spot: underlyingPrice,
    strike: position.strike,
    timeToExpiryYears,
    volatility,
    rate: 0.045,
    optionType: position.optionType,
  });

  return buildSnapshot({
    position,
    observedAt,
    underlyingPrice,
    estimatedOptionValue,
    impliedVolatility: volatility,
    confidence: daysToExpiry === 0 ? "Expiry-Resolved" : "Estimated",
    sourceLabel: "Modeled from Yahoo chain IV proxy",
  });
}
