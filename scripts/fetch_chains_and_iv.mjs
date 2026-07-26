import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const yf = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices: ['yahooSurvey'] });
const OUT = path.join(REPO_ROOT, 'baskets', '2026-04-20', 'data');
const TARGET_EXPIRY_ISO = '2026-04-24'; // weekly Friday

function csvRow(vals) {
  return vals.map((v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

// Black–Scholes — for delta + ATM IV interpolation if needed
function ndist(x) { return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x); }
function ncdf(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign = x < 0 ? -1 : 1; x = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t*Math.exp(-x*x);
  return 0.5 * (1 + sign * y);
}
function bsDelta(S, K, T, r, sigma, type) {
  if (T <= 0 || sigma <= 0) return type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return type === 'call' ? ncdf(d1) : ncdf(d1) - 1;
}

// Realized-vol rank as IV-rank proxy
function realizedVol(closes, window) {
  if (closes.length < window + 1) return null;
  const rets = [];
  for (let i = closes.length - window; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 252); // annualized
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
  const max = Math.max(...rvSeries);
  const min = Math.min(...rvSeries);
  if (max === min) return null;
  return ((currentRV - min) / (max - min)) * 100;
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

// Read filtered universe
const filtered = fs.readFileSync(path.join(OUT, 'universe_8to40.csv'), 'utf8').trim().split(/\r?\n/);
const header = filtered[0].split(',');
const tickerIdx = header.indexOf('ticker');
const priceIdx = header.indexOf('price');
const tickers = filtered.slice(1).map((l) => {
  const cells = l.split(',');
  return { ticker: cells[tickerIdx], price: parseFloat(cells[priceIdx]) };
}).filter((t) => t.ticker && Number.isFinite(t.price));

console.log('Tickers to process:', tickers.length);

const chainRows = ['ticker,strike,type,bid,ask,last,iv,volume,oi,delta_est,distance_pct'];
const summaryRows = ['ticker,price,atm_iv,atm_iv_pct,hv20_now,hv20_min,hv20_max,hv_rank,atr14,call_otm_vol_total,put_otm_vol_total,best_call_strike_d18,best_call_credit,best_call_iv,best_put_strike_d18,best_put_credit,best_put_iv'];
const errors = [];

const now = new Date();
const histStart = new Date(now.getTime() - 365 * 86400 * 1000);
const expiryDate = new Date(TARGET_EXPIRY_ISO + 'T00:00:00Z');
const T = Math.max((expiryDate.getTime() - now.getTime()) / (365 * 86400 * 1000), 1 / 365);
const r = 0.043; // ~ short-rate proxy
console.log('T(yrs):', T.toFixed(4));

let done = 0;
for (const { ticker, price } of tickers) {
  try {
    // Historical for HV rank + ATR
    const hist = await yf.chart(ticker, { period1: histStart, period2: now, interval: '1d' });
    const closes = hist.quotes.map((q) => q.close).filter((c) => c != null && c > 0);
    const ohlc = hist.quotes.filter((q) => q.high != null && q.low != null && q.close != null).map((q) => ({ high: q.high, low: q.low, close: q.close }));
    const hv20Series = rollingRV(closes, 20);
    const hv20Now = realizedVol(closes, 20);
    const rank = hvRank(hv20Series, hv20Now);
    const atr = atr14(ohlc);

    // Option chain for target expiry
    let chain;
    try { chain = await yf.options(ticker, { date: expiryDate }); } catch { chain = null; }
    if (!chain) {
      // try nearest available
      const all = await yf.options(ticker);
      const expirations = (all?.expirationDates ?? []).map((d) => new Date(d));
      const target = expirations.find((d) => Math.abs(d.getTime() - expiryDate.getTime()) < 86400000 * 2);
      if (target) chain = await yf.options(ticker, { date: target });
    }
    if (!chain || !chain.options || !chain.options.length) throw new Error('no chain');

    const calls = chain.options[0].calls ?? [];
    const puts = chain.options[0].puts ?? [];

    let atmIvSum = 0, atmIvN = 0;
    let bestCall = null, bestPut = null;
    let callOtmVolSum = 0, putOtmVolSum = 0;

    for (const c of calls) {
      const iv = c.impliedVolatility;
      const delta = iv ? bsDelta(price, c.strike, T, r, iv, 'call') : null;
      const dist = ((c.strike - price) / price) * 100;
      const mid = (c.bid != null && c.ask != null) ? (c.bid + c.ask) / 2 : c.lastPrice ?? null;
      chainRows.push(csvRow([ticker, c.strike, 'call', c.bid, c.ask, c.lastPrice, iv, c.volume, c.openInterest, delta?.toFixed(3), dist.toFixed(2)]));
      if (Math.abs(c.strike - price) / price < 0.03 && iv) { atmIvSum += iv; atmIvN++; }
      if (c.strike > price) callOtmVolSum += (c.volume ?? 0);
      if (delta != null && delta >= 0.13 && delta <= 0.22 && mid != null && mid > 0.01) {
        if (!bestCall || Math.abs(delta - 0.18) < Math.abs(bestCall.delta - 0.18)) {
          bestCall = { strike: c.strike, mid, iv, delta };
        }
      }
    }
    for (const p of puts) {
      const iv = p.impliedVolatility;
      const delta = iv ? bsDelta(price, p.strike, T, r, iv, 'put') : null;
      const dist = ((p.strike - price) / price) * 100;
      const mid = (p.bid != null && p.ask != null) ? (p.bid + p.ask) / 2 : p.lastPrice ?? null;
      chainRows.push(csvRow([ticker, p.strike, 'put', p.bid, p.ask, p.lastPrice, iv, p.volume, p.openInterest, delta?.toFixed(3), dist.toFixed(2)]));
      if (Math.abs(p.strike - price) / price < 0.03 && iv) { atmIvSum += iv; atmIvN++; }
      if (p.strike < price) putOtmVolSum += (p.volume ?? 0);
      if (delta != null && delta <= -0.13 && delta >= -0.22 && mid != null && mid > 0.01) {
        if (!bestPut || Math.abs(Math.abs(delta) - 0.18) < Math.abs(Math.abs(bestPut.delta) - 0.18)) {
          bestPut = { strike: p.strike, mid, iv, delta };
        }
      }
    }
    const atmIv = atmIvN ? atmIvSum / atmIvN : null;

    summaryRows.push(csvRow([
      ticker, price,
      atmIv?.toFixed(4),
      atmIv ? (atmIv * 100).toFixed(1) : null,
      hv20Now?.toFixed(4),
      Math.min(...hv20Series).toFixed(4),
      Math.max(...hv20Series).toFixed(4),
      rank?.toFixed(1),
      atr?.toFixed(3),
      callOtmVolSum,
      putOtmVolSum,
      bestCall?.strike,
      bestCall?.mid?.toFixed(3),
      bestCall?.iv?.toFixed(4),
      bestPut?.strike,
      bestPut?.mid?.toFixed(3),
      bestPut?.iv?.toFixed(4),
    ]));
    done++;
  } catch (e) {
    errors.push({ ticker, err: e.message });
  }
  if (done % 25 === 0) process.stdout.write(`\rprocessed ${done}/${tickers.length} (errors:${errors.length})`);
  await new Promise((r) => setTimeout(r, 150));
}
process.stdout.write('\n');

fs.writeFileSync(path.join(OUT, 'chains_2026-04-24_v2.csv'), chainRows.join('\n'));
fs.writeFileSync(path.join(OUT, 'chain_summary_v2.csv'), summaryRows.join('\n'));
if (errors.length) fs.writeFileSync(path.join(OUT, 'chain_errors_v2.json'), JSON.stringify(errors, null, 2));
console.log('done. summary rows:', summaryRows.length - 1, 'errors:', errors.length);
