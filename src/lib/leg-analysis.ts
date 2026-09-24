// Per-leg analytics for a short option against the underlying's price path:
// how much cushion the model bought, how close price came to the strike, what
// it closed at on expiry, and — for a leg that expired in the money — a
// post-mortem of what went wrong and what would have kept it out of the money.
// Pure: the server computes it once and ships the result to the web page and
// the app, which only render it.

export interface PricePoint {
  t: string; // ISO timestamp of the bar
  p: number; // close of the bar
  h?: number; // bar high (when the source has it)
  l?: number; // bar low
}

export interface LegSnapshot {
  observedAt: string;
  underlyingPrice: number;
  pnlAmount: number;
  state: string;
  confidence: string;
}

export interface LegInput {
  ticker: string;
  side: "call" | "put";
  strike: number;
  entryPrice: number; // underlying at entry
  entryAt: string;
  expiry: string; // YYYY-MM-DD
  credit: number; // per share, e.g. 0.42
  contracts: number;
  margin: number;
  atr: number | null;
  delta: number | null;
  points: PricePoint[]; // regular-session bars from entry to expiry (or now)
  expiryPrice: number | null; // settlement price used for P&L (null while open)
  settledState: string | null; // expired-otm | expired-itm | manually-closed | null
  settledPnl: number | null; // at the published contracts
  snapshots: LegSnapshot[]; // hourly model snapshots during the week
  exitPrice?: number | null; // manual/model exit underlying price when exited early
  exitAt?: string | null;
  radarHit?: { title: string; at: string } | null;
}

export interface LegAlternative {
  label: string;
  detail: string;
  pnl: number | null; // what the leg would have made at the published contracts, when computable
}

export interface LegAnalysis {
  outcome: "otm" | "itm" | "exited" | "open";
  breakeven: number;
  cushionPct: number; // % the underlying had to move to reach the strike at entry
  cushionAtr: number | null; // the same cushion in ATRs
  expiryPrice: number | null;
  movePct: number | null; // underlying move entry → expiry (or last)
  lastPrice: number | null;
  closestPrice: number | null; // worst excursion toward/through the strike
  closestAt: string | null;
  closestPct: number | null; // % of cushion consumed at the worst point (>100 = through the strike)
  firstBreachAt: string | null; // first bar through the strike
  breachedSessions: number; // sessions that closed through the strike
  intrinsicAtExpiry: number | null; // per share
  creditCapturePct: number | null; // P&L as % of credit collected (100 = kept it all)
  returnOnMarginPct: number | null;
  postMortem: { summary: string; findings: string[]; alternatives: LegAlternative[] } | null;
}

