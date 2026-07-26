// Generic weekly Yahoo refresh (macro + universe quotes + options chains).
// Extracted from scripts/_run_weekly_refresh_*.mjs so the same code runs every week.

import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';

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
  for (let i = w; i < closes.length; i++) out.push(realizedVol(closes.slice(i - w, i + 1), w));
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

// Step 1: macro quotes + SPY/GSPC/VIX history.
async function runMacro(OUT) {
  const macroTickers = [
    'SPY', '^GSPC', '^VIX', '^SKEW', '^MOVE', '^OVX', '^RVX', 'QQQ', 'IWM',
    'TLT', 'HYG', 'JNK', 'DXY', 'UUP', 'GLD', 'USO', 'XLE', 'XLF', 'XLK',
  ];
  const macroQuotes = await yf.quote(macroTickers);
  const rows = [
    'ticker,price,currency,exchange,market_time,prev_close,fifty_two_wk_high,fifty_two_wk_low',
  ];
  for (const q of macroQuotes) {
    rows.push(csvRow([
      q.symbol, q.regularMarketPrice, q.currency, q.fullExchangeName,
      q.regularMarketTime ? new Date(q.regularMarketTime).toISOString() : '',
      q.regularMarketPreviousClose, q.fiftyTwoWeekHigh, q.fiftyTwoWeekLow,
    ]));
  }
  fs.writeFileSync(path.join(OUT, 'macro_quotes.csv'), rows.join('\n'));

  const end = new Date();
  const start = new Date(end.getTime() - 180 * 86400 * 1000);
  for (const t of ['SPY', '^GSPC', '^VIX']) {
    try {
      const h = await yf.chart(t, { period1: start, period2: end, interval: '1d' });
      const hrows = ['date,open,high,low,close,volume'];
      for (const q of h.quotes) {
        hrows.push(csvRow([
          q.date?.toISOString?.().slice(0, 10) ?? q.date,
          q.open, q.high, q.low, q.close, q.volume,
        ]));
      }
      const fname = t.replace(/[^A-Za-z0-9]/g, '') + '_history.csv';
      fs.writeFileSync(path.join(OUT, fname), hrows.join('\n'));
    } catch (e) {
      console.error(`[macro] ${t} err: ${e.message}`);
    }
  }
  return { count: macroQuotes.length };
}

