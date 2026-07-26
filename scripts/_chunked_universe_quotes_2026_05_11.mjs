// Chunked universe quotes — resumes from existing rows in universe_quotes.csv.
// Designed to fit inside ~40s bash windows; rerun until DONE.
//
// Run: node scripts/_chunked_universe_quotes_2026_05_11.mjs

import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BASKET_DATE = '2026-05-11';
const OUT = path.join(REPO_ROOT, 'baskets', BASKET_DATE, 'data');

const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

function csvRow(vals) {
  return vals
    .map((v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    })
    .join(',');
}

const HEADER =
  'ticker,price,currency,exchange,market_cap,avg_volume,shares_outstanding,prev_close,fifty_two_wk_high,fifty_two_wk_low,eps_fwd,pe_fwd,name';

const unifile = path.join(OUT, 'weeklys_universe.csv');
const universeCsv = fs.readFileSync(unifile, 'utf8').trim().split(/\r?\n/).slice(1);
const clean = universeCsv.filter((t) => /^[A-Z]{1,5}$/.test(t));

const outFile = path.join(OUT, 'universe_quotes.csv');
let existing = new Set();
let rows = [HEADER];
if (fs.existsSync(outFile)) {
  const lines = fs.readFileSync(outFile, 'utf8').trim().split(/\r?\n/);
  if (lines.length > 1) {
    rows = lines;
    for (let i = 1; i < lines.length; i++) {
      const t = lines[i].split(',')[0];
      if (t) existing.add(t);
    }
  }
}

const todo = clean.filter((t) => !existing.has(t));
console.log(`[u] universe=${clean.length} have=${existing.size} todo=${todo.length}`);
if (todo.length === 0) {
  console.log('[u] already complete; nothing to do');
  process.exit(0);
}

// Time budget: stop after ~38s wall to leave room for write/exit
const startMs = Date.now();
const budgetMs = 38_000;
const batchSize = 50;
let done = 0;

for (let i = 0; i < todo.length; i += batchSize) {
  if (Date.now() - startMs > budgetMs) {
    console.log(`[u] time-budget reached; stopping at ${done} new`);
    break;
  }
  const batch = todo.slice(i, i + batchSize);
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
    console.error('[u] batch error:', e.message);
  }
  // Persist after each batch so we can resume on timeout
  fs.writeFileSync(outFile, rows.join('\n'));
  process.stdout.write(`\r[u] +${done} (total ${rows.length - 1}/${clean.length})`);
  await new Promise((r) => setTimeout(r, 200));
}
process.stdout.write('\n');

// Build universe_8to40.csv if complete
const total = rows.length - 1;
if (total >= clean.length * 0.95) {
  const header = rows[0].split(',');
  const priceIdx = header.indexOf('price');
  const filtered = [rows[0]];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split(',');
    const p = parseFloat(cells[priceIdx]);
    if (Number.isFinite(p) && p >= 8 && p <= 40) filtered.push(rows[i]);
  }
  fs.writeFileSync(path.join(OUT, 'universe_8to40.csv'), filtered.join('\n'));
  console.log(`[u] DONE rows=${total} 8to40=${filtered.length - 1}`);
} else {
  console.log(`[u] partial rows=${total}/${clean.length}`);
}
