import { admin } from "@netlify/identity";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  basketMetrics,
  basketRules,
  baskets,
  brokerOrderBlocks,
  manualOverrides,
  marketConditions,
  positionAlerts,
  positions,
  userProfiles,
} from "@/db/schema";
import type { UserRole, UserStatus } from "@/lib/types";

import { captureEntrySnapshotsForBasket, runMarketSync } from "./market-sync";

type BasketPayload = {
  id?: string;
  title: string;
  slug: string;
  weekOf: string;
  publicationDate?: string;
  status: "draft" | "published" | "archived";
  gsrs: number;
  radarStatus: string;
  cashNeeded: number;
  disclaimer: string;
  quickSummary: Array<{ label: string; value: string; hint?: string }>;
  commentary: string;
  adminNotes: string;
  marketConditions: {
    gsrsNote: string;
    vix: number;
    skew: number;
    hyOas: number;
    move: number;
    putCallRatio: number;
    acquisitionRadarStatus: string;
    downsideGapRadarStatus: string;
    narrative: string;
  };
  portfolioSummary: {
    totalNames: number;
    callCount: number;
    putCount: number;
    totalMargin: number;
    cashNeeded: number;
    totalEstimatedCredit: number;
    dailyTheta: number;
    concentrationNote: string;
    gsrsConstraintNote: string;
  };
  callPositions: Array<Record<string, unknown>>;
  putPositions: Array<Record<string, unknown>>;
  orderBlocks: Array<{
    id?: string;
    broker: string;
    side: string;
    title: string;
    orderText: string;
  }>;
  priceAlerts: Array<{
    id?: string;
    positionId?: string;
    ticker: string;
    side: "call" | "put";
    label: string;
    thresholdValue: number;
    protocolNote: string;
  }>;
  hardStops: Array<{ id?: string; title: string; body: string }>;
  profitTargets: Array<{ id?: string; title: string; body: string }>;
};

function uuid(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : crypto.randomUUID();
}

