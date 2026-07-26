// Spot-check each revised basket leg against live Yahoo.
// Uses bid (not mid) as the credit figure.
import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

const expiry = new Date('2026-04-24T00:00:00Z');
const legs = [
  { t: 'HIMS', k: 33,   cr: 0.50, n: 132, type: 'call' },
  { t: 'LUNR', k: 31,   cr: 0.48, n: 140, type: 'call' },
  { t: 'GLXY', k: 28,   cr: 0.42, n: 146, type: 'call' },
  { t: 'CELH', k: 37.5, cr: 0.37, n:  97, type: 'call' },
  { t: 'PL',   k: 35,   cr: 0.60, n: 104, type: 'put'  },
  { t: 'APLD', k: 28.5, cr: 0.53, n: 131, type: 'put'  },
  { t: 'FIGR', k: 33.5, cr: 0.45, n: 108, type: 'put'  },
  { t: 'WOLF', k: 23,   cr: 0.36, n: 172, type: 'put'  },
];

let totCred = 0, totMargin = 0;
const results = [];
for (const p of legs) {
  try {
    const q = await yf.quote(p.t);
    const ch = await yf.options(p.t, { date: expiry });
    const list = p.type === 'call' ? ch.options[0].calls : ch.options[0].puts;
    const opt = list.find((o) => Math.abs(o.strike - p.k) < 0.01);
    if (!opt) { console.log(`${p.t}: strike ${p.k} not in live chain`); continue; }
    const bid = opt.bid, ask = opt.ask, last = opt.lastPrice;
    const mid = (bid + ask) / 2;
    const drift_bid = bid - p.cr;
    const spot = q.regularMarketPrice;
    const otm = p.type === 'call' ? p.k - spot : spot - p.k;
    const a = 0.20 * spot - Math.max(otm, 0);
    const b = 0.10 * p.k;
    const perShare = Math.max(a, b) + p.cr;
    const marginPerContract = perShare * 100;
    const tm = marginPerContract * p.n;
    const tc = p.cr * 100 * p.n;
    totCred += tc; totMargin += tm;
    results.push({ ...p, spot, bid, ask, last, mid, drift_bid, iv: opt.impliedVolatility, vol: opt.volume, oi: opt.openInterest, leg_credit: tc, leg_margin: tm });
    console.log(`${p.t.padEnd(5)} ${p.type} K=${p.k}  spot=$${spot?.toFixed(2)}  bid/ask=${bid}/${ask}  mid=$${mid.toFixed(3)}  last=$${last}  (basket cr=$${p.cr.toFixed(2)}; drift_vs_bid=${drift_bid.toFixed(3)})  IV=${(opt.impliedVolatility*100).toFixed(0)}%  vol=${opt.volume}  OI=${opt.openInterest}`);
  } catch (e) {
    console.log(`${p.t} ERR ${e.message}`);
  }
}
console.log(`\nTOTAL credit (bid-based): $${totCred.toFixed(0)}`);
console.log(`TOTAL margin:              $${totMargin.toFixed(0)}  (${(totMargin/1_000_000*100).toFixed(1)}% of $1M)`);
console.log(`If all expire worthless:   +$${totCred.toFixed(0)}  =  +${(totCred/1_000_000*100).toFixed(2)}% weekly on $1M`);

fs.writeFileSync(
  path.join(REPO_ROOT, 'baskets', '2026-04-20', 'data', 'verify_live_v3_2026-04-19.json'),
  JSON.stringify({ run_ts: new Date().toISOString(), totals: { credit: totCred, margin: totMargin }, legs: results }, null, 2)
);
