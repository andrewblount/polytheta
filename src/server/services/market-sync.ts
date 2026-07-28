import { eq } from "drizzle-orm";

import { db } from "@/db";
import { baskets, performanceSnapshots, positions, syncJobs, syncLogs } from "@/db/schema";
import { demoBaskets } from "@/lib/demo-data";

import { defaultMarketDataProvider } from "@/server/market/yahoo";
import { normalizePosition } from "@/server/repos/helpers";

import { sendRadarAlert, sendStopBreachAlert } from "./email";
import { scanNewsRadar } from "./news-radar";
import { generateLiveSnapshot } from "./performance";
import { getNotificationSettings } from "./settings";
import { sendTwilioMessage } from "./twilio";

// Fan an urgent alert out to the phone channels the settings enable.
async function pushUrgent(category: "radar_alerts" | "adverse_move", text: string) {
  try {
    const prefs = (await getNotificationSettings())[category] ?? {};
    if (prefs.sms) await sendTwilioMessage("sms", text);
    if (prefs.whatsapp) await sendTwilioMessage("whatsapp", text);
  } catch (err) {
    console.error("urgent push failed:", err);
  }
}

// Adverse-move heads-up threshold (informational under policy v3 — the
// position is held to expiry; only a radar signal forces an exit).
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
              // Feed the iMessage bridge (scripts/alert_bridge.mjs polls these).
              const adverseText = `⚠️ ${row.ticker} ${row.side} down ${Math.round((snapshot.pnlAmount / row.margin) * 100)}% of allocation — check news. Policy: hold to expiry.`;
              await pushUrgent("adverse_move", adverseText);
              await db.insert(syncLogs).values({
                jobId: job.id,
                level: "alert",
                message: `Heads-up: ${row.ticker} ${row.side} down ${Math.round((snapshot.pnlAmount / row.margin) * 100)}% of allocation — check news. Policy: hold to expiry.`,
                metadata: {
                  kind: "adverse-move",
                  ticker: row.ticker,
                  side: row.side,
                  strike: Number(row.strike),
                  pnlAmount: Math.round(snapshot.pnlAmount),
                  margin: row.margin,
                },
              });
            } catch (err) {
              console.error("stop-breach alert failed:", err);
            }
          }
        }

        if (existingHistory.length === 0) {
          await captureEntrySnapshotsForBasket(row.basketId);
        }

        // News radar — the exit-signal monitor. Scan fresh headlines for
        // this position's side; email each new hit once (dedup on link,
        // persisted in the position's sourceMetadata).
        try {
          const hits = await scanNewsRadar(row.ticker, row.side);
          if (hits.length > 0) {
            const meta = (row.sourceMetadata ?? {}) as Record<string, unknown>;
            const alerted = new Set(
              Array.isArray(meta.radar_alerted_links) ? (meta.radar_alerted_links as string[]) : [],
            );
            const fresh = hits.filter((h) => !alerted.has(h.link));
            if (fresh.length > 0) {
              await sendRadarAlert({
                ticker: row.ticker,
                side: row.side,
                strike: Number(row.strike),
                basketSlug: basketRow.slug,
                hits: fresh,
              });
              const radarText = `🚨 ${row.side === "call" ? "ACQUISITION" : "DOWNSIDE-GAP"} RADAR: ${row.ticker} — "${fresh[0].title}" — EXIT SIGNAL, verify now.`;
              await pushUrgent("radar_alerts", radarText);
              await db.insert(syncLogs).values({
                jobId: job.id,
                level: "alert",
                message: `${row.side === "call" ? "ACQUISITION" : "DOWNSIDE-GAP"} RADAR: ${row.ticker} — "${fresh[0].title}" — EXIT SIGNAL, verify now.`,
                metadata: {
                  kind: "radar",
                  ticker: row.ticker,
                  side: row.side,
                  strike: Number(row.strike),
                  hits: fresh.slice(0, 3),
                },
              });
              await db
                .update(positions)
                .set({
                  sourceMetadata: {
                    ...meta,
                    radar_alerted_links: [...alerted, ...fresh.map((h) => h.link)],
                    radar_last_hit: {
                      title: fresh[0].title,
                      link: fresh[0].link,
                      at: new Date().toISOString(),
                    },
                  },
                  updatedAt: new Date(),
                })
                .where(eq(positions.id, row.id));
            }
          }
        } catch (err) {
          console.error(`news radar failed for ${row.ticker}:`, err);
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
