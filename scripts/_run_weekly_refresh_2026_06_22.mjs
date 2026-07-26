// Weekly basket data refresh — end-to-end.
// Re-fetches Yahoo macro, history, universe quotes, option chains and IV
// for this week's Friday expiry. Writes outputs to baskets/<basket_date>/data/.
//
// Usage: node scripts/run_weekly_refresh.mjs
//
// This script is derived from scripts/fetch_market.mjs, fetch_universe_quotes.mjs
// and fetch_chains_and_iv.mjs, but with path autodiscovery so it can be re-run
// from any session. It expects baskets/<basket_date>/data/weeklys_universe.csv
// to already exist.

import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// --- Target expiry / basket date ---
function nextFriday(d) {
  const out = new Date(d);
  const day = out.getUTCDay(); // 0=Sun..6=Sat
  const add = (5 - day + 7) % 7 || 7; // strictly next Friday (not today)
  out.setUTCDate(out.getUTCDate() + add);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}
function nextMonday(d) {
  const out = new Date(d);
  const day = out.getUTCDay();
  const add = (1 - day + 7) % 7 || 7; // strictly next Monday
  out.setUTCDate(out.getUTCDate() + add);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

const today = new Date('2026-06-21T12:00:00Z');
const expiry = nextFriday(today);
const monday = nextMonday(today);
const BASKET_DATE = monday.toISOString().slice(0, 10);
const EXPIRY_ISO = expiry.toISOString().slice(0, 10);

const BASKET_DIR = path.join(REPO_ROOT, 'baskets', BASKET_DATE);
const OUT = path.join(BASKET_DIR, 'data');
fs.mkdirSync(OUT, { recursive: true });

console.log(`[refresh] basket_date=${BASKET_DATE} expiry=${EXPIRY_ISO}`);
console.log(`[refresh] out=${OUT}`);

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

// ----- 1) Macro quotes & history -----
async function step1Macro() {
  const macroTickers = [
    'SPY', '^GSPC', '^VIX', '^SKEW', '^MOVE', '^OVX', '^RVX', 'QQQ', 'IWM',
    'TLT', 'HYG', 'JNK', 'DXY', 'UUP', 'GLD', 'USO', 'XLE', 'XLF', 'XLK',
  ];
  const macroQuotes = await yf.quote(macroTickers);
  const rows = [
    'ticker,price,currency,exchange,market_time,prev_close,fifty_two_wk_high,fifty_two_wk_low',
  ];
  for (const q of macroQuotes) {
    rows.push(
      csvRow([
        q.symbol,
        q.regularMarketPrice,
        q.currency,
        q.fullExchangeName,
        q.regularMarketTime
          ? new Date(q.regularMarketTime).toISOString()
          : '',
        q.regularMarketPreviousClose,
        q.fiftyTwoWeekHigh,
        q.fiftyTwoWeekLow,
      ])
    );
  }
  fs.writeFileSync(path.join(OUT, 'macro_quotes.csv'), rows.join('\n'));
  console.log(`[1] macro_quotes.csv rows: ${macroQuotes.length}`);

  const end = new Date();
  const start = new Date(end.getTime() - 180 * 86400 * 1000);
  for (const t of ['SPY', '^GSPC', '^VIX']) {
    try {
      const h = await yf.chart(t, { period1: start, period2: end, interval: '1d' });
      const hrows = ['date,open,high,low,close,volume'];
      for (const q of h.quotes) {
        hrows.push(
          csvRow([
            q.date?.toISOString?.().slice(0, 10) ?? q.date,
            q.open, q.high, q.low, q.close, q.volume,
          ])
        );
      }
      const fname = t.replace(/[^A-Za-z0-9]/g, '') + '_history.csv';
      fs.writeFileSync(path.join(OUT, fname), hrows.join('\n'));
      console.log(`[1] ${t} history rows: ${h.quotes.length}`);
    } catch (e) {
      console.error(`[1] ${t} history err: ${e.message}`);
    }
  }

  const vix = macroQuotes.find((q) => q.symbol === '^VIX');
  const result = {
    SPY: macroQuotes.find((q) => q.symbol === 'SPY')?.regularMarketPrice,
    VIX: vix?.regularMarketPrice,
    VIX_prev: vix?.regularMarketPreviousClose,
    SKEW: macroQuotes.find((q) => q.symbol === '^SKEW')?.regularMarketPrice,
    MOVE: macroQuotes.find((q) => q.symbol === '^MOVE')?.regularMarketPrice,
    SPX: macroQuotes.find((q) => q.symbol === '^GSPC')?.regularMarketPrice,
  };
  console.log('[1] macro snapshot:', JSON.stringify(result));
  return result;
}

// ----- 2) Universe quotes -----
async function step2UniverseQuotes() {
  const unifile = path.join(OUT, 'weeklys_universe.csv');
  if (!fs.existsSync(unifile)) {
    console.warn(`[2] no weeklys_universe.csv at ${unifile} — skipping`);
    return { done: 0, errors: 0 };
  }
  const universeCsv = fs
    .readFileSync(unifile, 'utf8')
    .trim()
    .split(/\r?\n/)
    .slice(1);
  const clean = universeCsv.filter((t) => /^[A-Z]{1,5}$/.test(t));
  console.log(`[2] clean tickers: ${clean.length}`);

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
        rows.push(
          csvRow([
            q.symbol, q.regularMarketPrice, q.currency, q.fullExchangeName,
            q.marketCap,
            q.averageDailyVolume10Day ?? q.averageDailyVolume3Month,
            q.sharesOutstanding, q.regularMarketPreviousClose,
            q.fiftyTwoWeekHigh, q.fiftyTwoWeekLow,
            q.epsForward, q.forwardPE,
            q.longName ?? q.shortName,
          ])
        );
      }
      done += quotes.length;
    } catch (e) {
      errs.push({ batch: batch.join(','), err: e.message });
    }
    process.stdout.write(`\r[2] quotes: ${done}/${clean.length}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  process.stdout.write('\n');
  fs.writeFileSync(path.join(OUT, 'universe_quotes.csv'), rows.join('\n'));
  if (errs.length)
    fs.writeFileSync(
      path.join(OUT, 'universe_quote_errors.json'),
      JSON.stringify(errs, null, 2)
    );
  console.log(
    `[2] wrote universe_quotes.csv rows: ${rows.length - 1} errors: ${errs.length}`
  );

  // Build universe_8to40.csv (price-filter band)
  const header = rows[0].split(',');
  const priceIdx = header.indexOf('price');
  const filtered = [rows[0]];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split(',');
    const p = parseFloat(cells[priceIdx]);
    if (Number.isFinite(p) && p >= 8 && p <= 40) filtered.push(rows[i]);
  }
  fs.writeFileSync(path.join(OUT, 'universe_8to40.csv'), filtered.join('\n'));
  console.log(`[2] universe_8to40.csv rows: ${filtered.length - 1}`);

  return { done, errors: errs.length };
}

// ----- 3) Chain + IV -----
function ndist(x) {
  return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
}
function ncdf(x) {
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}
function bsDelta(S, K, T, r, sigma, type) {
  if (T <= 0 || sigma <= 0)
    return type === 'call' ? (S > K ? 1 : 0) : S < K ? -1 : 0;
  const d1 =
    (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) /
    (sigma * Math.sqrt(T));
  return type === 'call' ? ncdf(d1) : ncdf(d1) - 1;
}
function realizedVol(closes, window) {
  if (closes.length < window + 1) return null;
  const rets = [];
  for (let i = closes.length - window; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
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
  const max = Math.max(...rvSeries);
  const min = Math.min(...rvSeries);
  if (max === min) return null;
  return ((currentRV - min) / (max - min)) * 100;
}
function atr14(history) {
  if (history.length < 15) return null;
  let trSum = 0,
    n = 0;
  for (let i = history.length - 14; i < history.length; i++) {
    const h = history[i].high,
      l = history[i].low,
      pc = history[i - 1].close;
    if (h == null || l == null || pc == null) continue;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trSum += tr;
    n++;
  }
  return n ? trSum / n : null;
}

async function step3Chains() {
  const ffile = path.join(OUT, 'universe_8to40.csv');
  if (!fs.existsSync(ffile)) {
    console.warn(`[3] no universe_8to40.csv — skipping`);
    return { processed: 0, errors: 0 };
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
  console.log(`[3] tickers: ${tickers.length}`);

  const chainRows = [
    'ticker,strike,type,bid,ask,last,iv,volume,oi,delta_est,distance_pct',
  ];
  const summaryRows = [
    'ticker,price,atm_iv,atm_iv_pct,hv20_now,hv20_min,hv20_max,hv_rank,atr14,call_otm_vol_total,put_otm_vol_total,best_call_strike_d18,best_call_credit,best_call_iv,best_put_strike_d18,best_put_credit,best_put_iv',
  ];
  const errors = [];

  const now = new Date();
  const histStart = new Date(now.getTime() - 365 * 86400 * 1000);
  const expiryDate = new Date(EXPIRY_ISO + 'T00:00:00Z');
  const T = Math.max(
    (expiryDate.getTime() - now.getTime()) / (365 * 86400 * 1000),
    1 / 365
  );
  const r = 0.043;
  console.log(`[3] T(yrs): ${T.toFixed(4)}`);

  let done = 0;
  for (const { ticker, price } of tickers) {
    try {
      const hist = await yf.chart(ticker, {
        period1: histStart,
        period2: now,
        interval: '1d',
      });
      const closes = hist.quotes
        .map((q) => q.close)
        .filter((c) => c != null && c > 0);
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
      if (!chain || !chain.options || !chain.options.length)
        throw new Error('no chain');

      const calls = chain.options[0].calls ?? [];
      const puts = chain.options[0].puts ?? [];

      let atmIvSum = 0,
        atmIvN = 0;
      let bestCall = null,
        bestPut = null;
      let callOtmVolSum = 0,
        putOtmVolSum = 0;

      for (const c of calls) {
        const iv = c.impliedVolatility;
        const delta = iv ? bsDelta(price, c.strike, T, r, iv, 'call') : null;
        const dist = ((c.strike - price) / price) * 100;
        const mid =
          c.bid != null && c.ask != null
            ? (c.bid + c.ask) / 2
            : c.lastPrice ?? null;
        chainRows.push(
          csvRow([
            ticker, c.strike, 'call', c.bid, c.ask, c.lastPrice, iv, c.volume,
            c.openInterest, delta?.toFixed(3), dist.toFixed(2),
          ])
        );
        if (Math.abs(c.strike - price) / price < 0.03 && iv) {
          atmIvSum += iv;
          atmIvN++;
        }
        if (c.strike > price) callOtmVolSum += c.volume ?? 0;
        // Require a tradable two-sided market: bid > 0 (ask-only quotes are not fillable at the mid)
        if (
          delta != null && delta >= 0.13 && delta <= 0.22 &&
          mid != null && mid > 0.01 &&
          c.bid != null && c.bid > 0
        ) {
          if (
            !bestCall ||
            Math.abs(delta - 0.18) < Math.abs(bestCall.delta - 0.18)
          ) {
            bestCall = { strike: c.strike, mid, iv, delta };
          }
        }
      }
      for (const p of puts) {
        const iv = p.impliedVolatility;
        const delta = iv ? bsDelta(price, p.strike, T, r, iv, 'put') : null;
        const dist = ((p.strike - price) / price) * 100;
        const mid =
          p.bid != null && p.ask != null
            ? (p.bid + p.ask) / 2
            : p.lastPrice ?? null;
        chainRows.push(
          csvRow([
            ticker, p.strike, 'put', p.bid, p.ask, p.lastPrice, iv, p.volume,
            p.openInterest, delta?.toFixed(3), dist.toFixed(2),
          ])
        );
        if (Math.abs(p.strike - price) / price < 0.03 && iv) {
          atmIvSum += iv;
          atmIvN++;
        }
        if (p.strike < price) putOtmVolSum += p.volume ?? 0;
        // Require a tradable two-sided market: bid > 0 (ask-only quotes are not fillable at the mid)
        if (
          delta != null && delta <= -0.13 && delta >= -0.22 &&
          mid != null && mid > 0.01 &&
          p.bid != null && p.bid > 0
        ) {
          if (
            !bestPut ||
            Math.abs(Math.abs(delta) - 0.18) <
              Math.abs(Math.abs(bestPut.delta) - 0.18)
          ) {
            bestPut = { strike: p.strike, mid, iv, delta };
          }
        }
      }
      const atmIv = atmIvN ? atmIvSum / atmIvN : null;

      summaryRows.push(
        csvRow([
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
        ])
      );
      done++;
    } catch (e) {
      errors.push({ ticker, err: e.message });
    }
    if (done % 20 === 0)
      process.stdout.write(
        `\r[3] processed ${done}/${tickers.length} (err:${errors.length})`
      );
    await new Promise((r) => setTimeout(r, 150));
  }
  process.stdout.write('\n');

  fs.writeFileSync(
    path.join(OUT, `chains_${EXPIRY_ISO}_v2.csv`),
    chainRows.join('\n')
  );
  fs.writeFileSync(
    path.join(OUT, 'chain_summary_v2.csv'),
    summaryRows.join('\n')
  );
  if (errors.length)
    fs.writeFileSync(
      path.join(OUT, 'chain_errors_v2.json'),
      JSON.stringify(errors, null, 2)
    );
  console.log(
    `[3] done. summary rows: ${summaryRows.length - 1} errors: ${errors.length}`
  );
  return { processed: done, errors: errors.length };
}

// ----- run -----
const macro = await step1Macro();
const q = await step2UniverseQuotes();
const c = await step3Chains();

// Write a run manifest
const manifest = {
  run_ts: new Date().toISOString(),
  basket_date: BASKET_DATE,
  expiry: EXPIRY_ISO,
  macro,
  universe_quotes: q,
  chains: c,
};
fs.writeFileSync(
  path.join(OUT, 'refresh_manifest.json'),
  JSON.stringify(manifest, null, 2)
);
console.log('\n[done] refresh_manifest.json written');
