import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  accessRequests,
  basketMetrics,
  basketRules,
  baskets,
  brokerOrderBlocks,
  marketConditions,
  performanceSnapshots,
  positionAlerts,
  positions,
  syncJobs,
  userProfiles,
} from "@/db/schema";
import {
  demoAnalytics,
  demoBaskets,
  demoDashboard,
  demoSyncJobs,
  demoUsers,
} from "@/lib/demo-data";
import type {
  AccessRequestRecord,
  AdminUserRecord,
  AnalyticsSummary,
  BasketData,
  DashboardData,
  PositionDetailData,
  SyncJobRecord,
} from "@/lib/types";
import { uniqueBy } from "@/lib/utils";

import {
  normalizeAlert,
  normalizeMarketConditions,
  normalizeOrderBlock,
  normalizePosition,
  normalizeSnapshot,
  asIsoString,
  asNumber,
} from "./helpers";

async function getSnapshotsForPositionIds(positionIds: string[]) {
  if (!db || positionIds.length === 0) {
    return new Map<string, ReturnType<typeof normalizeSnapshot>[]>();
  }

  const rows = await db
    .select()
    .from(performanceSnapshots)
    .where(inArray(performanceSnapshots.positionId, positionIds))
    .orderBy(performanceSnapshots.observedAt);

  return rows.reduce((map, row) => {
    const list = map.get(row.positionId) ?? [];
    list.push(normalizeSnapshot(row));
    map.set(row.positionId, list);
    return map;
  }, new Map<string, ReturnType<typeof normalizeSnapshot>[]>());
}

function buildBasketFromDemo(slug: string) {
  return demoBaskets.find((basket) => basket.slug === slug) ?? null;
}

async function buildBasketFromDb(slug: string): Promise<BasketData | null> {
  if (!db) {
    return null;
  }

  const basket = await db.query.baskets.findFirst({
    where: eq(baskets.slug, slug),
  });

  if (!basket) {
    return null;
  }

  const [market, metrics, orderRows, alertRows, ruleRows, positionRows] =
    await Promise.all([
      db.query.marketConditions.findFirst({
        where: eq(marketConditions.basketId, basket.id),
      }),
      db.query.basketMetrics.findFirst({
        where: eq(basketMetrics.basketId, basket.id),
      }),
      db.select().from(brokerOrderBlocks).where(eq(brokerOrderBlocks.basketId, basket.id)),
      db
        .select()
        .from(positionAlerts)
        .where(eq(positionAlerts.basketId, basket.id))
        .orderBy(positionAlerts.sortOrder),
      db
        .select()
        .from(basketRules)
        .where(eq(basketRules.basketId, basket.id))
        .orderBy(basketRules.sortOrder),
      db
        .select()
        .from(positions)
        .where(eq(positions.basketId, basket.id))
        .orderBy(positions.sortOrder),
    ]);

  if (!market || !metrics) {
    return null;
  }

  const snapshotsByPositionId = await getSnapshotsForPositionIds(
    positionRows.map((row) => row.id),
  );

  const hydratedPositions = positionRows.map((row) => {
    const history = snapshotsByPositionId.get(row.id) ?? [];
    // A settlement outranks the clock. An early backfill stamped entry
    // snapshots with the moment it ran rather than the moment of entry,
    // which put them after the real Expiry-Resolved row and made every
    // archived week read as pnl zero, state safe. Settled is settled.
    const latest =
      history.find((snapshot) => snapshot.confidence === "Expiry-Resolved") ??
      history.at(-1);
    if (!latest) {
      return null;
    }
    return normalizePosition({
      ...row,
      latestPerformance: latest,
      performanceHistory: history,
    });
  });

  const filteredPositions = hydratedPositions.filter(Boolean) as ReturnType<
    typeof normalizePosition
  >[];

  return {
    id: basket.id,
    title: basket.title,
    slug: basket.slug,
    weekOf: basket.weekOf,
    publicationDate: asIsoString(basket.publicationDate ?? basket.createdAt),
    status: basket.status,
    gsrs: asNumber(basket.gsrs),
    radarStatus: basket.radarStatus,
    cashNeeded: basket.cashNeeded,
    disclaimer: basket.disclaimer,
    quickSummary:
      (basket.quickSummary as Array<{ label: string; value: string; hint?: string }>) ?? [],
    marketConditions: normalizeMarketConditions(market),
    callPositions: filteredPositions.filter((position) => position.side === "call"),
    putPositions: filteredPositions.filter((position) => position.side === "put"),
    meanReversionBuffer: filteredPositions
      .filter((position) => position.side === "put" && position.atr14d)
      .map((position) => ({
        label: position.ticker,
        value: `$${(position.entryUnderlyingPrice - position.strike).toFixed(2)}`,
        hint: position.buffer ?? undefined,
      })),
    portfolioSummary: {
      totalNames: metrics.totalNames,
      callCount: metrics.callCount,
      putCount: metrics.putCount,
      totalMargin: metrics.totalMargin,
      cashNeeded: metrics.cashNeeded,
      totalEstimatedCredit: metrics.totalEstimatedCredit,
      dailyTheta: metrics.dailyTheta,
      concentrationNote: metrics.concentrationNote,
      gsrsConstraintNote: metrics.gsrsConstraintNote,
    },
    orderBlocks: orderRows.map(normalizeOrderBlock),
    priceAlerts: alertRows.map(normalizeAlert),
    hardStops: ruleRows
      .filter((rule) => rule.category === "hard-stop")
      .map((rule) => ({
        id: rule.id,
        category: rule.category,
        title: rule.title,
        body: rule.body,
      })),
    profitTargets: ruleRows
      .filter((rule) => rule.category === "profit-target")
      .map((rule) => ({
        id: rule.id,
        category: rule.category,
        title: rule.title,
        body: rule.body,
      })),
    freeformNotes:
      basket.commentary
        ?.split("\n")
        .map((item) => item.trim())
        .filter(Boolean) ?? [],
    adminOnlyNotes:
      basket.adminNotes
        ?.split("\n")
        .map((item) => item.trim())
        .filter(Boolean) ?? [],
    lastRefreshAt: asIsoString(basket.lastRefreshAt ?? basket.updatedAt),
  };
}

