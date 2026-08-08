// Shared plumbing for the rejection retro and the autopsy generator.
// Everything reads from disk except one price fetch per unique ticker,
// cached to baskets/retro_cache/prices.json so re-runs are free.
import fs from 'node:fs';
import path from 'node:path';
import YahooFinanceMod from 'yahoo-finance2';

const YahooFinance = YahooFinanceMod.default ?? YahooFinanceMod;
export const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

export const REPO = process.cwd();
export const CACHE_DIR = path.join(REPO, 'baskets', 'retro_cache');
export const CACHE = path.join(CACHE_DIR, 'prices.json');

export function weeks() {
  return fs.readdirSync(path.join(REPO, 'baskets'))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter((d) => fs.existsSync(path.join(REPO, 'baskets', d, 'data', 'basket_proposal.json')))
    .sort();
}

export function proposal(week) {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'baskets', week, 'data', 'basket_proposal.json'), 'utf8'));
}

export function shortlist(week) {
  // refined when present, raw otherwise; refined carries the same columns
  const dir = path.join(REPO, 'baskets', week, 'data');
  for (const name of ['shortlist_calls_refined.csv', 'shortlist_calls.csv']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return csv(p);
  }
  return [];
}

export function csv(p) {
  // A real quoted-field parser. The first version split on commas and
  // silently shifted every numeric column for any company whose name
  // contains one, which turned the put retro into fiction. "Apple, Inc."
  // is not an edge case in a stock screener.
  const split = (line) => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const [head, ...rows] = fs.readFileSync(p, 'utf8').trim().split('\n');
  const cols = split(head);
  return rows.map((r) => {
    const vals = split(r);
    const o = {};
    cols.forEach((c, i) => { o[c] = vals[i]; });
    return o;
  });
}

export function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return {}; }
}

export function saveCache(c) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(c));
}

// Daily closes for one ticker across the whole season, one request.
export async function closes(ticker, cache) {
  if (cache[ticker]) return cache[ticker];
  try {
    const res = await yf.chart(ticker, {
      period1: '2026-04-01', period2: '2026-08-10', interval: '1d',
    });
    const out = {};
    for (const q of res.quotes ?? []) {
      if (q.close != null) out[q.date.toISOString().slice(0, 10)] = q.close;
    }
    cache[ticker] = out;
    return out;
  } catch (e) {
    cache[ticker] = { __error: String(e.message || e).slice(0, 80) };
    return cache[ticker];
  }
}

// Close on the given date, or the nearest trading day before it.
export function closeOn(series, iso) {
  if (!series || series.__error) return null;
  const dates = Object.keys(series).sort();
  let best = null;
  for (const d of dates) { if (d <= iso) best = d; else break; }
  return best ? { date: best, close: series[best] } : null;
}

// Pre-entry thrust off the entry date, matching the frenzy guard's shape.
export function thrust(series, entryIso) {
  if (!series || series.__error) return null;
  const dates = Object.keys(series).sort().filter((d) => d <= entryIso);
  if (dates.length < 11) return null;
  const px = (i) => series[dates[dates.length - 1 - i]];
  const pct = (a, b) => (a / b - 1) * 100;
  return { d1: pct(px(0), px(1)), d3: pct(px(0), px(3)), d10: pct(px(0), px(10)) };
}
