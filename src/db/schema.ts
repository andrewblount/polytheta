import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  date,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "member"]);
export const userStatusEnum = pgEnum("user_status", ["active", "inactive"]);
export const basketStatusEnum = pgEnum("basket_status", [
  "draft",
  "published",
  "archived",
]);
export const positionSideEnum = pgEnum("position_side", ["call", "put"]);
export const ruleCategoryEnum = pgEnum("rule_category", [
  "hard-stop",
  "profit-target",
  "protocol",
  "note",
]);
export const performanceConfidenceEnum = pgEnum("performance_confidence", [
  "Actual",
  "Estimated",
  "Expiry-Resolved",
]);
export const positionStateEnum = pgEnum("position_state", [
  "safe",
  "approaching-strike",
  "breached",
  "expired-otm",
  "expired-itm",
  "manually-closed",
]);
export const syncStatusEnum = pgEnum("sync_status", [
  "running",
  "success",
  "error",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const userProfiles = pgTable("user_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  identityUserId: text("identity_user_id").notNull().unique(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  role: userRoleEnum("role").default("member").notNull(),
  status: userStatusEnum("status").default("active").notNull(),
  acknowledgedRiskAt: timestamp("acknowledged_risk_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

export const baskets = pgTable(
  "baskets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    slug: varchar("slug", { length: 180 }).notNull(),
    weekOf: date("week_of").notNull(),
    publicationDate: timestamp("publication_date", { withTimezone: true }),
    status: basketStatusEnum("status").default("draft").notNull(),
    gsrs: numeric("gsrs", { precision: 5, scale: 2 }).notNull(),
    radarStatus: text("radar_status").notNull(),
    cashNeeded: integer("cash_needed").notNull(),
    disclaimer: text("disclaimer").notNull(),
    quickSummary: jsonb("quick_summary").$type<Record<string, unknown>[]>(),
    commentary: text("commentary"),
    adminNotes: text("admin_notes"),
    createdByIdentityUserId: text("created_by_identity_user_id"),
    publishedByIdentityUserId: text("published_by_identity_user_id"),
    lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    slugIdx: uniqueIndex("baskets_slug_idx").on(table.slug),
  }),
);

export const marketConditions = pgTable("market_conditions", {
  id: uuid("id").defaultRandom().primaryKey(),
  basketId: uuid("basket_id")
    .notNull()
    .references(() => baskets.id, { onDelete: "cascade" })
    .unique(),
  gsrsNote: text("gsrs_note").notNull(),
  vix: numeric("vix", { precision: 8, scale: 2 }).notNull(),
  skew: numeric("skew", { precision: 8, scale: 2 }).notNull(),
  hyOas: numeric("hy_oas", { precision: 8, scale: 2 }).notNull(),
  move: numeric("move", { precision: 8, scale: 2 }).notNull(),
  putCallRatio: numeric("put_call_ratio", { precision: 8, scale: 2 }).notNull(),
  acquisitionRadarStatus: text("acquisition_radar_status").notNull(),
  downsideGapRadarStatus: text("downside_gap_radar_status").notNull(),
  narrative: text("narrative").notNull(),
  ...timestamps,
});

export const positions = pgTable("positions", {
  id: uuid("id").defaultRandom().primaryKey(),
  basketId: uuid("basket_id")
    .notNull()
    .references(() => baskets.id, { onDelete: "cascade" }),
  side: positionSideEnum("side").notNull(),
  ticker: varchar("ticker", { length: 16 }).notNull(),
  companyName: text("company_name"),
  sector: text("sector"),
  entryUnderlyingPrice: numeric("entry_underlying_price", {
    precision: 10,
    scale: 2,
  }).notNull(),
  ivRank: numeric("iv_rank", { precision: 8, scale: 2 }).notNull(),
  shortInterestPctFloat: numeric("short_interest_pct_float", {
    precision: 8,
    scale: 2,
  }).notNull(),
  fanScore: numeric("fan_score", { precision: 8, scale: 2 }).notNull(),
  glassdoorScore: numeric("glassdoor_score", {
    precision: 8,
    scale: 2,
  }).notNull(),
  buybackScore: integer("buyback_score").notNull(),
  strike: numeric("strike", { precision: 10, scale: 2 }).notNull(),
  optionType: positionSideEnum("option_type").notNull(),
  expiry: date("expiry").notNull(),
  delta: numeric("delta", { precision: 8, scale: 4 }).notNull(),
  estimatedEntryCredit: numeric("estimated_entry_credit", {
    precision: 10,
    scale: 2,
  }).notNull(),
  contracts: integer("contracts").notNull(),
  margin: integer("margin").notNull(),
  breakAlert1: numeric("break_alert_1", { precision: 10, scale: 2 }),
  breakAlert2: numeric("break_alert_2", { precision: 10, scale: 2 }),
  atr14d: numeric("atr_14d", { precision: 10, scale: 2 }),
  buffer: text("buffer"),
  probabilityOfTouch: numeric("probability_of_touch", {
    precision: 8,
    scale: 2,
  }),
  thesisSummary: text("thesis_summary").notNull(),
  thesisBullets: jsonb("thesis_bullets").$type<string[]>().default([]).notNull(),
  cautionFlags: jsonb("caution_flags").$type<string[]>().default([]).notNull(),
  entryTimestamp: timestamp("entry_timestamp", { withTimezone: true }).notNull(),
  notes: text("notes"),
  manualClosePrice: numeric("manual_close_price", { precision: 10, scale: 2 }),
  manualCloseDate: date("manual_close_date"),
  actualExitCredit: numeric("actual_exit_credit", { precision: 10, scale: 2 }),
  sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown>>(),
  sortOrder: integer("sort_order").default(0).notNull(),
  ...timestamps,
});

export const thesisSignals = pgTable("thesis_signals", {
  id: uuid("id").defaultRandom().primaryKey(),
  basketId: uuid("basket_id")
    .notNull()
    .references(() => baskets.id, { onDelete: "cascade" }),
  positionId: uuid("position_id").references(() => positions.id, {
    onDelete: "cascade",
  }),
  ticker: varchar("ticker", { length: 16 }).notNull(),
  side: positionSideEnum("side").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  weight: numeric("weight", { precision: 6, scale: 2 }),
  isPassing: boolean("is_passing").default(true).notNull(),
  ...timestamps,
});

export const basketMetrics = pgTable("basket_metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  basketId: uuid("basket_id")
    .notNull()
    .references(() => baskets.id, { onDelete: "cascade" })
    .unique(),
  totalNames: integer("total_names").notNull(),
  callCount: integer("call_count").notNull(),
  putCount: integer("put_count").notNull(),
  totalMargin: integer("total_margin").notNull(),
  cashNeeded: integer("cash_needed").notNull(),
  totalEstimatedCredit: integer("total_estimated_credit").notNull(),
  dailyTheta: integer("daily_theta").notNull(),
  concentrationNote: text("concentration_note").notNull(),
  gsrsConstraintNote: text("gsrs_constraint_note").notNull(),
  otherMetrics: jsonb("other_metrics").$type<Record<string, unknown>>(),
  ...timestamps,
});

export const brokerOrderBlocks = pgTable("broker_order_blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  basketId: uuid("basket_id")
    .notNull()
    .references(() => baskets.id, { onDelete: "cascade" }),
  broker: varchar("broker", { length: 32 }).notNull(),
  side: varchar("side", { length: 16 }).notNull(),
  title: text("title").notNull(),
  orderText: text("order_text").notNull(),
  ...timestamps,
});

