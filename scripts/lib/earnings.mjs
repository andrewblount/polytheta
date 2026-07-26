// Generic earnings-dates fetcher — pulls next earnings for the tickers in
// refined shortlists so the basket builder can hard-filter names with a print
// inside the holding window.

import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';

const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const cells = l.split(',');
    const obj = {}; header.forEach((h, i) => obj[h] = cells[i]); return obj;
  });
}

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

export async function runEarnings({ OUT, concurrency = 6 }) {
  const rc = readCsv(path.join(OUT, 'shortlist_calls_refined.csv'));
  const rp = readCsv(path.join(OUT, 'shortlist_puts_refined.csv'));
  const list = [...new Set([...rc.map((r) => r.ticker), ...rp.map((r) => r.ticker)])]
    .filter(Boolean).sort();
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < list.length) {
      const i = idx++;
      const r = await fetchOne(list[i]);
      results.push(r);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const byT = Object.fromEntries(results.map((r) => [r.ticker, r]));
  fs.writeFileSync(path.join(OUT, 'earnings_dates.json'), JSON.stringify(byT, null, 2));
  return { fetched: results.length };
}
