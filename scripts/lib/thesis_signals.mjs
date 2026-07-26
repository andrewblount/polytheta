// Thesis-confirmation signals for the weekly basket (docs/options_trading_system.md).
//
// The system defines five weighted signals per side. Of those, only short
// interest can be fetched automatically (Yahoo defaultKeyStatistics). Fan
// score (QuiverQuant), Glassdoor, buyback programs, and the two radars require
// judgment or data sources we don't have API access to — those come from a
// manual overrides file the trader maintains:
//
//   baskets/thesis_overrides.json
//   {
//     "HIMS": { "buyback": 0, "fan": 6, "glassdoor": 2.5,
//               "acq_radar": "clean", "gap_radar": "clean",
//               "note": "FTC overhang", "as_of": "2026-07-20" },
//     ...
//   }
//
// buyback: -1 active program (CALL SIDE: strictly disqualifying)
//           0 none in last 12 months
//          +1 active program (put-side positive signal)
// radars:  "clean" | "triggered"
//
// Every signal is tri-state: pass / fail / unknown. Unknown signals are never
// silently treated as passes — coverage is reported so the 3-of-5 rule's
// enforceability is visible week by week.

import fs from 'node:fs';
import path from 'node:path';
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

export function loadOverrides(repoRoot) {
  const file = path.join(repoRoot, 'baskets', 'thesis_overrides.json');
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete raw._comment;
    return raw;
  } catch (err) {
    console.error(`[signals] thesis_overrides.json unreadable: ${err.message}`);
    return {};
  }
}

// Fetch short interest (% of float) for a list of tickers, with an on-disk
// cache inside the week's data dir so re-runs are idempotent and Monday's
// values are what the basket is judged against (walk-forward discipline).
export async function fetchShortInterest(tickers, cacheFile, { concurrency = 5 } = {}) {
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
          const qs = await yf.quoteSummary(t, { modules: ['defaultKeyStatistics'] });
          const ks = qs?.defaultKeyStatistics ?? {};
          const frac = ks.shortPercentOfFloat ?? null;
          return [t, {
            si_pct: frac != null ? +(frac * 100).toFixed(2) : null,
            shares_short: ks.sharesShort ?? null,
            short_ratio: ks.shortRatio ?? null,
            fetched_at: new Date().toISOString(),
          }];
        } catch (err) {
          return [t, { si_pct: null, error: err.message, fetched_at: new Date().toISOString() }];
        }
      }),
    );
    for (const [t, v] of results) cache[t] = v;
    if (i + concurrency < missing.length) await new Promise((r) => setTimeout(r, 300));
  }
  if (cacheFile) fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  return cache;
}

function tri(pass) {
  return pass == null ? 'unknown' : pass ? 'pass' : 'fail';
}

// Evaluate the five documented signals for one ticker+side.
// Returns { checks: {si, fan, culture, buyback, radar}, known, passed,
//           disqualified, si_pct }
export function evaluateSignals({ ticker, side, siCache, overrides }) {
  const si = siCache?.[ticker]?.si_pct ?? null;
  const o = overrides?.[ticker] ?? {};

  const siPass = si == null ? null : side === 'call' ? si >= 20 : si < 15;
  const fanPass = o.fan == null ? null : side === 'call' ? o.fan <= 7 : o.fan >= 7 && o.fan <= 10;
  const culturePass =
    o.glassdoor == null ? null : side === 'call' ? o.glassdoor <= 3.4 : o.glassdoor > 3.5;
  const buybackPass =
    o.buyback == null ? null : side === 'call' ? o.buyback === 0 : o.buyback === 1;
  const radarVal = side === 'call' ? o.acq_radar : o.gap_radar;
  const radarPass = radarVal == null ? null : radarVal === 'clean';

  // Hard disqualifiers per the spec: active buyback on call side ("automatic
  // skip, no exceptions"), any triggered radar on its side.
  const disqualified =
    (side === 'call' && o.buyback === -1) || radarVal === 'triggered';

  const all = [siPass, fanPass, culturePass, buybackPass, radarPass];
  const known = all.filter((v) => v != null).length;
  const passed = all.filter((v) => v === true).length;

  return {
    si_pct: si,
    checks: {
      short_interest: tri(siPass),
      fan_score: tri(fanPass),
      culture: tri(culturePass),
      buyback: tri(buybackPass),
      radar: tri(radarPass),
    },
    known,
    passed,
    failed: all.filter((v) => v === false).length,
    disqualified,
    override_note: o.note ?? null,
    override_as_of: o.as_of ?? null,
  };
}