export async function saveBasket(
  payload: BasketPayload,
  actorIdentityUserId?: string,
) {
  if (!db) {
    return { id: payload.id ?? crypto.randomUUID(), demo: true };
  }

  const basketId = payload.id ?? crypto.randomUUID();
  const now = new Date();
  const publicationDate =
    payload.status === "published"
      ? new Date(payload.publicationDate ?? now.toISOString())
      : null;

  const basketValues = {
    id: basketId,
    title: payload.title,
    slug: payload.slug,
    weekOf: payload.weekOf,
    publicationDate,
    status: payload.status,
    gsrs: payload.gsrs.toString(),
    radarStatus: payload.radarStatus,
    cashNeeded: payload.cashNeeded,
    disclaimer: payload.disclaimer,
    quickSummary: payload.quickSummary,
    commentary: payload.commentary,
    adminNotes: payload.adminNotes,
    createdByIdentityUserId: actorIdentityUserId,
    publishedByIdentityUserId: payload.status === "published" ? actorIdentityUserId : null,
    updatedAt: now,
  };

  await db
    .insert(baskets)
    .values({ ...basketValues, createdAt: now })
    .onConflictDoUpdate({
      target: baskets.id,
      set: basketValues,
    });

  await db
    .insert(marketConditions)
    .values({
      basketId,
      ...payload.marketConditions,
      vix: payload.marketConditions.vix.toString(),
      skew: payload.marketConditions.skew.toString(),
      hyOas: payload.marketConditions.hyOas.toString(),
      move: payload.marketConditions.move.toString(),
      putCallRatio: payload.marketConditions.putCallRatio.toString(),
    })
    .onConflictDoUpdate({
      target: marketConditions.basketId,
      set: {
        ...payload.marketConditions,
        vix: payload.marketConditions.vix.toString(),
        skew: payload.marketConditions.skew.toString(),
        hyOas: payload.marketConditions.hyOas.toString(),
        move: payload.marketConditions.move.toString(),
        putCallRatio: payload.marketConditions.putCallRatio.toString(),
        updatedAt: now,
      },
    });

  await db
    .insert(basketMetrics)
    .values({
      basketId,
      ...payload.portfolioSummary,
      totalEstimatedCredit: payload.portfolioSummary.totalEstimatedCredit,
      totalMargin: payload.portfolioSummary.totalMargin,
      dailyTheta: payload.portfolioSummary.dailyTheta,
      cashNeeded: payload.portfolioSummary.cashNeeded,
    })
    .onConflictDoUpdate({
      target: basketMetrics.basketId,
      set: {
        ...payload.portfolioSummary,
        updatedAt: now,
      },
    });

  const positionRows = [...payload.callPositions, ...payload.putPositions].map(
    (position, index) => ({
      id: uuid(position.id),
      basketId,
      side: position.side as "call" | "put",
      ticker: String(position.ticker ?? ""),
      companyName: position.companyName ? String(position.companyName) : null,
      sector: position.sector ? String(position.sector) : null,
      entryUnderlyingPrice: Number(position.entryUnderlyingPrice ?? 0).toString(),
      ivRank: Number(position.ivRank ?? 0).toString(),
      shortInterestPctFloat: Number(position.shortInterestPctFloat ?? 0).toString(),
      fanScore: Number(position.fanScore ?? 0).toString(),
      glassdoorScore: Number(position.glassdoorScore ?? 0).toString(),
      buybackScore: Number(position.buybackScore ?? 0),
      strike: Number(position.strike ?? 0).toString(),
      optionType: position.optionType as "call" | "put",
      expiry: String(position.expiry ?? ""),
      delta: Number(position.delta ?? 0).toString(),
      estimatedEntryCredit: Number(position.estimatedEntryCredit ?? 0).toString(),
      contracts: Number(position.contracts ?? 0),
      margin: Number(position.margin ?? 0),
      breakAlert1:
        position.breakAlert1 === null || position.breakAlert1 === undefined
          ? null
          : Number(position.breakAlert1).toString(),
      breakAlert2:
        position.breakAlert2 === null || position.breakAlert2 === undefined
          ? null
          : Number(position.breakAlert2).toString(),
      atr14d:
        position.atr14d === null || position.atr14d === undefined
          ? null
          : Number(position.atr14d).toString(),
      buffer: position.buffer ? String(position.buffer) : null,
      probabilityOfTouch:
        position.probabilityOfTouch === null || position.probabilityOfTouch === undefined
          ? null
          : Number(position.probabilityOfTouch).toString(),
      thesisSummary: String(position.thesisSummary ?? ""),
      thesisBullets: (position.thesisBullets as string[]) ?? [],
      cautionFlags: (position.cautionFlags as string[]) ?? [],
      entryTimestamp: new Date(String(position.entryTimestamp ?? now.toISOString())),
      notes: position.notes ? String(position.notes) : null,
      manualClosePrice:
        position.manualClosePrice === null || position.manualClosePrice === undefined
          ? null
          : Number(position.manualClosePrice).toString(),
      manualCloseDate: position.manualCloseDate ? String(position.manualCloseDate) : null,
      actualExitCredit:
        position.actualExitCredit === null || position.actualExitCredit === undefined
          ? null
          : Number(position.actualExitCredit).toString(),
      sortOrder: index,
      updatedAt: now,
    }),
  );

  for (const row of positionRows) {
    await db
      .insert(positions)
      .values({ ...row, createdAt: now })
      .onConflictDoUpdate({
        target: positions.id,
        set: row,
      });
  }

  await db.delete(brokerOrderBlocks).where(eq(brokerOrderBlocks.basketId, basketId));
  await db.delete(positionAlerts).where(eq(positionAlerts.basketId, basketId));
  await db.delete(basketRules).where(eq(basketRules.basketId, basketId));

  if (payload.orderBlocks.length) {
    await db.insert(brokerOrderBlocks).values(
      payload.orderBlocks.map((orderBlock) => ({
        id: uuid(orderBlock.id),
        basketId,
        broker: orderBlock.broker,
        side: orderBlock.side,
        title: orderBlock.title,
        orderText: orderBlock.orderText,
      })),
    );
  }

  if (payload.priceAlerts.length) {
    await db.insert(positionAlerts).values(
      payload.priceAlerts.map((alert, index) => ({
        id: uuid(alert.id),
        basketId,
        positionId: alert.positionId ?? null,
        ticker: alert.ticker,
        side: alert.side,
        label: alert.label,
        thresholdValue: alert.thresholdValue.toString(),
        protocolNote: alert.protocolNote,
        sortOrder: index,
      })),
    );
  }

  const rules = [
    ...payload.hardStops.map((rule, index) => ({
      id: uuid(rule.id),
      basketId,
      category: "hard-stop" as const,
      title: rule.title,
      body: rule.body,
      sortOrder: index,
    })),
    ...payload.profitTargets.map((rule, index) => ({
      id: uuid(rule.id),
      basketId,
      category: "profit-target" as const,
      title: rule.title,
      body: rule.body,
      sortOrder: payload.hardStops.length + index,
    })),
  ];

  if (rules.length) {
    await db.insert(basketRules).values(rules);
  }

  if (payload.status === "published") {
    await captureEntrySnapshotsForBasket(basketId);
  }

  return { id: basketId };
}

export async function updateUserAccess({
  userId,
  role,
  status,
}: {
  userId: string;
  role: UserRole;
  status: UserStatus;
}) {
  if (!db) {
    return;
  }

  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.id, userId),
  });

  if (!profile) {
    return;
  }

  await db
    .update(userProfiles)
    .set({
      role,
      status,
      updatedAt: new Date(),
    })
    .where(eq(userProfiles.id, userId));

  try {
    await admin.updateUser(profile.identityUserId, { role });
  } catch {
    // Runtime may be unavailable outside Netlify; DB remains source of truth.
  }
}

export async function saveManualOverride({
  positionId,
  actualExitCredit,
  actualCloseValue,
  actualCloseDate,
  note,
  actorIdentityUserId,
}: {
  positionId: string;
  actualExitCredit?: number | null;
  actualCloseValue?: number | null;
  actualCloseDate?: string | null;
  note?: string;
  actorIdentityUserId?: string;
}) {
  if (!db) {
    return;
  }

  await db.insert(manualOverrides).values({
    positionId,
    overrideType: "manual-close",
    actualCloseValue: actualCloseValue?.toString(),
    actualExitCredit: actualExitCredit?.toString(),
    actualCloseDate: actualCloseDate ?? null,
    note,
    createdByIdentityUserId: actorIdentityUserId,
  });

  await db
    .update(positions)
    .set({
      manualCloseDate: actualCloseDate ?? null,
      actualExitCredit: actualExitCredit?.toString() ?? null,
      manualClosePrice: actualCloseValue?.toString() ?? null,
      updatedAt: new Date(),
    })
    .where(eq(positions.id, positionId));
}

export async function runManualSync() {
  return runMarketSync("admin-manual");
}
