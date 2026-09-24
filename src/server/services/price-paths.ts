// Underlying price paths for every leg of a basket: regular-session bars from
// just before entry to expiry (or now), with the strike, entry and breakeven
// levels and the per-leg analysis (cushion, closest approach, expiry price,
// post-mortem for a leg that expired in the money).
//
// Paths are cached in app_settings under 'price_path:<positionId>'. A settled
// week's path is fetched once and kept for good; an open week's path is
// refreshed every fifteen minutes.
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { analyzeLeg, type LegAnalysis, type LegInput, type PricePoint } from "@/lib/leg-analysis";
import type { BasketData, PositionData } from "@/lib/types";
import { YahooMarketDataProvider } from "@/server/market/yahoo";
import type { HistoricalPrice, MarketDataProvider } from "@/server/market/provider";
import { addDays, easternTime, marketSession, sessionClose } from "../../../shared/market-calendar.mjs";

export interface LegPath {
  positionId: string;
  ticker: string;
  side: "call" | "put";
  strike: number;
  entryPrice: number;
  entryAt: string;
  expiry: string;
  credit: number;
  contracts: number;
  lines: { strike: number; entry: number; breakeven: number };
  points: PricePoint[];
  analysis: LegAnalysis;
  complete: boolean;
  fetchedAt: string;
  source: string;
}

interface CachedPath { points: PricePoint[]; complete: boolean; fetchedAt: string; source: string; interval: string }

const KEY = (id: string) => `price_path:${id}`;
const FRESH_MS = 15 * 60000;

async function loadCached(ids: string[]) {
  if (!db || ids.length === 0) return new Map<string, CachedPath>();
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, ids.map(KEY)));
  return new Map(rows.map((r) => [r.key.slice("price_path:".length), r.value as unknown as CachedPath]));
}

async function saveCached(id: string, value: CachedPath) {
  if (!db) return;
  await db.insert(appSettings).values({ key: KEY(id), value: value as unknown as Record<string, unknown>, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: value as unknown as Record<string, unknown>, updatedAt: new Date() } });
}

// Keep only bars inside the regular session of their own ET date (drops
// pre/post-market prints Yahoo includes), stamped by bar close time.
export function regularSessionBars(bars: HistoricalPrice[]): PricePoint[] {
  const out: PricePoint[] = [];
  for (const bar of bars) {
    const t = new Date(bar.date);
    const et = easternTime(t);
    let session: ReturnType<typeof marketSession>;
    try { session = marketSession(et.date); } catch { continue; }
    if (!session.open || et.minutes < session.openMinute || et.minutes >= session.closeMinute) continue;
    if (!Number.isFinite(bar.close) || bar.close <= 0) continue;
    out.push({ t: t.toISOString(), p: +bar.close.toFixed(4), h: bar.high != null ? +bar.high.toFixed(4) : undefined, l: bar.low != null ? +bar.low.toFixed(4) : undefined });
  }
  return out.sort((a, b) => a.t.localeCompare(b.t));
}

function contextStart(entryAt: string) {
  // Two sessions of context before the entry day.
  let date = easternTime(new Date(entryAt)).date;
  for (let n = 0; n < 2; ) { date = addDays(date, -1); if (marketSession(date).open) n += 1; }
  return new Date(`${date}T00:00:00Z`);
}

async function fetchPath(position: PositionData, provider: MarketDataProvider, now: Date): Promise<CachedPath> {
  const start = contextStart(position.entryTimestamp);
  const close = sessionClose(position.expiry);
  const exitAt = position.manualCloseDate ? sessionClose(position.manualCloseDate) : null;
  const end = new Date(Math.min(now.getTime(), (exitAt ?? close).getTime() + 3600000));
  const ageDays = (now.getTime() - start.getTime()) / 86400000;
  const interval: "30m" | "1h" = ageDays < 58 ? "30m" : "1h";
  const bars = provider.getIntradayPrices ? await provider.getIntradayPrices(position.ticker, start, end, interval) : [];
  const points = regularSessionBars(bars);
  const finished = now.getTime() >= (exitAt ?? close).getTime();
  const lastDate = points.at(-1) ? easternTime(new Date(points.at(-1)!.t)).date : null;
  const complete = finished && lastDate != null && lastDate >= (position.manualCloseDate ?? position.expiry);
  return { points, complete, fetchedAt: now.toISOString(), source: `Yahoo ${interval} bars`, interval };
}

