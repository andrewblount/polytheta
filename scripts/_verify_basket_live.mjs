// Spot-check each basket leg against live Yahoo quotes/options.
import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

const expiry = new Date('2026-04-24T00:00:00Z');
const positions = [
  { t: 'GTLB', k: 27,    cr: 0.57, n: 170, type: 'call' },
  { t: 'DOW',  k: 44.5,  cr: 1.07, n: 100, type: 'call' },
  { t: 'DBX',  k: 28,    cr: 0.47, n: 170, type: 'call' },
  { t: 'HIMS', k: 33,    cr: 0.52, n: 140, type: 'call' },
  { t: 'PL',   k: 35,    cr: 0.75, n: 110, type: 'put'  },
  { t: 'SMR',  k: 11.5,  cr: 0.25, n: 340, type: 'put'  },
  { t: 'LUNR', k: 25,    cr: 0.58, n: 150, type: 'put'  },
  { t: 'RIOT', k: 16.5,  cr: 0.29, n: 240, type: 'put'  },
];

let totCred = 0, totMargin = 0;
const results = [];
for (const p of positions) {
  try {
    const q = await yf.quote(p.t);
    const chain = await yf.options(p.t, { date: expiry });
    const list = p.type === 'call' ? chain.options[0].calls : chain.options[0].puts;
    const opt = list.find((o) => Math.abs(o.strike - p.k) < 0.01);
    if (!opt) {
      console.log(`${p.t} ${p.type} K=${p.k} — NOT IN LIVE CHAIN`);
      continue;
    }
    const mid = (opt.bid + opt.ask) / 2;
    const drift = mid - p.cr;
    // Margin (naked option Reg-T approx): greater of (20% * spot - OTM, 10% * strike) + premium
    const spot = q.regularMarketPrice;
    const otm = p.type === 'call' ? p.k - spot : spot - p.k;
    const a = 0.20 * spot - Math.max(otm, 0);
    const b = 0.10 * p.k;
    const perShare = Math.max(a, b) + p.cr;
    const marginPerContract = perShare * 100;
    const totMarg = marginPerContract * p.n;
    const totCr = p.cr * 100 * p.n;
    totCred += totCr;
    totMargin += totMarg;
    results.push({ ticker: p.t, type: p.type, k: p.k, spot, bid: opt.bid, ask: opt.ask, mid, drift, iv: opt.impliedVolatility, vol: opt.volume, oi: opt.openInterest, cred: totCr, margin: totMarg });
    console.log(`${p.t.padEnd(5)} ${p.type} K=${p.k}  spot=$${spot?.toFixed(2)}  bid=${opt.bid}  ask=${opt.ask}  mid=$${mid.toFixed(3)}  (basket cr=$${p.cr}; drift=$${drift.toFixed(3)})  IV=${(opt.impliedVolatility*100).toFixed(0)}%  vol=${opt.volume}  OI=${opt.openInterest}`);
  } catch (e) {
    console.log(`${p.t}: err ${e.message}`);
  }
}

console.log(`\nTOTAL credit: $${totCred.toFixed(0)}`);
console.log(`TOTAL margin: $${totMargin.toFixed(0)} (${(totMargin / 1_000_000 * 100).toFixed(1)}% of $1M equity)`);
console.log(`If all expire worthless: +$${totCred.toFixed(0)} = +${(totCred / 1_000_000 * 100).toFixed(2)}% weekly`);

fs.writeFileSync(
  path.join(REPO_ROOT, 'baskets', '2026-04-20', 'data', 'verify_live_2026-04-19.json'),
  JSON.stringify({ run_ts: new Date().toISOString(), total_credit: totCred, total_margin: totMargin, positions: results }, null, 2)
);
console.log('\nwrote verify_live_2026-04-19.json');