export const positionAlerts = pgTable("position_alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  basketId: uuid("basket_id")
    .notNull()
    .references(() => baskets.id, { onDelete: "cascade" }),
  positionId: uuid("position_id").references(() => positions.id, {
    onDelete: "cascade",
  }),
  ticker: varchar("ticker", { length: 16 }).notNull(),
  side: positionSideEnum("side").notNull(),
  label: text("label").notNull(),
  thresholdValue: numeric("threshold_value", { precision: 10, scale: 2 })
    .notNull(),
  protocolNote: text("protocol_note").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  ...timestamps,
});

export const basketRules = pgTable("basket_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  basketId: uuid("basket_id")
    .notNull()
    .references(() => baskets.id, { onDelete: "cascade" }),
  category: ruleCategoryEnum("category").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  ...timestamps,
});

export const performanceSnapshots = pgTable(
  "performance_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    basketId: uuid("basket_id")
      .notNull()
      .references(() => baskets.id, { onDelete: "cascade" }),
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "cascade" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    underlyingPrice: numeric("underlying_price", {
      precision: 10,
      scale: 2,
    }).notNull(),
    optionMark: numeric("option_mark", { precision: 10, scale: 2 }),
    estimatedOptionValue: numeric("estimated_option_value", {
      precision: 10,
      scale: 2,
    }),
    impliedVolatility: numeric("implied_volatility", {
      precision: 10,
      scale: 4,
    }),
    confidence: performanceConfidenceEnum("confidence").notNull(),
    state: positionStateEnum("state").notNull(),
    underlyingMovePct: numeric("underlying_move_pct", {
      precision: 10,
      scale: 4,
    }).notNull(),
    distanceToStrike: numeric("distance_to_strike", {
      precision: 10,
      scale: 4,
    }).notNull(),
    safetyBufferPct: numeric("safety_buffer_pct", {
      precision: 10,
      scale: 4,
    }).notNull(),
    daysToExpiry: integer("days_to_expiry").notNull(),
    creditCapturePct: numeric("credit_capture_pct", {
      precision: 10,
      scale: 4,
    }).notNull(),
    pnlAmount: numeric("pnl_amount", { precision: 14, scale: 2 }).notNull(),
    pnlPercent: numeric("pnl_percent", { precision: 10, scale: 4 }).notNull(),
    sourceLabel: text("source_label").notNull(),
    sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => ({
    positionObservedIdx: uniqueIndex("position_observed_idx").on(
      table.positionId,
      table.observedAt,
    ),
  }),
);

