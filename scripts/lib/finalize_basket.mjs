import { createYahooClient } from './yahoo_client.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { scanRadar } from './news_radar.mjs';
import { entrySchedule } from '../../shared/entry-schedule.mjs';
import { repriceEntry, pricingReference, optionDelta } from '../../shared/entry-pricing.mjs';
import { easternTime, sessionClose } from '../../shared/market-calendar.mjs';
import { minimumOtmFor, otmPercent } from '../../shared/strike-settings.mjs';
import { basketCounts, isExcluded } from '../../shared/broker-settings.mjs';
import { calculateGsrs } from '../../shared/gsrs.mjs';
import { fetchTvMacros } from './tv_macros.mjs';
import { refreshWeeklyUniverse, WEEKLYS_SOURCE } from './refresh.mjs';

export function preparationPolicy(settings) {
  const { executionHostId, twsHost, twsPort, twsClientId, webApiUrl, twsRestartTime, twsRestartTimezone, twsRestartGraceMinutes, pauseEntries, ...policy } = settings;
  void executionHostId; void twsHost; void twsPort; void twsClientId; void webApiUrl; void twsRestartTime; void twsRestartTimezone; void twsRestartGraceMinutes; void pauseEntries;
  return JSON.stringify(policy);
}
// Re-read authority at the side-effect boundary, not merely when a slow build
// starts. Delivery recovery preserves original prices but still belongs only to
// the currently selected computer.
export async function requireCurrentBasketAuthority(proposal, hostId, { loadSettings, deliveryOnly = false }) {
  const rejected = message => Object.assign(new Error(message), { code: 'BASKET_AUTHORITY_CHANGED' });
  let current;
  try { current = await loadSettings(); }
  catch { throw rejected('Current trading settings unavailable; retry on the next cycle'); }
  if (!hostId || current.executionHostId !== hostId) throw rejected('Execution computer changed or is not selected; this host cannot publish or deliver baskets');
  if (!deliveryOnly && proposal.preparation_policy !== preparationPolicy(current)) throw rejected('Trading settings changed during preparation; rebuild on the next cycle');
  return current;
}
export function requireFreshStock(q, now) {
  const age = +now - +new Date(q?.regularMarketTime);
  if (!Number.isFinite(q?.regularMarketPrice) || !(q.regularMarketPrice > 0) || !Number.isFinite(age) || age < -60000 || age > 20 * 60000 || easternTime(new Date(q.regularMarketTime)).date !== easternTime(now).date) throw new Error('Current-session stock quote unavailable; extended-hours prices are not an executable option quote');
  return q.regularMarketPrice;
}
export function preparationMatches(prepared, settings, week, now = new Date()) {
  if (!prepared || prepared.phase !== 'prepared' || prepared.basket_date !== week || prepared.preparation_policy !== preparationPolicy(settings) || prepared.expiry !== entrySchedule(week, settings).expiry || !prepared.picks?.length) return false;
  const age = +now - Date.parse(prepared.generated_ts);
  return Number.isFinite(age) && age >= -60000 && age <= 8 * 86400000;
}
// Preserve the exact proposal across an uncertain transaction result. A rebuild
// must never replace the artifact that may already be present in the database.
export function freezeFinalProposal(file, proposal) {
  if (proposal.phase !== 'final') throw new Error('Only a finalized basket can be frozen for publication');
  if (fs.existsSync(file)) {
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (JSON.stringify(previous) !== JSON.stringify(proposal)) throw new Error('Finalized basket is frozen; refusing to replace a potentially published proposal');
    return previous;
  }
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(proposal, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return proposal;
}
const requireAge = (timestamp, now, maximum, label) => {
  const age = +now - Date.parse(timestamp);
  if (!Number.isFinite(age) || age < -60000 || age > maximum) throw new Error(`${label} source is stale or unavailable`);
};
function requirePublication(date, now, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error(`${label} publication date unavailable`);
  const age = Date.parse(easternTime(now).date) - Date.parse(date);
  if (!Number.isFinite(age) || age < 0 || age > 7 * 86400000) throw new Error(`${label} publication is stale or unavailable`);
}
async function currentUniverse(OUT) {
  const metadata = await refreshWeeklyUniverse(OUT);
  return { ...metadata, tickers: fs.readFileSync(path.join(OUT, 'weeklys_universe.csv'), 'utf8').trim().split(/\r?\n/).slice(1) };
}
export async function finalizeBasket(prepared, settings, { OUT, client = createYahooClient(), radar = scanRadar, macros = fetchTvMacros, universe = currentUniverse, now, clock = () => now ?? new Date() } = {}) {
  const started = clock();
  if (!preparationMatches(prepared, settings, prepared.basket_date, started)) throw new Error('Preparation basket identity, age or trading settings changed; rebuild');
  const schedule = entrySchedule(prepared.basket_date, settings);
  const checkWindow = time => {
    if (schedule.skipped || +time >= +schedule.end || +time < +schedule.start - settings.finalizeLeadMinutes * 60000 || easternTime(time).date !== schedule.date) throw new Error('Outside the basket finalization window; late publication is prohibited');
  };
  checkWindow(started);
  const identities = prepared.picks.map(p => `${p.ticker}:${p.side}:${p.K}`);
  if (new Set(identities).size !== identities.length) throw new Error('Prepared basket contains duplicate option contracts');
  for (const pick of prepared.picks) pricingReference(pick, prepared);
  const names = Object.fromEntries(prepared.picks.map(p => [p.ticker, p.name ?? '']));
  const [macroQuotes, tv, news, weeklys, snapshots] = await Promise.all([
    client.quote(['SPY','^GSPC','^VIX','^SKEW','^MOVE']),
    macros({ OUT, BASKET_DATE: prepared.basket_date }),
    radar(prepared.picks.map(p => p.ticker), null, { names }),
    universe(OUT),
    Promise.all(prepared.picks.map(async p => {
      const [stock, chain, events] = await Promise.all([
        client.quote(p.ticker),
        client.options(p.ticker, { date: new Date(prepared.expiry) }).then(chain => ({ chain, receivedAt: clock().toISOString() })),
        client.quoteSummary(p.ticker, { modules: ['calendarEvents'] }),
      ]);
      return { stock, chain: chain.chain, receivedAt: chain.receivedAt, events };
    })),
  ]);
  const completed = clock();
  checkWindow(completed);
  const asOf = new Date(Math.max(+completed, +schedule.start));
  requireAge(tv.fetched_ts, completed, 20 * 60000, 'Macro download');
  if (tv.error || tv.basket_date !== prepared.basket_date) throw new Error('Macro refresh failed or belongs to a different basket');
  requirePublication(tv.hy_oas?.date, completed, 'HY OAS');
  requirePublication(tv.pc_ratio?.as_of, completed, 'Cboe put/call');
  requireAge(weeklys.fetched_at, completed, 6 * 3600000, 'Cboe weekly universe');
  if (weeklys.source !== WEEKLYS_SOURCE || !Array.isArray(weeklys.tickers) || prepared.picks.some(p => !weeklys.tickers.includes(p.ticker))) throw new Error('Selected ticker is absent from the current Cboe weekly universe');
  const bySymbol = Object.fromEntries(macroQuotes.map(q => [q.symbol, q]));
  const VIX = requireFreshStock(bySymbol['^VIX'], completed);
  for (const symbol of ['SPY', '^GSPC']) requireFreshStock(bySymbol[symbol], completed);
  for (const symbol of ['^SKEW', '^MOVE']) {
    const observed = new Date(bySymbol[symbol]?.regularMarketTime);
    if (!Number.isFinite(+observed)) throw new Error(`${symbol} source date unavailable`);
    requirePublication(easternTime(observed).date, completed, symbol);
  }
  const macro = { SPY: bySymbol.SPY?.regularMarketPrice, SPX: bySymbol['^GSPC']?.regularMarketPrice, VIX, VIX_prev: bySymbol['^VIX']?.regularMarketPreviousClose,
    SKEW: bySymbol['^SKEW']?.regularMarketPrice, MOVE: bySymbol['^MOVE']?.regularMarketPrice, HY_OAS: tv.hy_oas?.value, PC: tv.pc_ratio?.total };
  if (!Object.values(macro).every(v => Number.isFinite(v) && v > 0)) throw new Error('Final basket macro data unavailable');
  const score = calculateGsrs(macro);
  const counts = basketCounts(settings, prepared.picks.filter(p => p.side === 'call').length, prepared.picks.filter(p => p.side === 'put').length);
  if (counts.total !== prepared.picks.length || score.score >= 5 && counts.puts) throw new Error('Prepared basket no longer satisfies the allocation/GSRS rules; rebuild');
  const scale = (score.score >= 3 && counts.puts ? .5 : 1) * (prepared.picks.some(p => p.frenzy === 'elevated') ? .5 : 1);
  const capital = prepared.model_equity * settings.entryCapitalPct / 100 * scale / counts.total;
  if (!Number.isFinite(capital) || capital <= 0) throw new Error('Equal allocation capital is unavailable');
  const picks = prepared.picks.map((p, index) => {
    if (isExcluded(p, settings) || news[p.ticker]?.error || !Array.isArray(news[p.ticker]?.[p.side]) || news[p.ticker][p.side].length) throw new Error(`${p.ticker}: exclusions/news changed; rebuild basket`);
    requireAge(news[p.ticker].checked_at, completed, 15 * 60000, `${p.ticker} news`);
    const { stock, chain, receivedAt, events } = snapshots[index];
    requireAge(receivedAt, completed, 20 * 60000, `${p.ticker} option chain`);
    const spot = requireFreshStock(stock, completed);
    const earnings = events.calendarEvents?.earnings?.earningsDate;
    if (!Array.isArray(earnings) || !earnings.length || earnings.some(d => !Number.isFinite(+new Date(d)) || new Date(d).toISOString().slice(0,10) <= prepared.expiry)) throw new Error(`${p.ticker}: earnings are unknown or conflict with the holding period`);
    const series = chain.options?.find(o => new Date(o.expirationDate).toISOString().slice(0,10) === prepared.expiry);
    const option = series?.[p.side === 'call' ? 'calls' : 'puts']?.find(o => o.strike === p.K);
    if (!Number.isFinite(option?.bid) || !Number.isFinite(option?.ask) || !(option.bid > 0) || !(option.ask >= option.bid) || option.ask - option.bid > settings.maxEntrySpread) throw new Error(`${p.ticker}: exact option market unavailable or too wide`);
    const reference = pricingReference(p, prepared);
    const pricing = repriceEntry({ reference, spot, optionIv: option.impliedVolatility, vix: VIX, now: asOf, settings });
    const delta = optionDelta({ spot, strike: p.K, years: (+sessionClose(prepared.expiry) - +asOf) / (365 * 86400000), iv: pricing.iv, rate: settings.modelRiskFreeRatePct / 100, side: p.side });
    if (!Number.isFinite(p.atr) || p.atr <= 0) throw new Error(`${p.ticker}: ATR reference unavailable`);
    const buffer = (p.side === 'call' ? p.K - spot : spot - p.K) / p.atr;
    if (Math.abs(delta) < .15 || Math.abs(delta) > .20 || buffer < (p.side === 'put' ? 2 : 1) || otmPercent(p.side, p.K, spot) + 1e-9 < minimumOtmFor(settings, p.ticker, p.side, prepared.expiry) || pricing.credit < .1) throw new Error(`${p.ticker}: final strike/credit no longer qualifies; rebuild`);
    const contracts = Math.floor(capital / (Math.max(spot, p.K) * 100));
    if (!Number.isSafeInteger(contracts) || contracts < 1) throw new Error(`${p.ticker}: final price exceeds its equal allocation`);
    const otm = Math.max(0, p.side === 'call' ? p.K - spot : spot - p.K);
    const marginPer = Math.max((.2 * spot - otm) * 100, .1 * p.K * 100) + pricing.credit * 100;
    return { ...p, px: spot, iv: pricing.iv, delta, buf: buffer, cr: +pricing.credit.toFixed(4), contracts,
      credit: Math.round(contracts * pricing.credit * 100), margin: Math.round(contracts * marginPer),
      bid: option.bid, ask: option.ask, spread: option.ask - option.bid, entry_otm_pct: otmPercent(p.side, p.K, spot),
      pricing_reference: reference, entry_pricing: pricing, pricing_basis: 'dated model adjusted for time, current underlying and IV; actual entry requires an IB fill',
      quote_observed_at: receivedAt, quote_timestamp_basis: 'Yahoo chain response received; exchange bid/ask timestamp unavailable', underlying_observed_at: new Date(stock.regularMarketTime).toISOString(),
      news_checked_at: news[p.ticker].checked_at,
      allocated_capital: capital, capital_backing: contracts * Math.max(spot, p.K) * 100,
      credit_at_bid: Math.round(contracts * option.bid * 100), midpoint_to_bid_cost: Math.round(contracts * ((option.bid + option.ask) / 2 - option.bid) * 100),
    };
  });
  const observedAt = new Date(Math.min(...picks.flatMap(p => [Date.parse(p.quote_observed_at), Date.parse(p.underlying_observed_at)]), +new Date(bySymbol['^VIX'].regularMarketTime))).toISOString();
  return { ...prepared, phase: 'final', entry_timestamp: asOf.toISOString(), entry_date: schedule.date,
    entry_window: { start: schedule.start.toISOString(), end: schedule.end.toISOString() },
    generated_ts: completed.toISOString(), data_observed_at: observedAt, finalized_at: completed.toISOString(),
    finalization_started_at: started.toISOString(), weeklys_universe_source: { source: weeklys.source, fetched_at: weeklys.fetched_at, count: weeklys.tickers.length },
    tv_macros_source: { hy_oas: `FRED:BAMLH0A0HYM2 ${tv.hy_oas.date}`, pc: `CBOE ${tv.pc_ratio.as_of}`, fetched_at: tv.fetched_ts },
    allocation_scale: scale, allocation_settings: settings, macro, gsrs: score.score, gsrs_components: score.components, gsrs_calculation: score,
    total_backing_capital: capital * counts.total, picks,
    totals: picks.reduce((t, p) => { t[p.side === 'call' ? 'callCredit' : 'putCredit'] += p.credit; t[p.side === 'call' ? 'callMargin' : 'putMargin'] += p.margin; return t; }, { callCredit: 0, putCredit: 0, callMargin: 0, putMargin: 0 }),
  };
}
