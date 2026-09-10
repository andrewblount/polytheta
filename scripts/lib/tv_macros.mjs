// TradingView's upstream feeds, fetched directly: no desktop login or fragile
// browser automation needed for HY OAS and total put/call ratio.
import fs from 'node:fs';
import path from 'node:path';
import { retryRead } from '../../shared/retry.mjs';
import { easternTime } from '../../shared/market-calendar.mjs';
async function download(url) {
  return retryRead(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'PolyTheta market research' } });
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return response.text();
  });
}
export function parsePcRatio(html) {
  const text = html.replace(/\\"/g, '"');
  const value = label => {
    const m = text.match(new RegExp(`"name":"${label}"\\s*,\\s*"value":"?([0-9.]+)`));
    return m ? Number(m[1]) : null;
  };
  const total = value('TOTAL PUT/CALL RATIO');
  const as_of = text.match(/"selectedDate":"(\d{4}-\d{2}-\d{2})"/)?.[1];
  if (!Number.isFinite(total) || total <= 0 || !as_of) throw new Error('CBOE format changed or ratio/date missing');
  return { total, equity: value('EQUITY PUT/CALL RATIO'), index: value('INDEX PUT/CALL RATIO'), as_of };
}
export function parseHyOas(text) {
  const rows = text.trim().split(/\r?\n/).slice(1).map(line => line.split(','));
  for (const [date, raw] of rows.reverse()) {
    const value = Number(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 0) return { date, value };
  }
  throw new Error('FRED data missing or format changed');
}
export async function fetchTvMacros({ OUT, BASKET_DATE }) {
  const results = await Promise.allSettled([
    download('https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2').then(parseHyOas),
    download('https://www.cboe.com/us/options/market_statistics/daily/').then(parsePcRatio),
  ]);
  const payload = { fetched_ts: new Date().toISOString(), basket_date: BASKET_DATE,
    tv_desktop_opened: { opened: false, reason: 'direct-upstream-feeds' },
    hy_oas: results[0].status === 'fulfilled' ? results[0].value : null,
    pc_ratio: results[1].status === 'fulfilled' ? results[1].value : null,
    error: results.filter(r => r.status === 'rejected').map(r => r.reason.message).join('; ') || null };
  for (const date of [payload.hy_oas?.date, payload.pc_ratio?.as_of]) {
    const age = Date.parse(easternTime().date) - Date.parse(date);
    if (!Number.isFinite(age) || age < 0 || age > 7 * 86400000) payload.error = 'Macro publication date missing, future, or more than 7 days old';
  }
  fs.writeFileSync(path.join(OUT, 'tv_macros.json'), JSON.stringify(payload, null, 2));
  if (payload.error) throw new Error(payload.error);
  return payload;
}
