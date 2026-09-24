// Reconstruct a research snapshot for a moment no live option-chain snapshot
// survived. Underlying prices are REAL (Yahoo intraday bars at the requested
// time); option quotes are MODELED: Black-Scholes at each listed strike using
// the implied-volatility surface observed in the nearest surviving snapshots
// for the same ticker, scaled by the VIX ratio between then and now, with the
// observed bid/ask spread and volume carried over. Everything produced here is
// labelled synthetic so the basket built from it is published as
// `data_provenance: 'reconstructed'` and never mistaken for observed data.
import fs from 'node:fs';
import path from 'node:path';
import { createYahooClient } from './yahoo_client.mjs';
import { optionValue, optionDelta } from '../../shared/entry-pricing.mjs';
import { easternTime, sessionClose } from '../../shared/market-calendar.mjs';

const csvRow = vals => vals.map(v => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',');
export function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    const cells = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
      else if (c === '"') inQ = true; else if (c === ',') { cells.push(cur); cur = ''; } else cur += c;
    }
    cells.push(cur);
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
}
const num = x => { const n = Number(x); return Number.isFinite(n) ? n : null; };
function realizedVol(closes, w) {
  if (closes.length < w + 1) return null;
  const rets = [];
  for (let i = closes.length - w; i < closes.length; i++) if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1) * 252);
}
function rollingRV(closes, w) { const out = []; for (let i = w; i < closes.length; i++) out.push(realizedVol(closes.slice(i - w, i + 1), w)); return out.filter(v => v != null); }
function hvRank(series, cur) { if (!series.length || cur == null) return null; const mx = Math.max(...series), mn = Math.min(...series); return mx === mn ? null : (cur - mn) / (mx - mn) * 100; }
function atr14(hist) {
  if (hist.length < 15) return null;
  let s = 0, n = 0;
  for (let i = hist.length - 14; i < hist.length; i++) { const h = hist[i].high, l = hist[i].low, pc = hist[i - 1].close; if (h == null || l == null || pc == null) continue; s += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); n++; }
  return n ? s / n : null;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// Reference IV surfaces: { ticker -> { call: [{strike, iv, spread, volume, oi, moneyness}], put: [...] , spot, vix } }
export function loadReference(dir, chainFile) {
  const chains = readCsv(path.join(dir, chainFile));
  const summary = Object.fromEntries(readCsv(path.join(dir, 'chain_summary_v2.csv')).map(r => [r.ticker, r]));
  const macro = fs.existsSync(path.join(dir, 'macro_quotes.csv')) ? Object.fromEntries(readCsv(path.join(dir, 'macro_quotes.csv')).map(r => [r.ticker, r])) : {};
  const vix = num(macro['^VIX']?.price);
  const byTicker = {};
  for (const row of chains) {
    const spot = num(summary[row.ticker]?.price);
    if (!spot) continue;
    const t = byTicker[row.ticker] ??= { spot, vix, call: [], put: [] };
    const bid = num(row.bid), ask = num(row.ask), iv = num(row.iv);
    if (!iv || iv <= 0.01 || iv > 8) continue;
    t[row.type].push({ strike: num(row.strike), iv, spread: bid != null && ask != null && ask >= bid ? ask - bid : null, volume: num(row.volume) ?? 0, oi: num(row.oi) ?? 0, moneyness: Math.log(num(row.strike) / spot) });
  }
  return { dir, vix, byTicker };
}
// IV at a strike: interpolate the reference surface in log-moneyness space,
// then scale by the VIX ratio (sensitivity 1, the model's documented default).
function surfaceIv(points, moneyness) {
  const sorted = points.filter(p => p.iv).sort((a, b) => a.moneyness - b.moneyness);
  if (!sorted.length) return null;
  if (moneyness <= sorted[0].moneyness) return sorted[0].iv;
  if (moneyness >= sorted.at(-1).moneyness) return sorted.at(-1).iv;
  for (let i = 1; i < sorted.length; i++) {
    if (moneyness <= sorted[i].moneyness) {
      const a = sorted[i - 1], b = sorted[i], w = (moneyness - a.moneyness) / (b.moneyness - a.moneyness || 1);
      return a.iv + (b.iv - a.iv) * w;
    }
  }
  return sorted.at(-1).iv;
}
function nearest(points, strike) {
  let best = null;
  for (const p of points) if (!best || Math.abs(p.strike - strike) < Math.abs(best.strike - strike)) best = p;
  return best;
}