// Step 2: universe quotes and price-band filter.
// Band restored to the documented $8–$100 (docs/options_trading_system.md
// universe filter). It had drifted to $8–$40, which structurally emptied the
// put side under the 2x ATR + delta 0.15–0.20 rules: the tier-1 names those
// rules were designed around (F, GM, HOOD, PINS in the manual-era baskets)
// mostly trade $40–$100. Filename kept for resume-logic compatibility.
const PRICE_MIN = 8;
const PRICE_MAX = 100;
async function runUniverseQuotes(OUT) {
  const unifile = path.join(OUT, 'weeklys_universe.csv');
  if (!fs.existsSync(unifile)) throw new Error(`missing ${unifile}`);
  const clean = fs.readFileSync(unifile, 'utf8').trim().split(/\r?\n/).slice(1)
    .filter((t) => /^[A-Z]{1,5}$/.test(t));
  const rows = [
    'ticker,price,currency,exchange,market_cap,avg_volume,shares_outstanding,prev_close,fifty_two_wk_high,fifty_two_wk_low,eps_fwd,pe_fwd,name',
  ];
  const errs = [];
  const batchSize = 50;
  let done = 0;
  for (let i = 0; i < clean.length; i += batchSize) {
    const batch = clean.slice(i, i + batchSize);
    try {
      const quotes = await yf.quote(batch);
      for (const q of quotes) {
        rows.push(csvRow([
          q.symbol, q.regularMarketPrice, q.currency, q.fullExchangeName, q.marketCap,
          q.averageDailyVolume10Day ?? q.averageDailyVolume3Month,
          q.sharesOutstanding, q.regularMarketPreviousClose,
          q.fiftyTwoWeekHigh, q.fiftyTwoWeekLow, q.epsForward, q.forwardPE,
          q.longName ?? q.shortName,
        ]));
      }
      done += quotes.length;
    } catch (e) {
      errs.push({ batch: batch.join(','), err: e.message });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fs.writeFileSync(path.join(OUT, 'universe_quotes.csv'), rows.join('\n'));
  if (errs.length)
    fs.writeFileSync(path.join(OUT, 'universe_quote_errors.json'), JSON.stringify(errs, null, 2));

  const header = rows[0].split(',');
  const priceIdx = header.indexOf('price');
  const filtered = [rows[0]];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split(',');
    const p = parseFloat(cells[priceIdx]);
    if (Number.isFinite(p) && p >= PRICE_MIN && p <= PRICE_MAX) filtered.push(rows[i]);
  }
  fs.writeFileSync(path.join(OUT, 'universe_8to40.csv'), filtered.join('\n'));
  return { done, errors: errs.length, filtered: filtered.length - 1 };
}

// Step 3: option chains + IV summary (resumable via _chains_state.json).
async function runChains(OUT, EXPIRY_ISO, { chunkLimit = 999999 } = {}) {
  const universeFile = path.join(OUT, 'universe_8to40.csv');
  if (!fs.existsSync(universeFile)) throw new Error(`missing ${universeFile}`);
  const lines = fs.readFileSync(universeFile, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const tIdx = header.indexOf('ticker');
  const pIdx = header.indexOf('price');
  const allTickers = lines.slice(1).map((l) => {
    const c = l.split(','); return { ticker: c[tIdx], price: parseFloat(c[pIdx]) };
  }).filter((t) => t.ticker && Number.isFinite(t.price));

  const stateFile = path.join(OUT, '_chains_state.json');
  let state = { done: [], errors: [] };
  if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const doneSet = new Set(state.done);
  const errSet = new Set(state.errors.map((e) => e.ticker));

  const chainsFile = path.join(OUT, `chains_${EXPIRY_ISO}_v2.csv`);
  const summaryFile = path.join(OUT, 'chain_summary_v2.csv');
  const CHAIN_HEADER = 'ticker,strike,type,bid,ask,last,iv,volume,oi,delta_est,distance_pct';
  const SUMMARY_HEADER = 'ticker,price,atm_iv,atm_iv_pct,hv20_now,hv20_min,hv20_max,hv_rank,atr14,call_otm_vol_total,put_otm_vol_total,best_call_strike_d18,best_call_credit,best_call_iv,best_put_strike_d18,best_put_credit,best_put_iv,mom1d_pct,mom3d_pct,mom10d_pct';
  if (!fs.existsSync(chainsFile)) fs.writeFileSync(chainsFile, CHAIN_HEADER + '\n');
  if (!fs.existsSync(summaryFile)) fs.writeFileSync(summaryFile, SUMMARY_HEADER + '\n');

  const now = new Date();
  const histStart = new Date(now.getTime() - 365 * 86400 * 1000);
  const expiryDate = new Date(EXPIRY_ISO + 'T00:00:00Z');
  const T = Math.max((expiryDate.getTime() - now.getTime()) / (365 * 86400 * 1000), 1 / 365);
  const r = 0.043;

  const remaining = allTickers.filter((t) => !doneSet.has(t.ticker) && !errSet.has(t.ticker));
  const work = remaining.slice(0, chunkLimit);
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

      // Pre-entry thrust (frenzy-guard inputs). Every ITM call loss through
      // 2026-07-20 entered right after a violent up-move; see
      // docs/trade_autopsy_2026-05-11.md.
      const momPct = (w) =>
        closes.length > w && closes.at(-1 - w) > 0
          ? ((closes.at(-1) / closes.at(-1 - w) - 1) * 100)
          : null;
      const mom1d = momPct(1), mom3d = momPct(3), mom10d = momPct(10);

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

      let atmSum = 0, atmN = 0, bestCall = null, bestPut = null, cVol = 0, pVol = 0;
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
        ticker, price, atmIv?.toFixed(4), atmIv ? (atmIv * 100).toFixed(1) : null,
        hv20Now?.toFixed(4),
        hv20Series.length ? Math.min(...hv20Series).toFixed(4) : null,
        hv20Series.length ? Math.max(...hv20Series).toFixed(4) : null,
        rank?.toFixed(1), atr?.toFixed(3), cVol, pVol,
        bestCall?.strike, bestCall?.mid?.toFixed(3), bestCall?.iv?.toFixed(4),
        bestPut?.strike, bestPut?.mid?.toFixed(3), bestPut?.iv?.toFixed(4),
        mom1d?.toFixed(1), mom3d?.toFixed(1), mom10d?.toFixed(1),
      ]) + '\n');
      state.done.push(ticker);
      doneSet.add(ticker);
      processed++;
    } catch (e) {
      state.errors.push({ ticker, err: e.message });
    }
    if (processed % 10 === 0) fs.writeFileSync(stateFile, JSON.stringify(state));
    await new Promise((r) => setTimeout(r, 80));
  }
  fs.writeFileSync(stateFile, JSON.stringify(state));
  return { total: allTickers.length, done: state.done.length, errors: state.errors.length, processed };
}

export async function runRefresh({ OUT, EXPIRY_ISO, chunkLimit }) {
  const stepMacro = await runMacro(OUT);
  let stepQ = { skipped: true, reason: 'universe_quotes.csv exists' };
  if (!fs.existsSync(path.join(OUT, 'universe_quotes.csv'))) {
    stepQ = await runUniverseQuotes(OUT);
  }
  const stepChains = await runChains(OUT, EXPIRY_ISO, { chunkLimit });
  return { macro: stepMacro, universe: stepQ, chains: stepChains };
}