export const manualOverrides = pgTable("manual_overrides", {
  id: uuid("id").defaultRandom().primaryKey(),
  positionId: uuid("position_id")
    .notNull()
    .references(() => positions.id, { onDelete: "cascade" }),
  overrideType: varchar("override_type", { length: 40 }).notNull(),
  actualFillCredit: numeric("actual_fill_credit", { precision: 10, scale: 2 }),
  actualCloseValue: numeric("actual_close_value", { precision: 10, scale: 2 }),
  actualExitCredit: numeric("actual_exit_credit", { precision: 10, scale: 2 }),
  actualCloseDate: date("actual_close_date"),
  note: text("note"),
  createdByIdentityUserId: text("created_by_identity_user_id"),
  ...timestamps,
});

export const syncJobs = pgTable("sync_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobType: varchar("job_type", { length: 50 }).notNull(),
  status: syncStatusEnum("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  triggeredBy: text("triggered_by"),
  positionsProcessed: integer("positions_processed").default(0).notNull(),
  errorsCount: integer("errors_count").default(0).notNull(),
  notes: text("notes"),
  ...timestamps,
});

export const syncLogs = pgTable("sync_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").references(() => syncJobs.id, { onDelete: "cascade" }),
  level: varchar("level", { length: 20 }).notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ...timestamps,
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorIdentityUserId: text("actor_identity_user_id"),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  ...timestamps,
});

export const accessRequests = pgTable("access_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  message: text("message"),
  status: varchar("status", { length: 24 }).default("new").notNull(),
  ...timestamps,
});

export const schema = {
  accessRequests,
  auditLogs,
  basketMetrics,
  basketRules,
  baskets,
  brokerOrderBlocks,
  manualOverrides,
  marketConditions,
  performanceSnapshots,
  positionAlerts,
  positions,
  syncJobs,
  syncLogs,
  thesisSignals,
  userProfiles,
};

export type Schema = typeof schema;
