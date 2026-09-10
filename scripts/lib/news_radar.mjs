import fs from 'node:fs';
import { createYahooClient } from './yahoo_client.mjs';
import { classifyNews } from '../../shared/news-radar.mjs';
const yf = createYahooClient();
// A failed scan is unknown and retried. Successful scans expire in 15 min.
export async function scanRadar(tickers, cacheFile, { concurrency = 4, names = {}, signal } = {}) {
  const client = signal ? createYahooClient({ signal }) : yf;
  let cache = {};
  try { if (cacheFile) cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* first run */ }
  const missing = tickers.filter(t => !cache[t] || cache[t].error || !cache[t].checked_at || Date.now() - Date.parse(cache[t].checked_at) > 900000);
  for (let i = 0; i < missing.length; i += concurrency) {
    signal?.throwIfAborted();
    const results = await Promise.all(missing.slice(i, i + concurrency).map(async ticker => {
      try {
        const r = await client.search(ticker, { newsCount: 20, quotesCount: 1 });
        return [ticker, classifyNews(r.news ?? [], { ticker, name: names[ticker] ?? '', lookbackHours: 96 })];
      } catch (err) { return [ticker, { call: [], put: [], error: err.message, checked_at: new Date().toISOString() }]; }
    }));
    for (const [t, value] of results) cache[t] = value;
  }
  if (cacheFile) fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  return cache;
}