const pct = (n: number) => `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(1)}%`;
const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const px = (n: number) => `$${n.toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Signed distance from price to the strike in the direction that hurts a short
// option: positive = still out of the money.
function cushion(side: "call" | "put", strike: number, price: number) {
  return side === "call" ? strike - price : price - strike;
}

// Sessions (ET dates) whose last bar closed through the strike.
function sessionsThrough(points: PricePoint[], side: "call" | "put", strike: number) {
  const lastBySession = new Map<string, PricePoint>();
  for (const p of points) lastBySession.set(new Date(p.t).toLocaleDateString("en-CA", { timeZone: "America/New_York" }), p);
  return [...lastBySession.values()].filter((p) => cushion(side, strike, p.p) < 0).length;
}

export function analyzeLeg(leg: LegInput): LegAnalysis {
  const { side, strike, entryPrice, credit } = leg;
  const breakeven = side === "call" ? strike + credit : strike - credit;
  const cushionAtEntry = cushion(side, strike, entryPrice);
  const cushionPct = entryPrice > 0 ? (cushionAtEntry / entryPrice) * 100 : 0;
  const cushionAtr = leg.atr && leg.atr > 0 ? cushionAtEntry / leg.atr : null;

  const points = [...leg.points].sort((a, b) => a.t.localeCompare(b.t));
  const lastPoint = points.at(-1) ?? null;
  const exited = leg.settledState === "manually-closed" || (leg.exitPrice != null && leg.exitAt != null);
  const finalPrice = leg.expiryPrice ?? (exited ? leg.exitPrice ?? null : null);
  const lastPrice = finalPrice ?? lastPoint?.p ?? null;
  const movePct = lastPrice != null && entryPrice > 0 ? ((lastPrice - entryPrice) / entryPrice) * 100 : null;

  // Worst excursion: use bar extremes when present, closes otherwise, and the
  // settlement price itself so an expiry through the strike always counts.
  let closest: { price: number; at: string } | null = null;
  const consider = (price: number, at: string) => {
    if (!Number.isFinite(price)) return;
    if (!closest || cushion(side, strike, price) < cushion(side, strike, closest.price)) closest = { price, at };
  };
  for (const p of points) consider(side === "call" ? (p.h ?? p.p) : (p.l ?? p.p), p.t);
  for (const s of leg.snapshots) consider(s.underlyingPrice, s.observedAt);
  if (finalPrice != null) consider(finalPrice, leg.exitAt ?? `${leg.expiry}T20:00:00Z`);
  const closestRef = closest as { price: number; at: string } | null;
  const closestPct = closestRef && cushionAtEntry > 0 ? ((cushionAtEntry - cushion(side, strike, closestRef.price)) / cushionAtEntry) * 100 : null;

  const firstBreach = points.find((p) => cushion(side, strike, side === "call" ? (p.h ?? p.p) : (p.l ?? p.p)) < 0)
    ?? leg.snapshots.find((s) => cushion(side, strike, s.underlyingPrice) < 0);
  const firstBreachAt = firstBreach ? ("t" in firstBreach ? firstBreach.t : firstBreach.observedAt) : (finalPrice != null && cushion(side, strike, finalPrice) < 0 ? `${leg.expiry}T20:00:00Z` : null);

  const intrinsic = leg.expiryPrice != null ? Math.max(0, -cushion(side, strike, leg.expiryPrice)) : null;
  const outcome: LegAnalysis["outcome"] = leg.settledState === "expired-itm" ? "itm" : leg.settledState === "expired-otm" ? "otm" : exited ? "exited" : "open";
  const creditTotal = credit * 100 * leg.contracts;
  const creditCapturePct = leg.settledPnl != null && creditTotal > 0 ? (leg.settledPnl / creditTotal) * 100 : null;
  const returnOnMarginPct = leg.settledPnl != null && leg.margin > 0 ? (leg.settledPnl / leg.margin) * 100 : null;

  let postMortem: LegAnalysis["postMortem"] = null;
  if (outcome === "itm" && leg.expiryPrice != null && intrinsic != null) {
    postMortem = buildPostMortem(leg, { breakeven, cushionAtEntry, cushionPct, cushionAtr, intrinsic, closest: closestRef, firstBreachAt, points, creditTotal });
  }

  return {
    outcome, breakeven: +breakeven.toFixed(2), cushionPct: +cushionPct.toFixed(2), cushionAtr: cushionAtr != null ? +cushionAtr.toFixed(2) : null,
    expiryPrice: leg.expiryPrice, movePct: movePct != null ? +movePct.toFixed(2) : null, lastPrice,
    closestPrice: closestRef ? +closestRef.price.toFixed(4) : null, closestAt: closestRef?.at ?? null, closestPct: closestPct != null ? +closestPct.toFixed(1) : null,
    firstBreachAt, breachedSessions: sessionsThrough(points, side, strike),
    intrinsicAtExpiry: intrinsic != null ? +intrinsic.toFixed(2) : null,
    creditCapturePct: creditCapturePct != null ? +creditCapturePct.toFixed(1) : null,
    returnOnMarginPct: returnOnMarginPct != null ? +returnOnMarginPct.toFixed(2) : null,
    postMortem,
  };
}

function buildPostMortem(leg: LegInput, ctx: { breakeven: number; cushionAtEntry: number; cushionPct: number; cushionAtr: number | null; intrinsic: number; closest: { price: number; at: string } | null; firstBreachAt: string | null; points: PricePoint[]; creditTotal: number }) {
  const { side, strike, entryPrice, credit, contracts, atr } = leg;
  const expiryPrice = leg.expiryPrice as number;
  const sideWord = side === "call" ? "above" : "below";
  const movePct = ((expiryPrice - entryPrice) / entryPrice) * 100;
  const moveAtr = atr && atr > 0 ? Math.abs(expiryPrice - entryPrice) / atr : null;
  const loss = leg.settledPnl ?? (credit - ctx.intrinsic) * 100 * contracts;
  const findings: string[] = [];
  const alternatives: LegAlternative[] = [];

  findings.push(`${leg.ticker} was ${px(entryPrice)} at entry with the ${px(strike)} strike ${pct(ctx.cushionPct)} away${ctx.cushionAtr != null ? ` (${ctx.cushionAtr.toFixed(1)}× ATR)` : ""}${leg.delta != null ? `, |Δ| ${Math.abs(leg.delta).toFixed(2)}` : ""}. It settled at ${px(expiryPrice)}, ${pct(Math.abs(movePct))} ${side === "call" ? "higher" : "lower"}${moveAtr != null ? ` — a ${moveAtr.toFixed(1)}× ATR move` : ""}, ${px(ctx.intrinsic)} ${sideWord} the strike.`);
  findings.push(`Loss = intrinsic ${px(ctx.intrinsic)} − credit ${px(credit)} = ${px(ctx.intrinsic - credit)} per share × ${contracts} contract${contracts === 1 ? "" : "s"} = ${usd(loss)}. The trade only loses beyond the breakeven of ${px(ctx.breakeven)}.`);
  if (ctx.firstBreachAt) findings.push(`Price first traded through the strike ${when(ctx.firstBreachAt)} ET${ctx.closest ? `; the worst print was ${px(ctx.closest.price)} on ${day(ctx.closest.at)}` : ""}.`);

  // Gap or grind? Compare each session's open with the previous session's close.
  const sessions = new Map<string, PricePoint[]>();
  for (const p of ctx.points) {
    const d = new Date(p.t).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    sessions.set(d, [...(sessions.get(d) ?? []), p]);
  }
  const ordered = [...sessions.entries()].sort(([a], [b]) => a.localeCompare(b));
  let biggestGap: { date: string; gap: number } | null = null;
  for (let i = 1; i < ordered.length; i++) {
    const prevClose = ordered[i - 1][1].at(-1)!.p, open = ordered[i][1][0].p;
    const gap = side === "call" ? open - prevClose : prevClose - open;
    if (!biggestGap || gap > biggestGap.gap) biggestGap = { date: ordered[i][0], gap };
  }
  const gapped = biggestGap != null && atr != null && atr > 0 && biggestGap.gap > 1.5 * atr;
  if (gapped && biggestGap) {
    findings.push(`The damage came in a gap: ${leg.ticker} opened ${px(biggestGap.gap)} (${(biggestGap.gap / (atr as number)).toFixed(1)}× ATR) ${side === "call" ? "higher" : "lower"} on ${day(`${biggestGap.date}T16:00:00Z`)}. No intraday stop could have avoided a move that happened between sessions; only a wider strike, smaller size or a news/earnings filter changes this outcome.`);
  } else if (ctx.points.length > 0) {
    findings.push(`The move was a grind rather than a gap${ordered.length ? ` (${sessionsThroughCount(ctx.points, side, strike)} of ${ordered.length} sessions closed through the strike)` : ""}, so there was time to act on the strike-watch warning.`);
  }
  if (leg.radarHit) findings.push(`The news radar flagged "${leg.radarHit.title}" on ${day(leg.radarHit.at)}, but it did not qualify as an exit signal.`);
  else findings.push("The news radar had no qualifying signal on this name during the week, so the policy (hold to expiry, exit only on a radar trigger) held the position through the move.");

  // 1. The strike that would have survived.
  const survivingStrike = side === "call" ? Math.ceil((expiryPrice + 0.01) * 2) / 2 : Math.floor((expiryPrice - 0.01) * 2) / 2;
  const neededPct = (cushion(side, survivingStrike, entryPrice) / entryPrice) * 100;
  const neededAtr = atr && atr > 0 ? cushion(side, survivingStrike, entryPrice) / atr : null;
  alternatives.push({
    label: `Strike ${px(survivingStrike)} instead of ${px(strike)}`,
    detail: `A strike ${pct(neededPct)} out of the money at entry${neededAtr != null ? ` (${neededAtr.toFixed(1)}× ATR)` : ""} would have expired worthless. The model's delta band (|Δ| 0.15–0.20) picked ${pct(ctx.cushionPct)}; a minimum-OTM setting of ${Math.ceil(neededPct)}% for ${leg.ticker} ${side}s, or a wider ATR buffer, would have forced it — at a smaller credit.`,
    pnl: null,
  });

  // 2. Exit on the first breach (snapshot-based when the model observed one).
  const breachSnap = leg.snapshots.find((s) => s.state === "breached" || cushion(side, strike, s.underlyingPrice) < 0);
  if (breachSnap) {
    alternatives.push({
      label: `Exit when the strike was first breached (${when(breachSnap.observedAt)} ET)`,
      detail: `The model's snapshot marked the position at ${usd(breachSnap.pnlAmount)} then; closing there instead of holding would have changed the leg's result by ${usd(breachSnap.pnlAmount - loss)}.`,
      pnl: Math.round(breachSnap.pnlAmount),
    });
  } else if (ctx.firstBreachAt && !gapped) {
    alternatives.push({ label: `Exit at the first close through the strike (${when(ctx.firstBreachAt)} ET)`, detail: `Buying the option back near intrinsic at that point would have cost roughly the remaining time value; the loss would have been a fraction of ${usd(loss)}. No model snapshot exists for that moment, so the exact mark is not recorded.`, pnl: null });
  }

  // 3. Loss limit at 25% of the leg's margin.
  const limitSnap = leg.snapshots.find((s) => s.pnlAmount <= -0.25 * leg.margin);
  if (limitSnap && limitSnap.pnlAmount > loss) {
    alternatives.push({ label: `Automatic exit at −25% of allocation (${when(limitSnap.observedAt)} ET)`, detail: `The adverse-move heads-up fired at ${usd(limitSnap.pnlAmount)}; an automatic exit there would have saved ${usd(limitSnap.pnlAmount - loss)}. The IB account's per-ticker loss limit does this; the model holds to expiry.`, pnl: Math.round(limitSnap.pnlAmount) });
  }

  // 4. Size.
  alternatives.push({ label: "Half the margin available", detail: `Contracts scale with margin available: at half the setting the same trade would have lost about ${usd(loss / 2)}. Sizing changes the dollar loss, not whether the leg expires in the money.`, pnl: Math.round(loss / 2) });

  // 5. Skip the side when the regime says so.
  if (side === "put") alternatives.push({ label: "No puts in this regime", detail: "GSRS of 5 or more blocks new puts; a lower threshold, or sell-puts off in the model settings, would have removed this leg (and the credit of every put that expired worthless).", pnl: 0 });

  const summary = gapped
    ? `Gap through the strike: ${leg.ticker} moved ${pct(Math.abs(movePct))} in ${side === "call" ? "an upside" : "a downside"} gap${moveAtr != null ? ` (${moveAtr.toFixed(1)}× ATR)` : ""}; the ${pct(ctx.cushionPct)} cushion was not enough and no intraday exit could have helped.`
    : `${leg.ticker} ground ${pct(Math.abs(movePct))} ${side === "call" ? "higher" : "lower"} through a ${pct(ctx.cushionPct)} cushion${moveAtr != null ? ` (${moveAtr.toFixed(1)}× ATR)` : ""}; held to expiry under policy, the leg lost ${usd(loss)} against ${usd(ctx.creditTotal)} of credit.`;
  return { summary, findings, alternatives };
}

function sessionsThroughCount(points: PricePoint[], side: "call" | "put", strike: number) {
  return sessionsThrough(points, side, strike);
}
