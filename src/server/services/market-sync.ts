import { eq } from "drizzle-orm";

import { db } from "@/db";
import { baskets, performanceSnapshots, positions, syncJobs } from "@/db/schema";
import { demoBaskets } from "@/lib/demo-data";

import { defaultMarketDataProvider } from "@/server/market/yahoo";
import { normalizePosition } from "@/server/repos/helpers";

import { sendStopBreachAlert } from "./email";
import { generateLiveSnapshot } from "./performance";

// Hard-stop rule: alert when modeled loss reaches 25% of the name's margin.
const STOP_LOSS_FRACTION = 0.25;

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

      const resolvedStates = new Set(["expired-otm", "expired-itm", "manually-closed"]);
      let basketTouched = false;

      for (const row of positionRows) {
        const existingHistory = await db
          .select()
          .from(performanceSnapshots)
          .where(eq(performanceSnapshots.positionId, row.id));

        // Settled positions never change again. Before this check, the hourly
        // job kept re-pricing expired options indefinitely (the March 2026
        // basket accumulated ~22,500 junk snapshots over four months).
        const expiryPassed = new Date(`${row.expiry}T23:59:59Z`).getTime() < Date.now();
        if (expiryPassed && existingHistory.length > 0) {
          const latest = [...existingHistory].sort(
            (a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
          )[0];
          if (latest && resolvedStates.has(latest.state)) {
            continue; // already settled — one Expiry-Resolved snapshot is enough
          }
        }

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
        basketTouched = true;

        // Stop-breach alert: fire once, the first time modeled P&L crosses
        // -25% of the name's allocated margin.
        const stopLevel = -STOP_LOSS_FRACTION * row.margin;
        if (snapshot.pnlAmount <= stopLevel) {
          const alreadyBreached = existingHistory.some(
            (s) => Number(s.pnlAmount) <= stopLevel,
          );
          if (!alreadyBreached) {
            try {
              await sendStopBreachAlert({
                ticker: row.ticker,
                side: row.side,
                strike: Number(row.strike),
                pnlAmount: snapshot.pnlAmount,
                margin: row.margin,
                underlyingPrice: snapshot.underlyingPrice,
                basketSlug: basketRow.slug,
              });
            } catch (err) {
              console.error("stop-breach alert failed:", err);
            }
          }
        }

        if (existingHistory.length === 0) {
          await captureEntrySnapshotsForBasket(row.basketId);
        }
      }

      if (basketTouched) {
        await db
          .update(baskets)
          .set({ lastRefreshAt: new Date(), updatedAt: new Date() })
          .where(eq(baskets.id, basketRow.id));
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
