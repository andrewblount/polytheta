// Pre-entry news radar for the weekly basket build.
//
// Same keyword logic as src/server/services/news-radar.ts (keep in sync).
// At build time a radar hit DISQUALIFIES the candidate: never enter a short
// call on a name with fresh M&A chatter, or a short put on a name with fresh
// downside-gap news. A clean scan feeds the thesis scorecard as an
// auto-evaluated radar signal (overrides in thesis_overrides.json still win).

import fs from 'node:fs';
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

const ACQUISITION_KEYWORDS = [
  'acqui', 'takeover', 'take-over', 'buyout', 'merger', 'merge with',
  'tender offer', 'go private', 'going private', 'take-private',
  'strategic alternatives', 'strategic review', 'activist stake', '13d',
  'bid for', 'deal talks', 'in talks to buy', 'to be bought', 'explores sale',
  'exploring a sale', 'sale of the company',
];

const DOWNSIDE_KEYWORDS = [
  'bankrupt', 'chapter 11', 'going concern', 'sec investigation', 'sec probe',
  'doj probe', 'fraud', 'restatement', 'accounting issues', 'delist',
  'recall', 'data breach', 'cyberattack', 'cyber attack', 'hacked',
  'guidance cut', 'cuts guidance', 'withdraws guidance', 'slashes guidance',
  'ceo resigns', 'ceo steps down', 'cfo resigns', 'cfo departs',
  'stock offering', 'share offering', 'public offering', 'secondary offering',
  'dilut', 'trading halted', 'short seller', 'short report', 'class action',
  'under investigation',
];

const LOOKBACK_HOURS = 96; // wider than the live scan: covers the weekend

function classify(newsItems) {
  const cutoff = Date.now() - LOOKBACK_HOURS * 3600 * 1000;
  const out = { call: [], put: [] };
  for (const item of newsItems) {
    if (!item?.title) continue;
    const t = item.providerPublishTime ? new Date(item.providerPublishTime).getTime() : null;
    if (t && t < cutoff) continue;
    const lower = item.title.toLowerCase();
    const acq = ACQUISITION_KEYWORDS.find((k) => lower.includes(k));
    const down = DOWNSIDE_KEYWORDS.find((k) => lower.includes(k));
    const rec = {
      title: item.title,
      link: item.link ?? null,
      publisher: item.publisher ?? 'unknown',
      publishedAt: t ? new Date(t).toISOString() : null,
    };
    if (acq) out.call.push({ ...rec, matched: acq });
    if (down) out.put.push({ ...rec, matched: down });
  }
  return out;
}

// Scan a set of tickers once each; returns { TICKER: {call: hits[], put: hits[]} }.
// Cached per week so re-runs are idempotent (walk-forward: Sunday's scan is
// the record the basket was built against).
export async function scanRadar(tickers, cacheFile, { concurrency = 4 } = {}) {
  let cache = {};
  if (cacheFile && fs.existsSync(cacheFile)) {
    try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { cache = {}; }
  }
  const missing = tickers.filter((t) => !(t in cache));
  for (let i = 0; i < missing.length; i += concurrency) {
    const batch = missing.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          const r = await yf.search(t, { newsCount: 10, quotesCount: 0 });
          return [t, classify(r.news ?? [])];
        } catch (err) {
          return [t, { call: [], put: [], error: err.message }];
        }
      }),
    );
    for (const [t, v] of results) cache[t] = v;
    if (i + concurrency < missing.length) await new Promise((r) => setTimeout(r, 250));
  }
  if (cacheFile) fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  return cache;
}
