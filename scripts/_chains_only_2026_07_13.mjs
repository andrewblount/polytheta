// Resumable chain fetch for basket 2026-07-13 / expiry 2026-07-17.
// Reads universe_8to40.csv, fetches chain + IV per ticker, appends to CSVs.
// Uses _chains_state.json to track progress so it can be re-invoked to resume.

import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BASKET_DATE = '2026-07-13';
const EXPIRY_ISO = '2026-07-17';
const OUT = path.join(REPO_ROOT, 'baskets', BASKET_DATE, 'data');

const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

function csvRow(vals) {
  return vals.map((v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
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
function realizedVol(closes, w) {
  if (closes.length < w + 1) return null;
  const rets = [];
  for (let i = closes.length - w; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * 252);
}
function rollingRV(closes, w) {
  const out = [];
  for (let i = w; i < closes.length; i++) {
    out.push(realizedVol(closes.slice(i - w, i + 1), w));
  }
  return out.filter((v) => v != null);
}
function hvRank(series, cur) {
  if (!series.length || cur == null) return null;
  const mx = Math.max(...series), mn = Math.min(...series);
  if (mx === mn) return null;
  return ((cur - mn) / (mx - mn)) * 100;
}
function atr14(hist) {
  if (hist.length < 15) return null;
  let s = 0, n = 0;
  for (let i = hist.length - 14; i < hist.length; i++) {
    const h = hist[i].high, l = hist[i].low, pc = hist[i - 1].close;
    if (h == null || l == null || pc == null) continue;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    s += tr; n++;
  }
  return n ? s / n : null;
}

const universeFile = path.join(OUT, 'universe_8to40.csv');
const lines = fs.readFileSync(universeFile, 'utf8').trim().split(/\r?\n/);
const header = lines[0].split(',');
const tIdx = header.indexOf('ticker');
const pIdx = header.indexOf('price');
const allTickers = lines.slice(1).map((l) => {
  const c = l.split(',');
  return { ticker: c[tIdx], price: parseFloat(c[pIdx]) };
}).filter((t) => t.ticker && Number.isFinite(t.price));

const stateFile = path.join(OUT, '_chains_state.json');
let state = { done: [], errors: [] };
if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const doneSet = new Set(state.done);

const chainsFile = path.join(OUT, `chains_${EXPIRY_ISO}_v2.csv`);
const summaryFile = path.join(OUT, 'chain_summary_v2.csv');
const CHAIN_HEADER = 'ticker,strike,type,bid,ask,last,iv,volume,oi,delta_est,distance_pct';
const SUMMARY_HEADER = 'ticker,price,atm_iv,atm_iv_pct,hv20_now,hv20_min,hv20_max,hv_rank,atr14,call_otm_vol_total,put_otm_vol_total,best_call_strike_d18,best_call_credit,best_call_iv,best_put_strike_d18,best_put_credit,best_put_iv';
if (!fs.existsSync(chainsFile)) fs.writeFileSync(chainsFile, CHAIN_HEADER + '\n');
if (!fs.existsSync(summaryFile)) fs.writeFileSync(summaryFile, SUMMARY_HEADER + '\n');

const now = new Date();
const histStart = new Date(now.getTime() - 365 * 86400 * 1000);
const expiryDate = new Date(EXPIRY_ISO + 'T00:00:00Z');
const T = Math.max((expiryDate.getTime() - now.getTime()) / (365 * 86400 * 1000), 1 / 365);
const r = 0.043;

const CHUNK_LIMIT = parseInt(process.argv[2] ?? '80', 10);
const remaining = allTickers.filter((t) => !doneSet.has(t.ticker) && !state.errors.some((e) => e.ticker === t.ticker));
const work = remaining.slice(0, CHUNK_LIMIT);
console.log(`[chains] total=${allTickers.length} done=${doneSet.size} err=${state.errors.length} this-chunk=${work.length}`);

let processed = 0;
for (const { ticker, price } of work) {
  try {
    const hist = await yf.chart(ticker, { period1: histStart, period2: now, interval: '1d' });
    const closes = hist.quotes.map((q) => q.close).filter((c) => c != null && c > 0);
    const ohlc = hist.quotes.filter((q) => q.high != null && q.low != null && q.close != null)
      .map((q) => ({ high: q.high, low: q.low, close: q.close }));
    const hv20Series = rollingRV(closes, 20);
    const hv20Now = realizedVol(closes, 20);
    const rank = hvRank(hv20Series, hv20Now);
    const atr = atr14(ohlc);

    let chain;
    try { chain = await yf.options(ticker, { date: expiryDate }); } catch { chain = null; }
    if (!chain) {
      const all = await yf.options(ticker);
      const exps = (all?.expirationDates ?? []).map((d) => new Date(d));
      const target = exps.find((d) => Math.abs(d.getTime() - expiryDate.getTime()) < 86400000 * 2);
      if (target) chain = await yf.options(ticker, { date: target });
    }
    if (!chain || !chain.options || !chain.options.length) throw new Error('no chain');
    const calls = chain.options[0].calls ?? [];
    const puts = chain.options[0].puts ?? [];

    let atmSum = 0, atmN = 0, bestCall = null, bestPut = null;
    let cVol = 0, pVol = 0;
    const chainOut = [];
    for (const c of calls) {
      const iv = c.impliedVolatility;
      const delta = iv ? bsDelta(price, c.strike, T, r, iv, 'call') : null;
      const dist = ((c.strike - price) / price) * 100;
      const mid = c.bid != null && c.ask != null ? (c.bid + c.ask) / 2 : c.lastPrice ?? null;
      chainOut.push(csvRow([ticker, c.strike, 'call', c.bid, c.ask, c.lastPrice, iv, c.volume, c.openInterest, delta?.toFixed(3), dist.toFixed(2)]));
      if (Math.abs(c.strike - price) / price < 0.03 && iv) { atmSum += iv; atmN++; }
      if (c.strike > price) cVol += c.volume ?? 0;
      if (delta != null && delta >= 0.13 && delta <= 0.22 && mid != null && mid > 0.01 && c.bid != null && c.bid > 0) {
        if (!bestCall || Math.abs(delta - 0.18) < Math.abs(bestCall.delta - 0.18)) bestCall = { strike: c.strike, mid, iv, delta };
      }
    }
    for (const p of puts) {
      const iv = p.impliedVolatility;
      const delta = iv ? bsDelta(price, p.strike, T, r, iv, 'put') : null;
      const dist = ((p.strike - price) / price) * 100;
      const mid = p.bid != null && p.ask != null ? (p.bid + p.ask) / 2 : p.lastPrice ?? null;
      chainOut.push(csvRow([ticker, p.strike, 'put', p.bid, p.ask, p.lastPrice, iv, p.volume, p.openInterest, delta?.toFixed(3), dist.toFixed(2)]));
      if (Math.abs(p.strike - price) / price < 0.03 && iv) { atmSum += iv; atmN++; }
      if (p.strike < price) pVol += p.volume ?? 0;
      if (delta != null && delta <= -0.13 && delta >= -0.22 && mid != null && mid > 0.01 && p.bid != null && p.bid > 0) {
        if (!bestPut || Math.abs(Math.abs(delta) - 0.18) < Math.abs(Math.abs(bestPut.delta) - 0.18)) bestPut = { strike: p.strike, mid, iv, delta };
      }
    }
    const atmIv = atmN ? atmSum / atmN : null;
    fs.appendFileSync(chainsFile, chainOut.join('\n') + '\n');
    fs.appendFileSync(summaryFile, csvRow([
      ticker, price,
      atmIv?.toFixed(4), atmIv ? (atmIv * 100).toFixed(1) : null,
      hv20Now?.toFixed(4),
      hv20Series.length ? Math.min(...hv20Series).toFixed(4) : null,
      hv20Series.length ? Math.max(...hv20Series).toFixed(4) : null,
      rank?.toFixed(1), atr?.toFixed(3), cVol, pVol,
      bestCall?.strike, bestCall?.mid?.toFixed(3), bestCall?.iv?.toFixed(4),
      bestPut?.strike, bestPut?.mid?.toFixed(3), bestPut?.iv?.toFixed(4),
    ]) + '\n');
    state.done.push(ticker);
    doneSet.add(ticker);
    processed++;
  } catch (e) {
    state.errors.push({ ticker, err: e.message });
  }
  if (processed % 10 === 0) {
    fs.writeFileSync(stateFile, JSON.stringify(state));
    process.stdout.write(`\r[chains] +${processed} done=${state.done.length}/${allTickers.length} err=${state.errors.length}`);
  }
  await new Promise((r) => setTimeout(r, 80));
}
process.stdout.write('\n');
fs.writeFileSync(stateFile, JSON.stringify(state));
console.log(`[chains] chunk end. done=${state.done.length}/${allTickers.length} err=${state.errors.length}`);
