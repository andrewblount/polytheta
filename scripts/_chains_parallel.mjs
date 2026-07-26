// Parallel chain fetcher — companion to run_weekly_refresh.mjs step 3.
// Processes all tickers in universe_8to40.csv concurrently (bounded)
// and writes chains_<expiry>_v2.csv + chain_summary_v2.csv.
//
// Run:  node scripts/_chains_parallel.mjs [basket_date]
// If basket_date omitted, derives next Monday from today.

import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function nextFriday(d) {
  const out = new Date(d);
  const day = out.getUTCDay();
  const add = (5 - day + 7) % 7 || 7;
  out.setUTCDate(out.getUTCDate() + add);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}
function nextMonday(d) {
  const out = new Date(d);
  const day = out.getUTCDay();
  const add = (1 - day + 7) % 7 || 7;
  out.setUTCDate(out.getUTCDate() + add);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

const argBasket = process.argv[2];
const today = new Date();
const BASKET_DATE = argBasket ?? nextMonday(today).toISOString().slice(0, 10);
const EXPIRY_ISO = nextFriday(today).toISOString().slice(0, 10);

const OUT = path.join(REPO_ROOT, 'baskets', BASKET_DATE, 'data');
if (!fs.existsSync(OUT)) {
  console.error(`no out dir ${OUT}`);
  process.exit(1);
}
const ffile = path.join(OUT, 'universe_8to40.csv');
if (!fs.existsSync(ffile)) {
  console.error(`no universe_8to40.csv in ${OUT}`);
  process.exit(1);
}

const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

function csvRow(vals) {
  return vals
    .map((v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}
function ncdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
    a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}
function bsDelta(S, K, T, r, sigma, type) {
  if (T <= 0 || sigma <= 0) return type === 'call' ? (S > K ? 1 : 0) : S < K ? -1 : 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return type === 'call' ? ncdf(d1) : ncdf(d1) - 1;
}
function realizedVol(closes, window) {
  if (closes.length < window + 1) return null;
  const rets = [];
  for (let i = closes.length - window; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 252);
}
function rollingRV(closes, window) {
  const out = [];
  for (let i = window; i < closes.length; i++) {
    const sub = closes.slice(i - window, i + 1);
    out.push(realizedVol(sub, window));
  }
  return out.filter((v) => v != null);
}
function hvRank(rvSeries, currentRV) {
  if (!rvSeries.length || currentRV == null) return null;
  const mn = Math.min(...rvSeries), mx = Math.max(...rvSeries);
  if (mx === mn) return null;
  return ((currentRV - mn) / (mx - mn)) * 100;
}
function atr14(history) {
  if (history.length < 15) return null;
  let trSum = 0, n = 0;
  for (let i = history.length - 14; i < history.length; i++) {
    const h = history[i].high, l = history[i].low, pc = history[i - 1].close;
    if (h == null || l == null || pc == null) continue;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trSum += tr; n++;
  }
  return n ? trSum / n : null;
}

const filtered = fs.readFileSync(ffile, 'utf8').trim().split(/\r?\n/);
const header = filtered[0].split(',');
const tickerIdx = header.indexOf('ticker');
const priceIdx = header.indexOf('price');
const tickers = filtered
  .slice(1)
  .map((l) => {
    const cells = l.split(',');
    return { ticker: cells[tickerIdx], price: parseFloat(cells[priceIdx]) };
  })
  .filter((t) => t.ticker && Number.isFinite(t.price));
console.log(`[chains] tickers: ${tickers.length} expiry=${EXPIRY_ISO}`);

const now = new Date();
const histStart = new Date(now.getTime() - 365 * 86400 * 1000);
const expiryDate = new Date(EXPIRY_ISO + 'T00:00:00Z');
const T = Math.max((expiryDate.getTime() - now.getTime()) / (365 * 86400 * 1000), 1 / 365);
const r = 0.043;

async function processTicker({ ticker, price }) {
  const hist = await yf.chart(ticker, { period1: histStart, period2: now, interval: '1d' });
  const closes = hist.quotes.map((q) => q.close).filter((c) => c != null && c > 0);
  const ohlc = hist.quotes
    .filter((q) => q.high != null && q.low != null && q.close != null)
    .map((q) => ({ high: q.high, low: q.low, close: q.close }));
  const hv20Series = rollingRV(closes, 20);
  const hv20Now = realizedVol(closes, 20);
  const rank = hvRank(hv20Series, hv20Now);
  const atr = atr14(ohlc);

  let chain;
  try {
    chain = await yf.options(ticker, { date: expiryDate });
  } catch {
    chain = null;
  }
  if (!chain) {
    const all = await yf.options(ticker);
    const expirations = (all?.expirationDates ?? []).map((d) => new Date(d));
    const target = expirations.find(
      (d) => Math.abs(d.getTime() - expiryDate.getTime()) < 86400000 * 2
    );
    if (target) chain = await yf.options(ticker, { date: target });
  }
  if (!chain || !chain.options || !chain.options.length) throw new Error('no chain');

  const calls = chain.options[0].calls ?? [];
  const puts = chain.options[0].puts ?? [];

  const rowsOut = [];
  let atmIvSum = 0, atmIvN = 0;
  let bestCall = null, bestPut = null;
  let callOtmVolSum = 0, putOtmVolSum = 0;

  for (const c of calls) {
    const iv = c.impliedVolatility;
    const delta = iv ? bsDelta(price, c.strike, T, r, iv, 'call') : null;
    const dist = ((c.strike - price) / price) * 100;
    const mid = c.bid != null && c.ask != null ? (c.bid + c.ask) / 2 : c.lastPrice ?? null;
    rowsOut.push(csvRow([
      ticker, c.strike, 'call', c.bid, c.ask, c.lastPrice, iv, c.volume,
      c.openInterest, delta?.toFixed(3), dist.toFixed(2),
    ]));
    if (Math.abs(c.strike - price) / price < 0.03 && iv) { atmIvSum += iv; atmIvN++; }
    if (c.strike > price) callOtmVolSum += c.volume ?? 0;
    // Require a tradable two-sided market: bid > 0 (ask-only quotes are not fillable at the mid)
    if (
      delta != null && delta >= 0.13 && delta <= 0.22 &&
      mid != null && mid > 0.01 &&
      c.bid != null && c.bid > 0
    ) {
      if (!bestCall || Math.abs(delta - 0.18) < Math.abs(bestCall.delta - 0.18)) {
        bestCall = { strike: c.strike, mid, iv, delta, bid: c.bid, ask: c.ask };
      }
    }
  }
  for (const p of puts) {
    const iv = p.impliedVolatility;
    const delta = iv ? bsDelta(price, p.strike, T, r, iv, 'put') : null;
    const dist = ((p.strike - price) / price) * 100;
    const mid = p.bid != null && p.ask != null ? (p.bid + p.ask) / 2 : p.lastPrice ?? null;
    rowsOut.push(csvRow([
      ticker, p.strike, 'put', p.bid, p.ask, p.lastPrice, iv, p.volume,
      p.openInterest, delta?.toFixed(3), dist.toFixed(2),
    ]));
    if (Math.abs(p.strike - price) / price < 0.03 && iv) { atmIvSum += iv; atmIvN++; }
    if (p.strike < price) putOtmVolSum += p.volume ?? 0;
    // Require a tradable two-sided market: bid > 0 (ask-only quotes are not fillable at the mid)
    if (
      delta != null && delta <= -0.13 && delta >= -0.22 &&
      mid != null && mid > 0.01 &&
      p.bid != null && p.bid > 0
    ) {
      if (!bestPut || Math.abs(Math.abs(delta) - 0.18) < Math.abs(Math.abs(bestPut.delta) - 0.18)) {
        bestPut = { strike: p.strike, mid, iv, delta, bid: p.bid, ask: p.ask };
      }
    }
  }
  const atmIv = atmIvN ? atmIvSum / atmIvN : null;

  const summary = csvRow([
    ticker, price,
    atmIv?.toFixed(4),
    atmIv ? (atmIv * 100).toFixed(1) : null,
    hv20Now?.toFixed(4),
    hv20Series.length ? Math.min(...hv20Series).toFixed(4) : null,
    hv20Series.length ? Math.max(...hv20Series).toFixed(4) : null,
    rank?.toFixed(1),
    atr?.toFixed(3),
    callOtmVolSum, putOtmVolSum,
    bestCall?.strike, bestCall?.mid?.toFixed(3), bestCall?.iv?.toFixed(4),
    bestPut?.strike, bestPut?.mid?.toFixed(3), bestPut?.iv?.toFixed(4),
  ]);
  return { ticker, rowsOut, summary };
}

const CONCURRENCY = 16;
const chainRowsAll = [
  'ticker,strike,type,bid,ask,last,iv,volume,oi,delta_est,distance_pct',
];
const summaryRowsAll = [
  'ticker,price,atm_iv,atm_iv_pct,hv20_now,hv20_min,hv20_max,hv_rank,atr14,call_otm_vol_total,put_otm_vol_total,best_call_strike_d18,best_call_credit,best_call_iv,best_put_strike_d18,best_put_credit,best_put_iv',
];
const errors = [];

let idx = 0;
let done = 0;
async function worker() {
  while (idx < tickers.length) {
    const my = idx++;
    const tk = tickers[my];
    try {
      const r = await processTicker(tk);
      chainRowsAll.push(...r.rowsOut);
      summaryRowsAll.push(r.summary);
    } catch (e) {
      errors.push({ ticker: tk.ticker, err: e.message });
    }
    done++;
    if (done % 25 === 0) process.stdout.write(`\r[chains] ${done}/${tickers.length} (err:${errors.length})`);
  }
}
const workers = Array.from({ length: CONCURRENCY }, () => worker());
await Promise.all(workers);
process.stdout.write('\n');

fs.writeFileSync(path.join(OUT, `chains_${EXPIRY_ISO}_v2.csv`), chainRowsAll.join('\n'));
fs.writeFileSync(path.join(OUT, 'chain_summary_v2.csv'), summaryRowsAll.join('\n'));
if (errors.length) {
  fs.writeFileSync(path.join(OUT, 'chain_errors_v2.json'), JSON.stringify(errors, null, 2));
}
console.log(`[chains] done. summary rows=${summaryRowsAll.length - 1} errors=${errors.length}`);
