import { eq, desc, asc, and, isNull, gte, lte } from "drizzle-orm";

import { db } from "@/db";
import { sessionClose, currentWeek } from "../../../shared/market-calendar.mjs";
import { appSettings, baskets, performanceSnapshots, positions, syncJobs, syncLogs } from "@/db/schema";
import { demoBaskets } from "@/lib/demo-data";

import { defaultMarketDataProvider, YahooMarketDataProvider } from "@/server/market/yahoo";
import { normalizePosition } from "@/server/repos/helpers";

import { sendRadarAlert, sendStopBreachAlert } from "./email";
import { raiseAlert } from "./notify";
import { scanNewsRadar } from "./news-radar";
import { generateLiveSnapshot } from "./performance";

// Every alert goes through raiseAlert: alert feed (Alerts tab + Mac iMessage
// bridge), SMS/WhatsApp per settings, and APNs push to the phone.

// Adverse-move heads-up threshold (informational under policy v3 — the
// position is held to expiry; only a radar signal forces an exit).
const STOP_LOSS_FRACTION = 0.25;

export function entrySnapshotIsDue(entryTimestamp: Date | string, now = new Date()) {
  const at = +new Date(entryTimestamp);
  return Number.isFinite(at) && at <= +now;
}

// Exit a model position now: price it at the current mark, record a
// manually-closed settlement snapshot and close the position, so the model's
// performance reflects the exit and no later expiry settlement replaces it.
export async function exitModelPosition({ row, basketSlug, provider, jobId, reason }: {
  row: typeof positions.$inferSelect; basketSlug: string; provider: YahooMarketDataProvider | typeof defaultMarketDataProvider; jobId: string | null;
  reason: { title: string; link: string; publisher?: string; publishedAt?: string };
}) {
  if (!db || row.manualCloseDate) return false;
  const position = normalizePosition({ ...row, latestPerformance: demoBaskets[0].callPositions[0].latestPerformance, performanceHistory: demoBaskets[0].callPositions[0].performanceHistory });
  const snapshot = await generateLiveSnapshot(position, provider);
  const exitValue = snapshot.optionMark ?? snapshot.estimatedOptionValue ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const observedAt = new Date(Math.max(+new Date(snapshot.observedAt), Date.now() - 1000));
  await db.insert(performanceSnapshots).values({
    basketId: row.basketId, positionId: row.id, observedAt,
    underlyingPrice: snapshot.underlyingPrice.toString(), optionMark: exitValue.toString(), estimatedOptionValue: exitValue.toString(),
    impliedVolatility: snapshot.impliedVolatility?.toString(), confidence: snapshot.confidence, state: "manually-closed",
    underlyingMovePct: snapshot.underlyingMovePct.toString(), distanceToStrike: snapshot.distanceToStrike.toString(), safetyBufferPct: snapshot.safetyBufferPct.toString(),
    daysToExpiry: snapshot.daysToExpiry, creditCapturePct: snapshot.creditCapturePct.toString(), pnlAmount: snapshot.pnlAmount.toString(), pnlPercent: snapshot.pnlPercent.toString(),
    sourceLabel: `Model exit on radar signal (${snapshot.sourceLabel})`,
    sourceMetadata: { reason: "radar", title: reason.title, link: reason.link, publisher: reason.publisher ?? null, publishedAt: reason.publishedAt ?? null },
  }).onConflictDoNothing();
  await db.update(positions).set({
    manualClosePrice: exitValue.toFixed(2), manualCloseDate: today, updatedAt: new Date(),
    sourceMetadata: { ...((row.sourceMetadata ?? {}) as Record<string, unknown>), model_exit: { at: observedAt.toISOString(), value: exitValue, pnl: Math.round(snapshot.pnlAmount), reason: reason.title, link: reason.link } },
  }).where(eq(positions.id, row.id));
  await raiseAlert({ kind: "model-exit", jobId, category: "radar_alerts",
    title: `Model exit: ${row.ticker} ${row.side} ${Number(row.strike)}`,
    message: `MODEL EXIT: ${row.ticker} ${row.side} ${Number(row.strike)} closed at ${exitValue.toFixed(2)} (modeled P&L ${Math.round(snapshot.pnlAmount) >= 0 ? "+" : ""}${Math.round(snapshot.pnlAmount)}) on radar: "${reason.title}". The execution service closes the IB contracts on the same signal.`,
    meta: { ticker: row.ticker, side: row.side, strike: Number(row.strike), exitValue, pnlAmount: Math.round(snapshot.pnlAmount), basket: basketSlug, link: reason.link } });
  return true;
}

