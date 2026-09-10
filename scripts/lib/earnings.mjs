// Generic earnings-dates fetcher — pulls next earnings for the tickers in
// refined shortlists so the basket builder can hard-filter names with a print
// inside the holding window.

import { createYahooClient } from './yahoo_client.mjs';
import fs from 'node:fs';
import path from 'node:path';

const yf = createYahooClient();

function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const cells = l.split(',');
    const obj = {}; header.forEach((h, i) => obj[h] = cells[i]); return obj;
  });
}

async function fetchOne(ticker, client = yf, now = new Date()) {
  try {
    const [qs, q] = await Promise.allSettled([
      client.quoteSummary(ticker, { modules: ['calendarEvents', 'earnings'] }),
      client.quote(ticker),
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
    if (qs.status === 'rejected' && q.status === 'rejected') throw new Error('Earnings sources failed');
    if (!out.next_date) out.error = 'No confirmed earnings date';
    out.fetched_at = now.toISOString();
    return out;
  } catch (e) {
    return { ticker, error: e.message, fetched_at: now.toISOString() };
  }
}

export async function runEarnings({ OUT, concurrency = 6, force = false, client = yf, now = new Date() }) {
  const rc = readCsv(path.join(OUT, 'shortlist_calls_refined.csv'));
  const rp = readCsv(path.join(OUT, 'shortlist_puts_refined.csv'));
  const list = [...new Set([...rc.map((r) => r.ticker), ...rp.map((r) => r.ticker)])]
    .filter(Boolean).sort();
  const file = path.join(OUT, 'earnings_dates.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  const missing = list.filter(ticker => {
    const row = cache[ticker], age = +now - Date.parse(row?.fetched_at);
    return force || !row?.next_date || row.error || !Number.isFinite(age) || age < 0 || age >= 6 * 3600000;
  });
  let idx = 0;
  async function worker() {
    while (idx < missing.length) {
      const i = idx++;
      cache[missing[i]] = await fetchOne(missing[i], client, now);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const byT = Object.fromEntries(list.map(ticker => [ticker, cache[ticker]]));
  fs.writeFileSync(file, JSON.stringify(byT, null, 2));
  return { fetched: missing.length, retained: list.length - missing.length, errors: list.filter(ticker => byT[ticker]?.error).length };
}
