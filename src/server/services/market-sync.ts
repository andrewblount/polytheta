import { eq } from "drizzle-orm";

import { db } from "@/db";
import { baskets, performanceSnapshots, positions, syncJobs } from "@/db/schema";
import { demoBaskets } from "@/lib/demo-data";

import { defaultMarketDataProvider } from "@/server/market/yahoo";
import { normalizePosition } from "@/server/repos/helpers";

import { generateLiveSnapshot } from "./performance";

export async function captureEntrySnapshotsForBasket(basketId: string) {
  if (!db) {
    return { inserted: 0 };
  }

  const positionRows = await db.select().from(positions).where(eq(positions.basketId, basketId));
  let inserted = 0;

  for (const row of positionRows) {
    const position = normalizePosition({
      ...row,
      latestPerformance: demoBaskets[0].callPositions[0].latestPerformance,
      performanceHistory: demoBaskets[0].callPositions[0].performanceHistory,
    });

    const snapshot = await generateLiveSnapshot(position, defaultMarketDataProvider, row.entryTimestamp.toISOString());
    await db.insert(performanceSnapshots).values({
      basketId: row.basketId,
      positionId: row.id,
      observedAt: new Date(snapshot.observedAt),
      underlyingPrice: snapshot.underlyingPrice.toString(),
      optionMark: snapshot.optionMark?.toString(),
      estimatedOptionValue: snapshot.estimatedOptionValue?.toString(),
      impliedVolatility: snapshot.impliedVolatility?.toString(),
      confidence: snapshot.confidence,
      state: snapshot.state,
      underlyingMovePct: snapshot.underlyingMovePct.toString(),
      distanceToStrike: snapshot.distanceToStrike.toString(),
      safetyBufferPct: snapshot.safetyBufferPct.toString(),
      daysToExpiry: snapshot.daysToExpiry,
      creditCapturePct: snapshot.creditCapturePct.toString(),
      pnlAmount: snapshot.pnlAmount.toString(),
      pnlPercent: snapshot.pnlPercent.toString(),
      sourceLabel: snapshot.sourceLabel,
    });
    inserted += 1;
  }

  await db
    .update(baskets)
    .set({ lastRefreshAt: new Date(), updatedAt: new Date() })
    .where(eq(baskets.id, basketId));

  return { inserted };
}

export async function runMarketSync(triggeredBy = "manual") {
  if (!db) {
    return { ok: true, inserted: 0, demo: true };
  }

  const [job] = await db
    .insert(syncJobs)
    .values({
      jobType: "market-refresh",
      status: "running",
      triggeredBy,
      notes: "Running scheduled or manual market refresh.",
    })
    .returning();

  try {
    const basketRows = await db.select().from(baskets).where(eq(baskets.status, "published"));
    let inserted = 0;

    for (const basketRow of basketRows) {
      const positionRows = await db
        .select()
        .from(positions)
        .where(eq(positions.basketId, basketRow.id));

      for (const row of positionRows) {
        const existingHistory = await db
          .select()
          .from(performanceSnapshots)
          .where(eq(performanceSnapshots.positionId, row.id));

        const seedPosition = demoBaskets
          .flatMap((basket) => [...basket.callPositions, ...basket.putPositions])
          .find((position) => position.id === row.id);

        const fallback = seedPosition ?? demoBaskets[0].callPositions[0];
        const position = normalizePosition({
          ...row,
          latestPerformance: fallback.latestPerformance,
          performanceHistory: fallback.performanceHistory,
        });

        const snapshot = await generateLiveSnapshot(position, defaultMarketDataProvider);
        await db.insert(performanceSnapshots).values({
          basketId: row.basketId,
          positionId: row.id,
          observedAt: new Date(snapshot.observedAt),
          underlyingPrice: snapshot.underlyingPrice.toString(),
          optionMark: snapshot.optionMark?.toString(),
          estimatedOptionValue: snapshot.estimatedOptionValue?.toString(),
          impliedVolatility: snapshot.impliedVolatility?.toString(),
          confidence: snapshot.confidence,
          state: snapshot.state,
          underlyingMovePct: snapshot.underlyingMovePct.toString(),
          distanceToStrike: snapshot.distanceToStrike.toString(),
          safetyBufferPct: snapshot.safetyBufferPct.toString(),
          daysToExpiry: snapshot.daysToExpiry,
          creditCapturePct: snapshot.creditCapturePct.toString(),
          pnlAmount: snapshot.pnlAmount.toString(),
          pnlPercent: snapshot.pnlPercent.toString(),
          sourceLabel: snapshot.sourceLabel,
        });
        inserted += 1;

        await db
          .update(baskets)
          .set({ lastRefreshAt: new Date(snapshot.observedAt), updatedAt: new Date() })
          .where(eq(baskets.id, row.basketId));

        if (existingHistory.length === 0) {
          await captureEntrySnapshotsForBasket(row.basketId);
        }
      }
    }

    await db
      .update(syncJobs)
      .set({
        status: "success",
        completedAt: new Date(),
        positionsProcessed: inserted,
        updatedAt: new Date(),
        notes: "Refresh completed successfully.",
      })
      .where(eq(syncJobs.id, job.id));

    return { ok: true, inserted };
  } catch (error) {
    await db
      .update(syncJobs)
      .set({
        status: "error",
        completedAt: new Date(),
        errorsCount: 1,
        updatedAt: new Date(),
        notes: error instanceof Error ? error.message : "Unknown sync error",
      })
      .where(eq(syncJobs.id, job.id));
    throw error;
  }
}
