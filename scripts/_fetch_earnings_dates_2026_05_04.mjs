// Fetches next earnings date for tickers in the 2026-05-04 basket refined shortlists.
// Mirrors scripts/_fetch_earnings_dates.mjs but with the holding window pinned
// to 2026-05-04 .. 2026-05-08.

import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const BASKET_DATE = process.argv[2] ?? '2026-05-04';
const HOLD_START = BASKET_DATE;
const HOLD_END = process.argv[3] ?? '2026-05-08';
const OUT = path.join(REPO_ROOT, 'baskets', BASKET_DATE, 'data');

const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const cells = [];
    let cur = '', inQ = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (inQ) {
        if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { cells.push(cur); cur = ''; }
        else cur += c;
      }
    }
    cells.push(cur);
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i]; });
    return obj;
  });
}

const refinedCalls = readCsv(path.join(OUT, 'shortlist_calls_refined.csv'));
const refinedPuts = readCsv(path.join(OUT, 'shortlist_puts_refined.csv'));
const tickers = new Set([
  ...refinedCalls.map((r) => r.ticker),
  ...refinedPuts.map((r) => r.ticker),
]);
const list = [...tickers].filter(Boolean).sort();
console.log(`[earnings] fetching for ${list.length} tickers`);

async function fetchOne(ticker) {
  try {
    const [qs, q] = await Promise.allSettled([
      yf.quoteSummary(ticker, { modules: ['calendarEvents', 'earnings'] }),
      yf.quote(ticker),
    ]);
    const out = { ticker, source: [], next_date: null, raw: {} };
    if (qs.status === 'fulfilled') {
      const ce = qs.value?.calendarEvents?.earnings;
      const dates = ce?.earningsDate ?? [];
      const isoDates = dates
        .map((d) => (d instanceof Date ? d : new Date(d)))
        .filter((d) => !isNaN(d.getTime()))
        .map((d) => d.toISOString().slice(0, 10));
      if (isoDates.length) {
        out.next_date = isoDates[0];
        out.source.push('calendarEvents');
        out.raw.calendarEvents_dates = isoDates;
      }
    }
    if (!out.next_date && q.status === 'fulfilled') {
      const t = q.value?.earningsTimestamp ?? q.value?.earningsTimestampStart;
      if (t) {
        const d = t instanceof Date ? t : new Date(t * (t > 1e12 ? 1 : 1000));
        const iso = d.toISOString().slice(0, 10);
        out.next_date = iso;
        out.source.push('quote.earningsTimestamp');
        out.raw.earningsTimestamp = iso;
      }
    }
    return out;
  } catch (e) {
    return { ticker, error: e.message };
  }
}

const results = [];
const concurrency = 6;
let idx = 0;
async function worker() {
  while (idx < list.length) {
    const i = idx++;
    const t = list[i];
    const r = await fetchOne(t);
    results.push(r);
    if (results.length % 10 === 0) {
      process.stdout.write(`\r[earnings] ${results.length}/${list.length}`);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
process.stdout.write('\n');

const byT = Object.fromEntries(results.map((r) => [r.ticker, r]));
fs.writeFileSync(path.join(OUT, 'earnings_dates.json'), JSON.stringify(byT, null, 2));
console.log(`[earnings] wrote ${path.join(OUT, 'earnings_dates.json')}`);

const flagged = results.filter(
  (r) => r.next_date && r.next_date >= HOLD_START && r.next_date <= HOLD_END
);
console.log(`\n[earnings] inside holding window ${HOLD_START}..${HOLD_END}: ${flagged.length}`);
for (const r of flagged.sort((a, b) => a.next_date.localeCompare(b.next_date))) {
  console.log(`  ${r.ticker.padEnd(6)} ${r.next_date}  src=${r.source.join('+')}`);
}
