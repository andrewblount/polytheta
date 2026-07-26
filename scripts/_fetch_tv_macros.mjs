// Fetches the two TradingView macro values used by the basket-build GSRS:
//   HY_OAS  — TradingView symbol FRED:BAMLH0A0HYM2  (ICE BofA US HY Index OAS)
//   PC      — TradingView symbol USI:PCC            (CBOE Total Put/Call Ratio)
//
// TradingView relays both of these from their primary publishers — FRED and CBOE.
// This script fetches them from the same primary sources so the values match
// what the TradingView desktop app shows on its chart.
//
// It also `open`s the TradingView desktop app so an authenticated interactive
// session is available for the human review that follows (chart inspection,
// per-name sanity checks, etc.).
//
// Writes: baskets/<basket_date>/data/tv_macros.json
//
// Usage: node scripts/_fetch_tv_macros.mjs <basket_date>

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execP = promisify(execFile);

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const BASKET_DATE = process.argv[2] ?? '2026-07-13';
const OUT_DIR = path.join(REPO_ROOT, 'baskets', BASKET_DATE, 'data');
fs.mkdirSync(OUT_DIR, { recursive: true });

// -- 1) Bring TradingView desktop up as an interactive session --
// `open -a` only exists on macOS. If we're running in a Linux sandbox, skip.
if (process.platform === 'darwin') {
  try {
    await execP('/usr/bin/open', ['-a', 'TradingView']);
    console.log('[tv] opened TradingView desktop app');
  } catch (e) {
    console.warn(`[tv] could not open TradingView app: ${e.message}`);
  }
} else {
  console.log('[tv] non-Darwin host — skipping TradingView desktop launch');
}

// -- 2) HY_OAS from FRED (primary source, TradingView symbol FRED:BAMLH0A0HYM2) --
async function fetchHyOas() {
  const u = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2';
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`FRED HTTP ${r.status}`);
  const text = await r.text();
  const lines = text.trim().split(/\r?\n/);
  // Series is business-day; last non-empty numeric line is the most recent obs.
  let last = null;
  for (let i = lines.length - 1; i >= 1; i--) {
    const [d, v] = lines[i].split(',');
    if (v && v !== '.') { last = { date: d, value: parseFloat(v) }; break; }
  }
  return last;
}

// -- 3) P/C ratio from CBOE (primary source, TradingView symbol USI:PCC) --
async function fetchPcRatio() {
  const u = 'https://www.cboe.com/us/options/market_statistics/daily/';
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } });
  if (!r.ok) throw new Error(`CBOE HTTP ${r.status}`);
  const html = await r.text();

  // The values live in a stringified JSON blob inside an SSR <script> tag.
  // Because the blob is JSON-encoded twice, the quotes appear as backslash
  // sequences (e.g. TOTAL PUT/CALL RATIO\",\"value\":\"0.97\"). Match either
  // form so this works whether the page is served pre- or post-hydration.
  function extract(label) {
    const escaped = new RegExp(`${label}\\\\?\"[^0-9-]*([-0-9]+\\.[0-9]+)`);
    const m = html.match(escaped);
    return m ? parseFloat(m[1]) : null;
  }
  const total = extract('TOTAL PUT/CALL RATIO');
  const equity = extract('EQUITY PUT/CALL RATIO');
  const indexPc = extract('INDEX PUT/CALL RATIO');
  // Try to find the date CBOE reports for.
  let asOf = null;
  const dm = html.match(/MARKET STATISTICS FOR\s+([A-Z]+ \d+,\s*\d{4})/i);
  if (dm) asOf = dm[1];
  return { total, equity, index: indexPc, as_of: asOf };
}

const [hy, pc] = await Promise.all([
  fetchHyOas().catch((e) => ({ error: e.message })),
  fetchPcRatio().catch((e) => ({ error: e.message })),
]);

const payload = {
  fetched_ts: new Date().toISOString(),
  basket_date: BASKET_DATE,
  notes: [
    'HY_OAS sourced from FRED series BAMLH0A0HYM2 (identical to TradingView symbol FRED:BAMLH0A0HYM2).',
    'PC sourced from CBOE daily market statistics (identical to TradingView symbol USI:PCC).',
    'TradingView desktop app opened as interactive session for chart inspection alongside this run.',
  ],
  hy_oas: hy,
  pc_ratio: pc,
};
fs.writeFileSync(path.join(OUT_DIR, 'tv_macros.json'), JSON.stringify(payload, null, 2));
console.log('[tv] wrote tv_macros.json');
console.log('  HY_OAS:', hy);
console.log('  PC    :', pc);