function legInput(position: PositionData, points: PricePoint[]): LegInput {
  const latest = position.latestPerformance;
  const settledStates = new Set(["expired-otm", "expired-itm", "manually-closed"]);
  const settled = latest && settledStates.has(latest.state) ? latest : null;
  const radar = position.radarLastHit;
  return {
    ticker: position.ticker, side: position.side, strike: position.strike, entryPrice: position.entryUnderlyingPrice, entryAt: position.entryTimestamp,
    expiry: position.expiry, credit: position.estimatedEntryCredit, contracts: position.contracts, margin: position.margin,
    atr: position.atr14d ?? null, delta: position.delta ?? null, points,
    expiryPrice: settled ? settled.underlyingPrice : null, settledState: settled?.state ?? null, settledPnl: settled ? settled.pnlAmount : null,
    snapshots: position.performanceHistory.map((s) => ({ observedAt: s.observedAt, underlyingPrice: s.underlyingPrice, pnlAmount: s.pnlAmount, state: s.state, confidence: s.confidence })),
    exitPrice: position.manualClosePrice ?? null, exitAt: position.manualCloseDate ? sessionClose(position.manualCloseDate).toISOString() : null,
    radarHit: radar ? { title: radar.title, at: radar.at } : null,
  };
}

// Paths for every leg of a basket, cached; fetches run in parallel and a
// failed fetch yields an empty path (the analysis still covers what the
// snapshots know).
export async function getBasketLegPaths(basket: BasketData, { provider, now = new Date() }: { provider?: MarketDataProvider; now?: Date } = {}): Promise<LegPath[]> {
  const positions = [...basket.callPositions, ...basket.putPositions];
  const cached = await loadCached(positions.map((p) => p.id));
  const yahoo = provider ?? new YahooMarketDataProvider({ requestTimeoutMs: 8000, attempts: 2 });
  return Promise.all(positions.map(async (position) => {
    let path = cached.get(position.id) ?? null;
    const stale = !path || (!path.complete && now.getTime() - new Date(path.fetchedAt).getTime() > FRESH_MS);
    if (stale) {
      try {
        const fresh = await fetchPath(position, yahoo, now);
        if (fresh.points.length > 0 || !path) { path = fresh; await saveCached(position.id, fresh); }
      } catch (error) {
        console.error(`price path failed for ${position.ticker}:`, error);
        path = path ?? { points: [], complete: false, fetchedAt: now.toISOString(), source: "unavailable", interval: "" };
      }
    }
    const input = legInput(position, path!.points);
    const analysis = analyzeLeg(input);
    return {
      positionId: position.id, ticker: position.ticker, side: position.side, strike: position.strike, entryPrice: position.entryUnderlyingPrice,
      entryAt: position.entryTimestamp, expiry: position.expiry, credit: position.estimatedEntryCredit, contracts: position.contracts,
      lines: { strike: position.strike, entry: position.entryUnderlyingPrice, breakeven: analysis.breakeven },
      points: path!.points, analysis, complete: path!.complete, fetchedAt: path!.fetchedAt, source: path!.source,
    };
  }));
}

export async function getPositionPath(basket: BasketData, positionId: string) {
  const paths = await getBasketLegPaths(basket);
  return paths.find((p) => p.positionId === positionId) ?? null;
}

// Cheap read of already-cached paths (no network), for the performance report.
export async function loadCachedPaths(ids: string[]) {
  const cached = await loadCached(ids);
  return new Map([...cached.entries()].map(([id, c]) => [id, c.points]));
}

