import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices: ['yahooSurvey'] });

// Spot-check these two names against live Yahoo
const checks = [
  { ticker: 'GTLB', strike: 27, type: 'call', expected_credit: 0.57 },
  { ticker: 'SMR', strike: 11.5, type: 'put', expected_credit: 0.25 },
];
const expiry = new Date('2026-04-24T00:00:00Z');

for (const c of checks) {
  const q = await yf.quote(c.ticker);
  const chain = await yf.options(c.ticker, { date: expiry });
  const list = c.type === 'call' ? chain.options[0].calls : chain.options[0].puts;
  const opt = list.find((o) => Math.abs(o.strike - c.strike) < 0.01);
  console.log(`\n=== ${c.ticker} ===`);
  console.log(`  Live price: $${q.regularMarketPrice} (basket used $${c.ticker === 'GTLB' ? 21.42 : 12.65})`);
  if (!opt) {
    console.log(`  STRIKE $${c.strike} NOT IN LIVE CHAIN`);
    continue;
  }
  const mid = (opt.bid + opt.ask) / 2;
  console.log(`  Strike $${c.strike} ${c.type}: bid=${opt.bid}, ask=${opt.ask}, mid=${mid.toFixed(3)}, last=${opt.lastPrice}`);
  console.log(`  IV=${(opt.impliedVolatility * 100).toFixed(1)}%, Vol=${opt.volume}, OI=${opt.openInterest}`);
  console.log(`  Basket used credit: $${c.expected_credit} (diff: ${(mid - c.expected_credit).toFixed(3)})`);
}

// Sizing sanity check
console.log('\n=== SIZING MATH CHECK ===');
const positions = [
  { t: 'GTLB', spot: 21.42, k: 27, cr: 0.57, n: 170, typ: 'call' },
  { t: 'DOW', spot: 35.60, k: 44.50, cr: 1.07, n: 100, typ: 'call' },
  { t: 'DBX', spot: 24.27, k: 28, cr: 0.47, n: 170, typ: 'call' },
  { t: 'HIMS', spot: 28.82, k: 33, cr: 0.52, n: 140, typ: 'call' },
  { t: 'PL', spot: 38.48, k: 35, cr: 0.75, n: 110, typ: 'put' },
  { t: 'SMR', spot: 12.65, k: 11.50, cr: 0.25, n: 340, typ: 'put' },
  { t: 'LUNR', spot: 27.58, k: 25, cr: 0.58, n: 150, typ: 'put' },
  { t: 'RIOT', spot: 18.11, k: 16.50, cr: 0.29, n: 240, typ: 'put' },
];

let totCred = 0, totMargin = 0;
for (const p of positions) {
  // Schwab naked option margin formula: greater of (20% * underlying - OTM amount, 10% * strike) + premium
  const otm = p.typ === 'call' ? p.k - p.spot : p.spot - p.k;
  const a = 0.20 * p.spot - otm;
  const b = 0.10 * p.k;
  const perShare = Math.max(a, b) + p.cr;
  const marginPerContract = perShare * 100;
  const totalMargin = marginPerContract * p.n;
  const totalCredit = p.cr * 100 * p.n;
  const marginPct = totalMargin / 1_000_000 * 100;
  console.log(`${p.t.padEnd(5)} ${p.typ}  n=${p.n.toString().padStart(3)}  m/c=$${marginPerContract.toFixed(0).padStart(4)}  total_m=$${totalMargin.toFixed(0).padStart(6)}  total_cr=$${totalCredit.toFixed(0).padStart(6)}  %eq=${marginPct.toFixed(1)}%`);
  totCred += totalCredit;
  totMargin += totalMargin;
}
console.log(`\nTOTAL credit: $${totCred.toFixed(0)}`);
console.log(`TOTAL margin: $${totMargin.toFixed(0)} (${(totMargin / 1_000_000 * 100).toFixed(1)}% of $1M equity)`);
console.log(`Cash needed at 4x leverage: $${(totMargin / 4).toFixed(0)}`);
console.log(`If all expire worthless: +$${totCred.toFixed(0)} = +${(totCred / 1_000_000 * 100).toFixed(2)}% weekly on equity`);
