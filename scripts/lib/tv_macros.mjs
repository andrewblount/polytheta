// Fetch the two TradingView macros the basket uses (HY_OAS, P/C) from
// TradingView's own upstream feeds: FRED and CBOE. On macOS this also brings
// the TradingView desktop app up so the interactive chart session is ready
// for human review (or for future keystroke-driven cross-checking once
// osascript is granted Accessibility).

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execP = promisify(execFile);

async function openTradingViewDesktop() {
  if (process.platform !== 'darwin') return { opened: false, reason: 'non-darwin' };
  try {
    await execP('/usr/bin/open', ['-a', 'TradingView']);
    return { opened: true };
  } catch (e) {
    return { opened: false, reason: e.message };
  }
}

async function fetchHyOas() {
  const u = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2';
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`FRED HTTP ${r.status}`);
  const text = await r.text();
  const lines = text.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 1; i--) {
    const [d, v] = lines[i].split(',');
    if (v && v !== '.') return { date: d, value: parseFloat(v) };
  }
  return null;
}

async function fetchPcRatio() {
  const u = 'https://www.cboe.com/us/options/market_statistics/daily/';
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } });
  if (!r.ok) throw new Error(`CBOE HTTP ${r.status}`);
  const html = await r.text();
  function extract(label) {
    const escaped = new RegExp(`${label}\\\\?"[^0-9-]*([-0-9]+\\.[0-9]+)`);
    const m = html.match(escaped);
    return m ? parseFloat(m[1]) : null;
  }
  return {
    total: extract('TOTAL PUT/CALL RATIO'),
    equity: extract('EQUITY PUT/CALL RATIO'),
    index: extract('INDEX PUT/CALL RATIO'),
    as_of: null,
  };
}

export async function fetchTvMacros({ OUT, BASKET_DATE }) {
  const tvOpen = await openTradingViewDesktop();
  const [hy, pc] = await Promise.all([
    fetchHyOas().catch((e) => ({ error: e.message })),
    fetchPcRatio().catch((e) => ({ error: e.message })),
  ]);
  const payload = {
    fetched_ts: new Date().toISOString(),
    basket_date: BASKET_DATE,
    tv_desktop_opened: tvOpen,
    notes: [
      'HY_OAS sourced from FRED series BAMLH0A0HYM2 (identical to TradingView symbol FRED:BAMLH0A0HYM2).',
      'PC sourced from CBOE daily market statistics (identical to TradingView symbol USI:PCC).',
      tvOpen.opened
        ? 'TradingView desktop app opened as interactive session for chart inspection alongside this run.'
        : `TradingView desktop app was NOT opened this run (${tvOpen.reason}).`,
    ],
    hy_oas: hy, pc_ratio: pc,
  };
  fs.writeFileSync(path.join(OUT, 'tv_macros.json'), JSON.stringify(payload, null, 2));
  return payload;
}