export async function captureEntrySnapshotsForBasket(basketId: string) {
  if (!db) {
    return { inserted: 0 };
  }

  const positionRows = await db!.select().from(positions).where(eq(positions.basketId, basketId));
  let inserted = 0;

  for (const row of positionRows) {
    if (!entrySnapshotIsDue(row.entryTimestamp)) continue;
    const position = normalizePosition({
      ...row,
      latestPerformance: demoBaskets[0].callPositions[0].latestPerformance,
      performanceHistory: demoBaskets[0].callPositions[0].performanceHistory,
    });

    const snapshot = await generateLiveSnapshot(position, defaultMarketDataProvider, row.entryTimestamp.toISOString());
    await db!.insert(performanceSnapshots).values({
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

  if (inserted) await db!
    .update(baskets)
    .set({ lastRefreshAt: new Date(), updatedAt: new Date() })
    .where(eq(baskets.id, basketId));

  return { inserted };
}

// Pricing and news are independent reads: an unavailable old price must not
// suppress monitoring this position or prevent later positions from refreshing.
export async function runIndependentPositionTasks({ pricing, news, onError }: {
  pricing: () => Promise<void>;
  news?: () => Promise<void>;
  onError: (kind: "pricing" | "radar", error: unknown) => Promise<void>;
}) {
  await Promise.all(([["pricing", pricing], ["radar", news]] as const).map(async ([kind, task]) => {
    if (!task) return;
    try { await task(); } catch (error) { await onError(kind, error); }
  }));
}

type SyncCandidate = { position: { id: string }; basket: { id: string; weekOf: string } };
export function selectSyncBatch<T extends SyncCandidate>(rows: T[], cursor: { active?: number; history?: number } = {}, week = currentWeek()) {
  const active = rows.filter(row => row.basket.weekOf === week);
  const history = rows.filter(row => row.basket.weekOf !== week);
  const rotate = (items: T[], offset = 0, limit: number) => {
    const start = Number.isInteger(offset) && offset >= 0 ? offset % Math.max(1, items.length) : 0;
    return { rows: [...items.slice(start), ...items.slice(0, start)].slice(0, limit), next: items.length ? (start + (items.length <= limit ? 1 : limit)) % items.length : 0 };
  };
  const a = rotate(active, cursor.active, 8), h = rotate(history, cursor.history, 2);
  return { rows: [...a.rows, ...h.rows], cursor: { active: a.next, history: h.next }, deferred: rows.length - a.rows.length - h.rows.length };
}

export async function runMarketSync(triggeredBy = "manual") {
  if (!db) {
    return { ok: true, inserted: 0, demo: true };
  }

  // Scheduled functions have a 30s limit. Leave time for DB writes and the
  // calling function's response; every Yahoo request shares this run's abort.
  const readSignal = AbortSignal.timeout(18000);
  const provider = new YahooMarketDataProvider({ signal: readSignal, requestTimeoutMs: 6000, attempts: 2 });
  const [job] = await db!
    .insert(syncJobs)
    .values({
      jobType: "market-refresh",
      status: "running",
      triggeredBy,
      notes: "Running scheduled or manual market refresh.",
    })
    .returning();

  try {
    const allRows = await db!.select({ position: positions, basket: baskets }).from(positions)
      .innerJoin(baskets, eq(positions.basketId, baskets.id))
      .where(and(eq(baskets.status, "published"), isNull(positions.manualCloseDate), lte(positions.entryTimestamp, new Date())))
      .orderBy(desc(baskets.weekOf), asc(positions.sortOrder), asc(positions.id));
    const [saved] = await db!.select().from(appSettings).where(eq(appSettings.key, "market_sync_cursor"));
    const batch = selectSyncBatch(allRows, (saved?.value ?? {}) as { active?: number; history?: number });
    // Advance before network work so even a killed invocation cannot keep
    // retrying the same slow first position forever.
    await db!.insert(appSettings).values({ key: "market_sync_cursor", value: batch.cursor })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: batch.cursor, updatedAt: new Date() } });
    let inserted = 0;
    let errors = 0;
    const basketRows = [...new Map(batch.rows.map(row => [row.basket.id, row.basket])).values()];
    for (const basketRow of basketRows) {
      const positionRows = batch.rows.filter(row => row.basket.id === basketRow.id).map(row => row.position);
      const resolvedStates = new Set(["expired-otm", "expired-itm", "manually-closed"]);
      let basketTouched = false;

      await Promise.all(positionRows.map(async row => {
        if (row.manualCloseDate) return;
        if (!entrySnapshotIsDue(row.entryTimestamp)) return; // finalized basket awaiting its planned entry window
        let expiryPassed: boolean;
        try { expiryPassed = sessionClose(row.expiry).getTime() <= Date.now(); }
        catch (error) {
          errors += 1;
          await db!.insert(syncLogs).values({ jobId: job.id, level: "error", message: `Invalid expiry calendar for ${row.ticker}`, metadata: { ticker: row.ticker, error: error instanceof Error ? error.message : String(error) } });
          return;
        }
        await runIndependentPositionTasks({
          pricing: async () => {
            if (expiryPassed) {
              const [settled] = await db!.select({ state: performanceSnapshots.state }).from(performanceSnapshots)
                .where(and(eq(performanceSnapshots.positionId, row.id), eq(performanceSnapshots.confidence, "Expiry-Resolved"), gte(performanceSnapshots.observedAt, sessionClose(row.expiry)))).limit(1);
              if (settled && resolvedStates.has(settled.state)) return;
            }
            const existingHistory = expiryPassed ? [] : await db!.select().from(performanceSnapshots)
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

            const snapshot = await generateLiveSnapshot(position, provider);
            await db!.insert(performanceSnapshots).values({
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

            if (expiryPassed) return;
            // Strike-watch warning: the first time the underlying reaches the
            // first ATR break level (approaching-strike) or trades through the
            // strike (breached), warn once per state.
            const warnedStates = new Set(existingHistory.map((s) => s.state));
            if ((snapshot.state === "approaching-strike" || snapshot.state === "breached") && !warnedStates.has(snapshot.state)) {
              try {
                await raiseAlert({ kind: "trade-warning", jobId: job.id, category: "adverse_move",
                  title: `Trade warning: ${row.ticker} ${row.side} ${snapshot.state === "breached" ? "through the strike" : "at the break level"}`,
                  message: `${row.ticker} ${row.side} ${Number(row.strike)}: underlying ${snapshot.underlyingPrice.toFixed(2)} is ${snapshot.state === "breached" ? "through the strike" : "at the first ATR break level"}; modeled P&L ${Math.round(snapshot.pnlAmount)}. Check the news radar; exits happen on a radar signal or the ticker loss limit, not on price.`,
                  meta: { ticker: row.ticker, side: row.side, strike: Number(row.strike), state: snapshot.state, underlyingPrice: snapshot.underlyingPrice, pnlAmount: Math.round(snapshot.pnlAmount), basket: basketRow.slug } });
              } catch (err) { console.error("trade warning failed:", err); }
            }
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
                  await raiseAlert({ kind: "adverse-move", jobId: job.id, category: "adverse_move",
                    title: `Trade warning: ${row.ticker} ${row.side}`,
                    message: `Heads-up: ${row.ticker} ${row.side} down ${Math.round((snapshot.pnlAmount / row.margin) * 100)}% of allocation — check news. Policy: hold to expiry unless the radar fires.`,
                    meta: { ticker: row.ticker, side: row.side, strike: Number(row.strike), pnlAmount: Math.round(snapshot.pnlAmount), margin: row.margin, basket: basketRow.slug } });
                } catch (err) {
                  console.error("stop-breach alert failed:", err);
                }
              }
            }

          },
          news: expiryPassed ? undefined : async () => {
            const metaName = (row.sourceMetadata as { name?: string } | null)?.name ?? "";
            const hits = await scanNewsRadar(row.ticker, row.side, metaName, { signal: readSignal, requestTimeoutMs: 6000, attempts: 2 });
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
                const actionable = fresh.find((h) => h.actionable);
                await raiseAlert({ kind: "radar", jobId: job.id, category: "radar_alerts",
                  title: `${row.side === "call" ? "Acquisition" : "Downside-gap"} radar: ${row.ticker}`,
                  message: `${row.side === "call" ? "ACQUISITION" : "DOWNSIDE-GAP"} RADAR: ${row.ticker} — "${fresh[0].title}" — ${actionable ? "EXIT SIGNAL from a primary source; the model is exiting and the execution service closes its contracts." : "keyword match from a secondary source; verify now."}`,
                  meta: { ticker: row.ticker, side: row.side, strike: Number(row.strike), actionable: Boolean(actionable), hits: fresh.slice(0, 3), basket: basketRow.slug } });
                // A credible signal exits the MODEL position at the current mark;
                // the execution service runs the same classifier against its own
                // fills and closes the IB contracts independently.
                if (actionable) {
                  try {
                    const exited = await exitModelPosition({ row, basketSlug: basketRow.slug, provider, jobId: job.id, reason: actionable });
                    if (exited) { inserted += 1; basketTouched = true; }
                  } catch (err) { console.error("model exit failed:", err); errors += 1; }
                }
                await db!
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
          },
          onError: async (kind, error) => {
            errors += 1;
            console.error(`${kind} failed for ${row.ticker}:`, error);
            await db!.insert(syncLogs).values({ jobId: job.id, level: "error", message: `${kind === "radar" ? "News coverage" : "Price data"} unavailable for ${row.ticker}; retry required`, metadata: { kind: `${kind}-outage`, ticker: row.ticker } });
          },
        });
      }));

      if (basketTouched) {
        await db!
          .update(baskets)
          .set({ lastRefreshAt: new Date(), updatedAt: new Date() })
          .where(eq(baskets.id, basketRow.id));
      }
    }

    await db!
      .update(syncJobs)
      .set({
        status: errors ? "error" : "success",
        errorsCount: errors,
        completedAt: new Date(),
        positionsProcessed: inserted,
        updatedAt: new Date(),
        notes: `Processed a rotating batch of ${batch.rows.length} positions (${batch.deferred} deferred); ${errors} failed reads will retry. Current-week positions have priority.`,
      })
      .where(eq(syncJobs.id, job.id));

    return { ok: errors === 0, inserted, errors, deferred: batch.deferred };
  } catch (error) {
    await db!
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
