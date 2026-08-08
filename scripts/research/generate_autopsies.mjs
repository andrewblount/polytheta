#!/usr/bin/env node
// An autopsy for every losing leg, generated instead of hand written,
// on the same four headings as docs/trade_autopsy_2026-05-11.md: what
// the system saw, what actually happened, why the loss was that size,
// and whether it generalizes. Hand written analysis does not survive a
// busy month; this survives anything that can run node.
//
//   node scripts/research/generate_autopsies.mjs
//
// Output: docs/autopsies/<week>_<ticker>_<side>.md, an index, and a
// put-side summary the calls already had.
import fs from 'node:fs';
import path from 'node:path';
import { weeks, proposal, loadCache, saveCache, closes, closeOn, thrust, REPO } from './retro_lib.mjs';

const cache = loadCache();
const OUT = path.join(REPO, 'docs', 'autopsies');
fs.mkdirSync(OUT, { recursive: true });
const fmt = (n) => (n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `+$${Math.round(n).toLocaleString()}`);

const settled = [];
for (const week of weeks()) {
  const prop = proposal(week);
  const expiry = prop.expiry;
  if (!expiry || expiry > new Date().toISOString().slice(0, 10)) continue;
  for (const p of prop.picks ?? []) {
    const series = await closes(p.ticker, cache);
    const settle = closeOn(series, expiry);
    if (!settle) continue;
    const K = Number(p.K), cr = Number(p.cr), px = Number(p.px);
    const contracts = Math.max(1, Math.round(15000 / (K * 100 * 0.2)));
    const intrinsic = p.side === 'call' ? Math.max(0, settle.close - K) : Math.max(0, K - settle.close);
    const pnl = (cr - intrinsic) * 100 * contracts;
    // walk the week for the breach day and the worst close
    const days = Object.keys(series).filter((d) => d > week && d <= expiry).sort();
    let breach = null, worst = { d: settle.date, c: settle.close };
    for (const d of days) {
      const c = series[d];
      const itm = p.side === 'call' ? c > K : c < K;
      if (itm && !breach) breach = { d, c };
      if (p.side === 'call' ? c > worst.c : c < worst.c) worst = { d, c };
    }
    settled.push({ week, expiry, ...p, K, cr, px, settle: settle.close, intrinsic, contracts, pnl, breach, worst,
                   th: thrust(series, week) });
  }
  saveCache(cache);
}

const losers = settled.filter((l) => l.intrinsic > 0);
for (const l of losers) {
  const th = l.th ? `1d ${l.th.d1.toFixed(1)}%, 3d ${l.th.d3.toFixed(1)}%, 10d ${l.th.d10.toFixed(1)}%` : 'no price series';
  const guard = l.th && (l.th.d1 >= 8 || l.th.d3 >= 15 || l.th.d10 >= 20)
    ? 'the frenzy guard shipped 26 July would have flagged this entry'
    : 'the frenzy guard would not have flagged this, so the loss came from something the current screens still allow';
  const md = `# Autopsy, ${l.ticker} ${l.side}, week of ${l.week}

Short ${l.contracts} ${l.ticker} ${l.expiry} $${l.K} ${l.side}s at $${l.cr} credit.
Modeled loss ${fmt(l.pnl)}.

## What the system saw

${l.ticker} at $${l.px} on the Sunday, strike $${l.K} (${Math.abs(((l.K - l.px) / l.px) * 100).toFixed(0)}% OTM), ATR ${l.atr}, buffer ${l.buf}, IV ${l.iv}, delta ${l.delta}. Pre-entry thrust ${th}.

## What actually happened

${l.breach ? `Crossed the strike on ${l.breach.d} at $${l.breach.c.toFixed(2)}.` : 'Never crossed the strike intraweek on closes, but finished through it.'} Worst close ${l.worst.c.toFixed(2)} on ${l.worst.d}. Settled ${l.settle.toFixed(2)} on ${l.expiry}, intrinsic $${l.intrinsic.toFixed(2)} against $${l.cr} collected.

## Why the loss was this size

Credit collected covered ${(100 * l.cr / (l.intrinsic || l.cr)).toFixed(0)}% of the intrinsic at settlement. The 25% stop, had it fired at the first breach close, caps this near ${fmt(-0.25 * 15000)} per leg.

## Does it generalize

${guard}. See docs/rejection_retro.md for the same flags across every candidate the system rejected.
`;
  fs.writeFileSync(path.join(OUT, `${l.week}_${l.ticker}_${l.side}.md`), md);
}

// put-side summary, the analysis the calls got in May
const puts = settled.filter((l) => l.side === 'put');
const putLosers = puts.filter((l) => l.intrinsic > 0);
const calm = puts.filter((l) => l.th && !(l.th.d1 >= 8 || l.th.d3 >= 15 || l.th.d10 >= 20));
const frenzied = puts.filter((l) => l.th && (l.th.d1 >= 8 || l.th.d3 >= 15 || l.th.d10 >= 20));
const dropThrust = puts.filter((l) => l.th && (l.th.d1 <= -8 || l.th.d3 <= -15 || l.th.d10 <= -20));
const avg = (a) => (a.length ? a.reduce((s, l) => s + l.pnl, 0) / a.length : 0);
const putMd = `# Put-side review, the treatment the calls got in May

Generated ${new Date().toISOString().slice(0, 10)}. ${puts.length} settled put legs, ${putLosers.length} finished in the money.

The May autopsy validated the frenzy guard on calls: upward thrust into
entry predicted call losses. Puts fail the opposite way, on names already
falling, so the symmetric question is whether *downward* thrust into entry
predicts put losses.

Upward-frenzied entries: n ${frenzied.length}, avg ${fmt(avg(frenzied))}.
Calm entries: n ${calm.length}, avg ${fmt(avg(calm))}.
Downward-thrust entries (1d under -8%, 3d under -15%, or 10d under -20%): n ${dropThrust.length}, avg ${fmt(avg(dropThrust))}.

${putLosers.length ? `Put legs that finished in the money (a small breach can still net positive against its credit), each with a generated autopsy in docs/autopsies:\n\n| Week | Ticker | Settle vs K | P&L |\n|---|---|---|---|\n${putLosers.map((l) => `| ${l.week} | ${l.ticker} | ${l.settle.toFixed(2)} vs ${l.K} | ${fmt(l.pnl)} |`).join('\n')}` : 'No settled put leg has finished in the money yet, which is itself the finding: the loss tail so far is entirely on the call side.'}

If the downward-thrust row is negative and the calm row is positive, the
guard should gain a mirrored threshold for puts. If not, put selection is
not where the risk lives and the guard stays call-only.
`;
fs.writeFileSync(path.join(REPO, 'docs', 'trade_autopsy_puts.md'), putMd);

const index = `# Autopsies\n\nGenerated by scripts/research/generate_autopsies.mjs. One file per losing leg.\n\n${losers.map((l) => `- [${l.week} ${l.ticker} ${l.side}](autopsies/${l.week}_${l.ticker}_${l.side}.md) ${fmt(l.pnl)}`).join('\n')}\n`;
fs.writeFileSync(path.join(OUT, 'INDEX.md'), index);
console.log(`settled legs: ${settled.length}, losers autopsied: ${losers.length}, puts: ${puts.length} (${putLosers.length} losing)`);
