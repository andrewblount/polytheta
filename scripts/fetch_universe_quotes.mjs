import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const yf = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices: ['yahooSurvey'] });
const OUT = path.join(REPO_ROOT, 'baskets', '2026-04-20', 'data');

function csvRow(vals) {
  return vals.map((v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

const universeCsv = fs.readFileSync(path.join(OUT, 'weeklys_universe.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
const clean = universeCsv.filter((t) => /^[A-Z]{1,5}$/.test(t));
const adjusted = universeCsv.filter((t) => !/^[A-Z]{1,5}$/.test(t));
console.log('clean roots:', clean.length, 'adjusted/skipped:', adjusted.length);

const rows = ['ticker,price,currency,exchange,market_cap,avg_volume,shares_outstanding,prev_close,fifty_two_wk_high,fifty_two_wk_low,eps_fwd,pe_fwd,name'];
const errs = [];
const batchSize = 50;
let done = 0;
for (let i = 0; i < clean.length; i += batchSize) {
  const batch = clean.slice(i, i + batchSize);
  try {
    const quotes = await yf.quote(batch);
    for (const q of quotes) {
      rows.push(csvRow([
        q.symbol,
        q.regularMarketPrice,
        q.currency,
        q.fullExchangeName,
        q.marketCap,
        q.averageDailyVolume10Day ?? q.averageDailyVolume3Month,
        q.sharesOutstanding,
        q.regularMarketPreviousClose,
        q.fiftyTwoWeekHigh,
        q.fiftyTwoWeekLow,
        q.epsForward,
        q.forwardPE,
        q.longName ?? q.shortName,
      ]));
    }
    done += quotes.length;
  } catch (e) {
    errs.push({ batch: batch.join(','), err: e.message });
  }
  process.stdout.write(`\rquotes: ${done}/${clean.length}`);
  await new Promise((r) => setTimeout(r, 250));
}
process.stdout.write('\n');
fs.writeFileSync(path.join(OUT, 'universe_quotes.csv'), rows.join('\n'));
if (errs.length) fs.writeFileSync(path.join(OUT, 'universe_quote_errors.json'), JSON.stringify(errs, null, 2));
console.log('wrote universe_quotes.csv, rows:', rows.length - 1, 'errors:', errs.length);
