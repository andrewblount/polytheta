// One-off runner derived from scripts/run_weekly_refresh.mjs
// Pins basket_date = 2026-04-27 (today, Monday entry) and expiry = 2026-05-01
// because the upstream nextMonday() helper strictly skips today.
//
// Steps performed:
//   1) Macro quotes + SPY/SPX/VIX history into baskets/2026-04-27/data/
//   2) Universe quotes (CBOE weeklys universe from existing weeklys_universe.csv)
//      → universe_quotes.csv + universe_8to40.csv
//
// Step 3 (chains + IV) is delegated to scripts/_chains_parallel.mjs 2026-04-27,
// which already takes an explicit basket_date argument.

import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const BASKET_DATE = '2026-04-27';
const EXPIRY_ISO = '2026-05-01';

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
        q.regularMarketTime ? new Date(q.regularMarketTime).toISOString() : '',
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

// ----- run -----
const macro = await step1Macro();
const q = await step2UniverseQuotes();

const manifest = {
  run_ts: new Date().toISOString(),
  basket_date: BASKET_DATE,
  expiry: EXPIRY_ISO,
  macro,
  universe_quotes: q,
  // chains step delegated to _chains_parallel.mjs 2026-04-27 (separate run)
};
fs.writeFileSync(
  path.join(OUT, 'refresh_manifest_step12.json'),
  JSON.stringify(manifest, null, 2)
);
console.log('\n[done step1+2] refresh_manifest_step12.json written');
