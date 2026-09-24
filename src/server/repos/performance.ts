import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { basketMetrics, baskets, performanceSnapshots, positions } from "@/db/schema";
import { getModelSettings, type ModelSettings } from "@/server/services/model-settings";
import {
  computeModelPerformance,
  resizeLeg,
  type ModelPerformance,
  type PerformanceBasis,
  type PerformanceLegSource,
  type PerformanceStats,
  type PerformanceWeekSource,
  type SettledLeg,
  type WeeklyPerformance,
} from "@/lib/model-sizing";
import { asNumber, asIsoString } from "./helpers";

export { resizeLeg };
export type { ModelPerformance, PerformanceBasis, PerformanceLegSource, PerformanceStats, PerformanceWeekSource, SettledLeg, WeeklyPerformance };

const SETTLED_STATES = ["expired-otm", "expired-itm", "manually-closed"] as const;

export interface PerformanceReport extends ModelPerformance {
  // The published legs and their outcomes, so a client can re-size the whole
  // track record locally (the sliders on the performance page and in the app)
  // with computeModelPerformance and get exactly what the server would return.
  source: PerformanceWeekSource[];
}

export interface PerformanceOptions {
  sizing?: "model" | "published";
  model?: ModelSettings;
}

// The published legs of every basket with their settled outcomes — the input
// to computeModelPerformance under any sizing policy.
export async function loadPerformanceSource(): Promise<PerformanceWeekSource[] | null> {
  if (!db) return null;
  const basketRows = await db.select().from(baskets);
  if (basketRows.length === 0) return null;
  const metricRows = await db.select({ basketId: basketMetrics.basketId, otherMetrics: basketMetrics.otherMetrics }).from(basketMetrics);
  const scaleByBasket = new Map(metricRows.map((m) => [m.basketId, Number((m.otherMetrics as { allocation_scale?: unknown } | null)?.allocation_scale ?? 1) || 1]));
  const positionRows = await db.select().from(positions);
  const settledRows = await db.select().from(performanceSnapshots).where(inArray(performanceSnapshots.state, [...SETTLED_STATES]));

  // Latest settled snapshot wins per position.
  const settledByPosition = new Map<string, (typeof settledRows)[number]>();
  for (const snap of settledRows) {
    const existing = settledByPosition.get(snap.positionId);
    // A model exit (manually-closed) is final; a later expiry settlement never overrides it.
    const outranks = !existing || (snap.state === "manually-closed" && existing.state !== "manually-closed") ||
      (existing.state !== "manually-closed" && new Date(snap.observedAt) > new Date(existing.observedAt));
    if (outranks) settledByPosition.set(snap.positionId, snap);
  }

  const positionsByBasket = new Map<string, (typeof positionRows)[number][]>();
  for (const row of positionRows) {
    const list = positionsByBasket.get(row.basketId) ?? [];
    list.push(row);
    positionsByBasket.set(row.basketId, list);
  }

  const source: PerformanceWeekSource[] = [];
  for (const basket of basketRows) {
    const legs: PerformanceLegSource[] = (positionsByBasket.get(basket.id) ?? []).map((position) => {
      const snap = settledByPosition.get(position.id);
      return {
        positionId: position.id, ticker: position.ticker, side: position.side, strike: asNumber(position.strike),
        entryPrice: asNumber(position.entryUnderlyingPrice), entryCredit: asNumber(position.estimatedEntryCredit),
        contracts: position.contracts, margin: position.margin,
        credit: Math.round(asNumber(position.estimatedEntryCredit) * 100 * position.contracts),
        pnl: snap ? asNumber(snap.pnlAmount) : null, state: snap?.state ?? null, settledAt: snap ? asIsoString(snap.observedAt) : null,
        expiryPrice: snap ? asNumber(snap.underlyingPrice) : null,
      };
    });
    if (legs.length === 0) continue;
    source.push({
      weekOf: typeof basket.weekOf === "string" ? basket.weekOf : asIsoString(basket.weekOf).slice(0, 10),
      slug: basket.slug, title: basket.title, gsrs: asNumber(basket.gsrs), cashNeeded: basket.cashNeeded,
      allocationScale: scaleByBasket.get(basket.id) ?? 1, legs,
    });
  }
  source.sort((a, b) => a.weekOf.localeCompare(b.weekOf));
  return source;
}

// Settled-performance report across every basket. "Modeled" throughout:
// entries at the recommended credit, held to expiry, no stops,
// no early profit-taking — the raw quality of the recommendations, not a
// record of executed trades. Sized from the model settings unless asked for
// the published contracts.
export async function getPerformanceReport(options: PerformanceOptions = {}): Promise<PerformanceReport | null> {
  const source = await loadPerformanceSource();
  if (!source) return null;
  const sizing = options.sizing ?? "model";
  const model = sizing === "model" ? options.model ?? (await getModelSettings()) : null;
  return { ...computeModelPerformance(source, model), source };
}