export async function getBasketBySlug(slug: string) {
  return (await buildBasketFromDb(slug)) ?? buildBasketFromDemo(slug);
}

export async function getCurrentBasket() {
  if (db) {
    const current = await db.query.baskets.findFirst({
      where: eq(baskets.status, "published"),
      orderBy: desc(baskets.weekOf),
    });
    if (current) {
      return getBasketBySlug(current.slug);
    }
  }
  return demoBaskets[0];
}

export async function listBaskets() {
  if (db) {
    const rows = await db
      .select({ slug: baskets.slug })
      .from(baskets)
      .orderBy(desc(baskets.weekOf));
    const results = await Promise.all(rows.map((row) => getBasketBySlug(row.slug)));
    return results.filter(Boolean) as BasketData[];
  }
  return demoBaskets;
}

export async function getDashboardData(): Promise<DashboardData> {
  if (!db) {
    return demoDashboard();
  }

  const currentBasket = await getCurrentBasket();
  if (!currentBasket) {
    return demoDashboard();
  }

  const livePositions = [...currentBasket.callPositions, ...currentBasket.putPositions];
  return {
    currentBasket,
    livePositions,
    warningPositions: livePositions.filter((position) =>
      ["approaching-strike", "breached"].includes(position.latestPerformance.state),
    ),
    latestRefreshAt: currentBasket.lastRefreshAt,
  };
}

export async function getPositionDetail(id: string): Promise<PositionDetailData | null> {
  const basketsList = await listBaskets();
  for (const basket of basketsList) {
    const position = [...basket.callPositions, ...basket.putPositions].find(
      (item) => item.id === id,
    );
    if (position) {
      return {
        ...position,
        basketTitle: basket.title,
        basketSlug: basket.slug,
        basketStatus: basket.status,
        marketConditions: basket.marketConditions,
      };
    }
  }
  return null;
}

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  if (!db) {
    return demoAnalytics();
  }

  const basketsList = await listBaskets();
  const positionsList = basketsList.flatMap((basket) => [
    ...basket.callPositions,
    ...basket.putPositions,
  ]);

  if (positionsList.length === 0) {
    return demoAnalytics();
  }

  const statusCountsMap = new Map<string, number>();
  for (const position of positionsList) {
    const state = position.latestPerformance.state;
    statusCountsMap.set(state, (statusCountsMap.get(state) ?? 0) + 1);
  }

  return {
    basketsTracked: basketsList.length,
    livePositions: positionsList.filter(
      (position) =>
        position.latestPerformance.state !== "expired-itm" &&
        position.latestPerformance.state !== "expired-otm" &&
        position.latestPerformance.state !== "manually-closed",
    ).length,
    resolvedPositions: positionsList.filter((position) =>
      ["expired-itm", "expired-otm", "manually-closed"].includes(
        position.latestPerformance.state,
      ),
    ).length,
    averageCreditCapturePct:
      positionsList.reduce(
        (sum, position) => sum + position.latestPerformance.creditCapturePct,
        0,
      ) / positionsList.length,
    estimatedPnl: positionsList.reduce(
      (sum, position) => sum + position.latestPerformance.pnlAmount,
      0,
    ),
    statusCounts: Array.from(statusCountsMap.entries()).map(([state, count]) => ({
      state: state as AnalyticsSummary["statusCounts"][number]["state"],
      count,
    })),
  };
}

export async function listAdminUsers(): Promise<AdminUserRecord[]> {
  if (!db) {
    return demoUsers;
  }

  const rows = await db.select().from(userProfiles).orderBy(desc(userProfiles.createdAt));
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    status: row.status,
    acknowledgedRiskAt: row.acknowledgedRiskAt
      ? asIsoString(row.acknowledgedRiskAt)
      : null,
    lastLoginAt: row.lastLoginAt ? asIsoString(row.lastLoginAt) : null,
    identityConfirmedAt: null,
    createdAt: asIsoString(row.createdAt),
  }));
}

export async function listPendingAccessRequests(): Promise<AccessRequestRecord[]> {
  if (!db) {
    return [];
  }

  const rows = await db
    .select()
    .from(accessRequests)
    .where(eq(accessRequests.status, "new"))
    .orderBy(desc(accessRequests.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    message: row.message,
    status: row.status,
    createdAt: asIsoString(row.createdAt),
  }));
}

export async function listSyncJobs(): Promise<SyncJobRecord[]> {
  if (!db) {
    return demoSyncJobs;
  }

  const rows = await db.select().from(syncJobs).orderBy(desc(syncJobs.startedAt));
  if (rows.length === 0) {
    return demoSyncJobs;
  }

  return rows.map((row) => ({
    id: row.id,
    jobType: row.jobType,
    status: row.status,
    startedAt: asIsoString(row.startedAt),
    completedAt: row.completedAt ? asIsoString(row.completedAt) : null,
    positionsProcessed: row.positionsProcessed,
    errorsCount: row.errorsCount,
    notes: row.notes,
  }));
}

export async function getFeaturedPreviewBaskets() {
  return uniqueBy(await listBaskets(), (basket) => basket.id).slice(0, 2);
}
