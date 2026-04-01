export type UserRole = "admin" | "member";
export type UserStatus = "active" | "inactive";
export type BasketStatus = "draft" | "published" | "archived";
export type PositionSide = "call" | "put";
export type PerformanceConfidence = "Actual" | "Estimated" | "Expiry-Resolved";
export type PositionState =
  | "safe"
  | "approaching-strike"
  | "breached"
  | "expired-otm"
  | "expired-itm"
  | "manually-closed";

export interface MetricItem {
  label: string;
  value: string;
  hint?: string;
}

export interface MarketConditionsData {
  gsrsNote: string;
  vix: number;
  skew: number;
  hyOas: number;
  move: number;
  putCallRatio: number;
  acquisitionRadarStatus: string;
  downsideGapRadarStatus: string;
  narrative: string;
}

export interface BasketRuleData {
  id: string;
  category: "hard-stop" | "profit-target" | "protocol" | "note";
  title: string;
  body: string;
}

export interface BrokerOrderBlockData {
  id: string;
  broker: "IBKR" | "Schwab";
  side: "call" | "put" | "mixed";
  title: string;
  orderText: string;
}

export interface PositionAlertData {
  id: string;
  positionId?: string;
  ticker: string;
  side: PositionSide;
  label: string;
  thresholdValue: number;
  protocolNote: string;
}

export interface PerformanceSnapshotData {
  id: string;
  observedAt: string;
  underlyingPrice: number;
  optionMark?: number | null;
  estimatedOptionValue?: number | null;
  impliedVolatility?: number | null;
  confidence: PerformanceConfidence;
  state: PositionState;
  underlyingMovePct: number;
  distanceToStrike: number;
  safetyBufferPct: number;
  daysToExpiry: number;
  creditCapturePct: number;
  pnlAmount: number;
  pnlPercent: number;
  sourceLabel: string;
}

export interface PositionData {
  id: string;
  basketId: string;
  side: PositionSide;
  ticker: string;
  companyName?: string;
  sector?: string;
  entryUnderlyingPrice: number;
  ivRank: number;
  shortInterestPctFloat: number;
  fanScore: number;
  glassdoorScore: number;
  buybackScore: number;
  strike: number;
  optionType: "call" | "put";
  expiry: string;
  delta: number;
  estimatedEntryCredit: number;
  contracts: number;
  margin: number;
  breakAlert1?: number | null;
  breakAlert2?: number | null;
  atr14d?: number | null;
  buffer?: string | null;
  probabilityOfTouch?: number | null;
  thesisSummary: string;
  thesisBullets: string[];
  cautionFlags: string[];
  entryTimestamp: string;
  notes?: string | null;
  manualClosePrice?: number | null;
  manualCloseDate?: string | null;
  actualExitCredit?: number | null;
  latestPerformance: PerformanceSnapshotData;
  performanceHistory: PerformanceSnapshotData[];
}

export interface BasketSummaryMetrics {
  totalNames: number;
  callCount: number;
  putCount: number;
  totalMargin: number;
  cashNeeded: number;
  totalEstimatedCredit: number;
  dailyTheta: number;
  concentrationNote: string;
  gsrsConstraintNote: string;
}

export interface BasketData {
  id: string;
  title: string;
  slug: string;
  weekOf: string;
  publicationDate: string;
  status: BasketStatus;
  gsrs: number;
  radarStatus: string;
  cashNeeded: number;
  disclaimer: string;
  quickSummary: MetricItem[];
  marketConditions: MarketConditionsData;
  callPositions: PositionData[];
  putPositions: PositionData[];
  meanReversionBuffer: MetricItem[];
  portfolioSummary: BasketSummaryMetrics;
  orderBlocks: BrokerOrderBlockData[];
  priceAlerts: PositionAlertData[];
  hardStops: BasketRuleData[];
  profitTargets: BasketRuleData[];
  freeformNotes: string[];
  adminOnlyNotes?: string[];
  lastRefreshAt: string;
}

export interface DashboardData {
  currentBasket: BasketData;
  livePositions: PositionData[];
  warningPositions: PositionData[];
  latestRefreshAt: string;
}

export interface AnalyticsSummary {
  basketsTracked: number;
  livePositions: number;
  resolvedPositions: number;
  averageCreditCapturePct: number;
  estimatedPnl: number;
  statusCounts: Array<{ state: PositionState; count: number }>;
}

export interface PositionDetailData extends PositionData {
  basketTitle: string;
  basketSlug: string;
  basketStatus: BasketStatus;
  marketConditions: MarketConditionsData;
}

export interface AppUserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  acknowledgedRiskAt?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
}

export interface AdminUserRecord extends AppUserProfile {
  identityConfirmedAt?: string | null;
}

export interface SyncJobRecord {
  id: string;
  jobType: string;
  status: "running" | "success" | "error";
  startedAt: string;
  completedAt?: string | null;
  positionsProcessed: number;
  errorsCount: number;
  notes?: string | null;
}
