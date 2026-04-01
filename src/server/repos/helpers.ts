import type {
  BrokerOrderBlockData,
  MarketConditionsData,
  PerformanceSnapshotData,
  PositionAlertData,
  PositionData,
} from "@/lib/types";

export function asNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }
  return typeof value === "number" ? value : Number(value);
}

export function asNullableNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "number" ? value : Number(value);
}

export function asIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return new Date().toISOString();
  }
  return value instanceof Date ? value.toISOString() : value;
}

export function normalizeMarketConditions(row: {
  gsrsNote: string;
  vix: string | number;
  skew: string | number;
  hyOas: string | number;
  move: string | number;
  putCallRatio: string | number;
  acquisitionRadarStatus: string;
  downsideGapRadarStatus: string;
  narrative: string;
}): MarketConditionsData {
  return {
    gsrsNote: row.gsrsNote,
    vix: asNumber(row.vix),
    skew: asNumber(row.skew),
    hyOas: asNumber(row.hyOas),
    move: asNumber(row.move),
    putCallRatio: asNumber(row.putCallRatio),
    acquisitionRadarStatus: row.acquisitionRadarStatus,
    downsideGapRadarStatus: row.downsideGapRadarStatus,
    narrative: row.narrative,
  };
}

export function normalizeOrderBlock(row: {
  id: string;
  broker: string;
  side: string;
  title: string;
  orderText: string;
}): BrokerOrderBlockData {
  return {
    id: row.id,
    broker: row.broker as BrokerOrderBlockData["broker"],
    side: row.side as BrokerOrderBlockData["side"],
    title: row.title,
    orderText: row.orderText,
  };
}

export function normalizeAlert(row: {
  id: string;
  positionId: string | null;
  ticker: string;
  side: "call" | "put";
  label: string;
  thresholdValue: string | number;
  protocolNote: string;
}): PositionAlertData {
  return {
    id: row.id,
    positionId: row.positionId ?? undefined,
    ticker: row.ticker,
    side: row.side,
    label: row.label,
    thresholdValue: asNumber(row.thresholdValue),
    protocolNote: row.protocolNote,
  };
}

export function normalizeSnapshot(row: {
  id: string;
  observedAt: Date | string;
  underlyingPrice: string | number;
  optionMark: string | number | null;
  estimatedOptionValue: string | number | null;
  impliedVolatility: string | number | null;
  confidence: PerformanceSnapshotData["confidence"];
  state: PerformanceSnapshotData["state"];
  underlyingMovePct: string | number;
  distanceToStrike: string | number;
  safetyBufferPct: string | number;
  daysToExpiry: number;
  creditCapturePct: string | number;
  pnlAmount: string | number;
  pnlPercent: string | number;
  sourceLabel: string;
}): PerformanceSnapshotData {
  return {
    id: row.id,
    observedAt: asIsoString(row.observedAt),
    underlyingPrice: asNumber(row.underlyingPrice),
    optionMark: asNullableNumber(row.optionMark),
    estimatedOptionValue: asNullableNumber(row.estimatedOptionValue),
    impliedVolatility: asNullableNumber(row.impliedVolatility),
    confidence: row.confidence,
    state: row.state,
    underlyingMovePct: asNumber(row.underlyingMovePct),
    distanceToStrike: asNumber(row.distanceToStrike),
    safetyBufferPct: asNumber(row.safetyBufferPct),
    daysToExpiry: row.daysToExpiry,
    creditCapturePct: asNumber(row.creditCapturePct),
    pnlAmount: asNumber(row.pnlAmount),
    pnlPercent: asNumber(row.pnlPercent),
    sourceLabel: row.sourceLabel,
  };
}

export function normalizePosition(row: {
  id: string;
  basketId: string;
  side: "call" | "put";
  ticker: string;
  companyName: string | null;
  sector: string | null;
  entryUnderlyingPrice: string | number;
  ivRank: string | number;
  shortInterestPctFloat: string | number;
  fanScore: string | number;
  glassdoorScore: string | number;
  buybackScore: number;
  strike: string | number;
  optionType: "call" | "put";
  expiry: string | Date;
  delta: string | number;
  estimatedEntryCredit: string | number;
  contracts: number;
  margin: number;
  breakAlert1: string | number | null;
  breakAlert2: string | number | null;
  atr14d: string | number | null;
  buffer: string | null;
  probabilityOfTouch: string | number | null;
  thesisSummary: string;
  thesisBullets: string[];
  cautionFlags: string[];
  entryTimestamp: Date | string;
  notes: string | null;
  manualClosePrice: string | number | null;
  manualCloseDate: string | Date | null;
  actualExitCredit: string | number | null;
  latestPerformance: PerformanceSnapshotData;
  performanceHistory: PerformanceSnapshotData[];
}): PositionData {
  return {
    id: row.id,
    basketId: row.basketId,
    side: row.side,
    ticker: row.ticker,
    companyName: row.companyName ?? undefined,
    sector: row.sector ?? undefined,
    entryUnderlyingPrice: asNumber(row.entryUnderlyingPrice),
    ivRank: asNumber(row.ivRank),
    shortInterestPctFloat: asNumber(row.shortInterestPctFloat),
    fanScore: asNumber(row.fanScore),
    glassdoorScore: asNumber(row.glassdoorScore),
    buybackScore: row.buybackScore,
    strike: asNumber(row.strike),
    optionType: row.optionType,
    expiry: asIsoString(row.expiry).slice(0, 10),
    delta: asNumber(row.delta),
    estimatedEntryCredit: asNumber(row.estimatedEntryCredit),
    contracts: row.contracts,
    margin: row.margin,
    breakAlert1: asNullableNumber(row.breakAlert1),
    breakAlert2: asNullableNumber(row.breakAlert2),
    atr14d: asNullableNumber(row.atr14d),
    buffer: row.buffer ?? undefined,
    probabilityOfTouch: asNullableNumber(row.probabilityOfTouch),
    thesisSummary: row.thesisSummary,
    thesisBullets: row.thesisBullets ?? [],
    cautionFlags: row.cautionFlags ?? [],
    entryTimestamp: asIsoString(row.entryTimestamp),
    notes: row.notes ?? undefined,
    manualClosePrice: asNullableNumber(row.manualClosePrice),
    manualCloseDate: row.manualCloseDate
      ? asIsoString(row.manualCloseDate).slice(0, 10)
      : undefined,
    actualExitCredit: asNullableNumber(row.actualExitCredit),
    latestPerformance: row.latestPerformance,
    performanceHistory: row.performanceHistory,
  };
}