export async function synthesizeSnapshot({ OUT, expiry, asOf, universeTickers, references, quoteFields, vixNow, vixSensitivity = 1, rate = 0.043, priceMin = 8, priceMax = 100, concurrency = 3, log = console.log }) {
  const yf = createYahooClient();
  fs.mkdirSync(OUT, { recursive: true });
  const day = easternTime(asOf).date;
  const dayAfter = new Date(+new Date(`${day}T00:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10);
  const yearAgo = new Date(+asOf - 365 * 86400000).toISOString().slice(0, 10);
  // 1) real underlying prices at asOf
  log(`[synthetic] ${universeTickers.length} tickers: intraday underlying at ${asOf.toISOString()}`);
  const quotes = {};
  let done = 0;
  await mapLimit(universeTickers, concurrency, async ticker => {
    try {
      const chart = await yf.chart(ticker, { period1: day, period2: dayAfter, interval: '5m' });
      const bars = (chart.quotes ?? []).filter(q => q.close != null && +new Date(q.date) < +asOf && easternTime(new Date(q.date)).date === day);
      if (bars.length) quotes[ticker] = { price: bars.at(-1).close, observedAt: new Date(bars.at(-1).date).toISOString(), prevClose: chart.meta?.chartPreviousClose ?? null };
    } catch { /* unavailable: excluded from the universe */ }
    if (++done % 50 === 0) log(`[synthetic]   ${done}/${universeTickers.length}`);
    await sleep(60);
  });
  const rows = ['ticker,price,currency,exchange,market_cap,avg_volume,shares_outstanding,prev_close,fifty_two_wk_high,fifty_two_wk_low,eps_fwd,pe_fwd,name'];
  const filtered = [rows[0]];
  for (const ticker of universeTickers) {
    const q = quotes[ticker], f = quoteFields[ticker];
    if (!q || !f) continue;
    const refPrice = num(f.price), scale = refPrice ? q.price / refPrice : 1;
    const row = csvRow([ticker, q.price, f.currency ?? 'USD', f.exchange ?? '', num(f.market_cap) != null ? Math.round(num(f.market_cap) * scale) : '', f.avg_volume ?? '', f.shares_outstanding ?? '', q.prevClose ?? f.prev_close ?? '', f.fifty_two_wk_high ?? '', f.fifty_two_wk_low ?? '', f.eps_fwd ?? '', f.pe_fwd ?? '', f.name ?? '']);
    rows.push(row);
    if (q.price >= priceMin && q.price <= priceMax) filtered.push(row);
  }
  fs.writeFileSync(path.join(OUT, 'universe_quotes.csv'), rows.join('\n'));
  fs.writeFileSync(path.join(OUT, 'universe_8to40.csv'), filtered.join('\n'));
  fs.writeFileSync(path.join(OUT, 'weeklys_universe.csv'), ['ticker', ...universeTickers].join('\n'));
  log(`[synthetic] universe quotes ${rows.length - 1}, in band ${filtered.length - 1}`);
  // 2) modeled chains for the price-band names that have a reference surface
  const inBand = filtered.slice(1).map(r => r.split(',')[0]);
  const chainRows = ['ticker,strike,type,bid,ask,last,iv,volume,oi,delta_est,distance_pct,chain_received_at,underlying_observed_at'];
  const summaryRows = ['ticker,price,atm_iv,atm_iv_pct,hv20_now,hv20_min,hv20_max,hv_rank,atr14,call_otm_vol_total,put_otm_vol_total,best_call_strike_d18,best_call_credit,best_call_iv,best_put_strike_d18,best_put_credit,best_put_iv,mom1d_pct,mom3d_pct,mom10d_pct,chain_received_at,underlying_observed_at'];
  const T = Math.max((+sessionClose(expiry) - +asOf) / (365 * 86400000), 1 / (365 * 24));
  const doneTickers = [];
  let modeled = 0;
  await mapLimit(inBand, concurrency, async ticker => {
    const refs = references.map(r => r.byTicker[ticker]).filter(Boolean);
    if (!refs.length) return;
    const q = quotes[ticker];
    try {
      const hist = await yf.chart(ticker, { period1: yearAgo, period2: day, interval: '1d' });
      const bars = (hist.quotes ?? []).filter(b => b.close != null && new Date(b.date).toISOString().slice(0, 10) < day);
      const closes = bars.map(b => b.close);
      const ohlc = bars.filter(b => b.high != null && b.low != null).map(b => ({ high: b.high, low: b.low, close: b.close }));
      const hv20Series = rollingRV(closes, 20), hv20Now = realizedVol(closes, 20), rank = hvRank(hv20Series, hv20Now), atr = atr14(ohlc);
      const momPct = w => closes.length > w && closes.at(-1 - w) > 0 ? (q.price / closes.at(-1 - w) - 1) * 100 : null;
      const spot = q.price;
      let atmSum = 0, atmN = 0, bestCall = null, bestPut = null, cVol = 0, pVol = 0;
      for (const type of ['call', 'put']) {
        const strikes = [...new Set(refs.flatMap(r => r[type].map(p => p.strike)))].sort((a, b) => a - b);
        for (const strike of strikes) {
          const m = Math.log(strike / spot);
          const ivs = refs.map(r => { const iv = surfaceIv(r[type], m); return iv && r.vix && vixNow ? iv * (vixNow / r.vix) ** vixSensitivity : iv; }).filter(Boolean);
          if (!ivs.length) continue;
          const iv = ivs.reduce((a, b) => a + b, 0) / ivs.length;
          const near = refs.map(r => nearest(r[type], strike)).filter(Boolean);
          const spread = Math.max(0.01, +(near.filter(p => p.spread != null).reduce((a, p) => a + p.spread, 0) / Math.max(1, near.filter(p => p.spread != null).length) || 0.05).toFixed(2));
          const volume = Math.round(near.reduce((a, p) => a + p.volume, 0) / near.length), oi = Math.round(near.reduce((a, p) => a + p.oi, 0) / near.length);
          const mid = optionValue({ spot, strike, years: T, iv, rate, side: type });
          if (!(mid > 0.005)) continue;
          const bid = Math.max(0, +(mid - spread / 2).toFixed(2)), ask = +(bid + spread).toFixed(2);
          const delta = optionDelta({ spot, strike, years: T, iv, rate, side: type });
          const dist = (strike - spot) / spot * 100;
          chainRows.push(csvRow([ticker, strike, type, bid, ask, +mid.toFixed(2), iv, volume, oi, delta.toFixed(3), dist.toFixed(2), asOf.toISOString(), q.observedAt]));
          if (Math.abs(strike - spot) / spot < 0.03) { atmSum += iv; atmN++; }
          if (type === 'call' && strike > spot) cVol += volume;
          if (type === 'put' && strike < spot) pVol += volume;
          const quotedMid = (bid + ask) / 2;
          if (type === 'call' && delta >= 0.13 && delta <= 0.22 && quotedMid > 0.01 && bid > 0 && (!bestCall || Math.abs(delta - 0.18) < Math.abs(bestCall.delta - 0.18))) bestCall = { strike, mid: quotedMid, iv, delta };
          if (type === 'put' && delta <= -0.13 && delta >= -0.22 && quotedMid > 0.01 && bid > 0 && (!bestPut || Math.abs(Math.abs(delta) - 0.18) < Math.abs(Math.abs(bestPut.delta) - 0.18))) bestPut = { strike, mid: quotedMid, iv, delta };
        }
      }
      const atmIv = atmN ? atmSum / atmN : null;
      summaryRows.push(csvRow([ticker, spot, atmIv?.toFixed(4), atmIv ? (atmIv * 100).toFixed(1) : null, hv20Now?.toFixed(4),
        hv20Series.length ? Math.min(...hv20Series).toFixed(4) : null, hv20Series.length ? Math.max(...hv20Series).toFixed(4) : null,
        rank?.toFixed(1), atr?.toFixed(3), cVol, pVol, bestCall?.strike, bestCall?.mid?.toFixed(3), bestCall?.iv?.toFixed(4),
        bestPut?.strike, bestPut?.mid?.toFixed(3), bestPut?.iv?.toFixed(4), momPct(1)?.toFixed(1), momPct(3)?.toFixed(1), momPct(10)?.toFixed(1), asOf.toISOString(), q.observedAt]));
      doneTickers.push(ticker); modeled++;
    } catch (error) { log(`[synthetic]   ${ticker}: ${error.message}`); }
    await sleep(60);
  });
  fs.writeFileSync(path.join(OUT, `chains_${expiry}_v2.csv`), chainRows.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'chain_summary_v2.csv'), summaryRows.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, '_chains_state.json'), JSON.stringify({ done: doneTickers, errors: [], synthetic: true }));
  const manifest = { started_at: new Date(+asOf - 120000).toISOString(), completed_at: asOf.toISOString(), expiry, snapshot_schema: 2, synthetic: true,
    chains: { total: inBand.length, done: modeled, errors: 0, processed: modeled },
    reconstruction: { references: references.map(r => r.dir), vix_now: vixNow, vix_references: references.map(r => r.vix), method: 'Black-Scholes at listed strikes using the reference IV surface scaled by the VIX ratio; spreads and volumes carried from the references; underlying from Yahoo 5-minute bars' } };
  fs.writeFileSync(path.join(OUT, 'data_refresh.json'), JSON.stringify(manifest, null, 2));
  log(`[synthetic] modeled chains for ${modeled}/${inBand.length} in-band names`);
  return manifest;
}

// Macro quotes for asOf: intraday SPY/SPX/VIX, daily SKEW/MOVE, previous VIX close.
export async function synthesizeMacro({ OUT, asOf }) {
  const yf = createYahooClient();
  const day = easternTime(asOf).date;
  const dayAfter = new Date(+new Date(`${day}T00:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10);
  const intraday = async symbol => {
    const chart = await yf.chart(symbol, { period1: day, period2: dayAfter, interval: '5m' });
    const bars = (chart.quotes ?? []).filter(q => q.close != null && +new Date(q.date) < +asOf && easternTime(new Date(q.date)).date === day);
    if (!bars.length) throw new Error(`${symbol}: no intraday bar at ${asOf.toISOString()}`);
    return { price: bars.at(-1).close, observedAt: new Date(bars.at(-1).date).toISOString() };
  };
  const daily = async symbol => {
    const chart = await yf.chart(symbol, { period1: new Date(+asOf - 15 * 86400000).toISOString().slice(0, 10), period2: dayAfter, interval: '1d' });
    const bars = (chart.quotes ?? []).filter(q => q.close != null && new Date(q.date).toISOString().slice(0, 10) <= day);
    return { close: bars.at(-1).close, prevClose: bars.at(-2)?.close ?? null, date: new Date(bars.at(-1).date).toISOString().slice(0, 10) };
  };
  const [spy, spx, vix, vixD, skew, move] = await Promise.all([intraday('SPY'), intraday('^GSPC'), intraday('^VIX'), daily('^VIX'), daily('^SKEW'), daily('^MOVE')]);
  const rows = ['ticker,price,currency,exchange,market_time,prev_close,fifty_two_wk_high,fifty_two_wk_low',
    csvRow(['SPY', spy.price, 'USD', 'NYSEArca', spy.observedAt, '', '', '']), csvRow(['^GSPC', spx.price, 'USD', 'SNP', spx.observedAt, '', '', '']),
    csvRow(['^VIX', vix.price, 'USD', 'CBOE', vix.observedAt, vixD.date === day ? vixD.prevClose : vixD.close, '', '']),
    csvRow(['^SKEW', skew.close, 'USD', 'CBOE', `${skew.date}T20:00:00.000Z`, skew.prevClose, '', '']), csvRow(['^MOVE', move.close, 'USD', 'CBOE', `${move.date}T20:00:00.000Z`, move.prevClose, '', ''])];
  fs.writeFileSync(path.join(OUT, 'macro_quotes.csv'), rows.join('\n'));
  return { SPY: spy.price, SPX: spx.price, VIX: vix.price, VIX_prev: vixD.date === day ? vixD.prevClose : vixD.close, SKEW: skew.close, MOVE: move.close };
}
