#!/usr/bin/env node
// The retro TODO.md calls the highest-value analysis left. Every week the
// pipeline screens a refined pool and takes a handful. The losers have
// been autopsied. The rejected names never have. This settles every
// rejected candidate at its expiry, on both sides, using the strike and
// credit the pipeline itself computed for them at the time, and asks
// which filters rejected winners.
//
//   node scripts/research/replay_rejections.mjs
//
// Output: docs/rejection_retro.md + baskets/retro_cache/rejections.json
import fs from 'node:fs';
import path from 'node:path';
import { weeks, proposal, shortlist, loadCache, saveCache, closes, closeOn, thrust, REPO } from './retro_lib.mjs';

const CONTRACT_BUDGET = 15000; // margin proxy per leg for sizing parity
const cache = loadCache();
const legs = [];

for (const week of weeks()) {
  const prop = proposal(week);
  const expiry = prop.expiry;
  if (!expiry || expiry > new Date().toISOString().slice(0, 10)) continue; // unsettled week
  const picked = new Set((prop.picks ?? []).map((p) => `${p.side}:${p.ticker}`));
  for (const row of shortlist(week)) {
    const t = row.ticker;
    if (!t || t === 'ticker') continue;
    const series = await closes(t, cache);
    const settle = closeOn(series, expiry);
    if (!settle) continue;
    const th = thrust(series, week);
    for (const side of ['call', 'put']) {
      const K = Number(side === 'call' ? row.best_call_strike : row.best_put_strike);
      const cr = Number(side === 'call' ? row.best_call_credit : row.best_put_credit);
      const buf = Number(side === 'call' ? row.call_atr_buf : row.put_atr_buf);
      const px = Number(row.price);
      const atr = Number(row.atr14);
      // A strike far from its own underlying, or a credit bigger than
      // the stock, is a parse casualty and not a trade. Refuse it.
      if (!K || !cr || cr <= 0 || !px || px <= 0) continue;
      if (K > px * 3 || K < px * 0.3 || cr > px) continue;
      const contracts = Math.max(1, Math.round(CONTRACT_BUDGET / (K * 100 * 0.2)));
      const intrinsic = side === 'call' ? Math.max(0, settle.close - K) : Math.max(0, K - settle.close);
      const pnl = (cr - intrinsic) * 100 * contracts;
      legs.push({
        week, expiry, ticker: t, side, px, K, cr, atr, buf,
        settle: settle.close, settleDate: settle.date,
        intrinsic: +intrinsic.toFixed(2), contracts, pnl: Math.round(pnl),
        win: intrinsic === 0,
        picked: picked.has(`${side}:${t}`),
        thrust1: th ? +th.d1.toFixed(1) : null,
        thrust3: th ? +th.d3.toFixed(1) : null,
        thrust10: th ? +th.d10.toFixed(1) : null,
        inBand: px >= 8 && px <= 100,
        atrFloor2x: buf >= 2,
        frenzied: th ? (th.d1 >= 8 || th.d3 >= 15 || th.d10 >= 20) : null,
        hardSkip: th ? (th.d1 >= 15 || th.d3 >= 25) : null,
      });
    }
  }
  saveCache(cache); // survive an interrupted fetch pass
}

fs.mkdirSync(path.join(REPO, 'baskets', 'retro_cache'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'baskets', 'retro_cache', 'rejections.json'), JSON.stringify(legs, null, 1));

// ---- the questions the retro exists to answer ----
const rejected = legs.filter((l) => !l.picked);
const takenN = legs.filter((l) => l.picked).length;
const sum = (a) => a.reduce((s, l) => s + l.pnl, 0);
const avg = (a) => (a.length ? Math.round(sum(a) / a.length) : 0);
const fmt = (n) => (n < 0 ? `-$${Math.abs(n).toLocaleString()}` : `+$${n.toLocaleString()}`);
const line = (label, a) =>
  `| ${label} | ${a.length} | ${Math.round((100 * a.filter((l) => l.win).length) / Math.max(1, a.length))}% | ${fmt(avg(a))} | ${fmt(sum(a))} |`;

const filters = [
  ['Frenzy guard (would flag)', rejected.filter((l) => l.frenzied === true)],
  ['Frenzy hard skip', rejected.filter((l) => l.hardSkip === true)],
  ['Calm (guard passes)', rejected.filter((l) => l.frenzied === false)],
  ['Outside $8-$100 band', rejected.filter((l) => !l.inBand)],
  ['Inside band', rejected.filter((l) => l.inBand)],
  ['ATR buffer under 2x', rejected.filter((l) => !l.atrFloor2x)],
  ['ATR buffer 2x or more', rejected.filter((l) => l.atrFloor2x)],
];

const calls = rejected.filter((l) => l.side === 'call');
const puts = rejected.filter((l) => l.side === 'put');
const best = [...rejected].sort((a, b) => b.pnl - a.pnl).slice(0, 10);
const worst = [...rejected].sort((a, b) => a.pnl - b.pnl).slice(0, 10);

const md = `# Rejection retro, every candidate the system said no to

Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/research/replay_rejections.mjs\`.
Method: for each settled week, every name on the refined shortlist that was
not picked is settled at that week's expiry, using the strike and credit the
pipeline itself computed for it on the Sunday (\`best_<side>_strike\`,
\`best_<side>_credit\`). Sizing matches the sample autopsy's margin proxy, so
numbers are comparable, and all P&L is modeled at expiry, not traded.

Settled weeks covered: ${weeks().filter((w) => { try { return proposal(w).expiry <= new Date().toISOString().slice(0,10); } catch { return false; } }).length}.
Rejected legs settled: ${rejected.length} (${calls.length} calls, ${puts.length} puts). Picked legs seen alongside: ${takenN}.

## Did the filters pay for themselves?

| Slice of the rejected pool | n | win rate | avg P&L | total P&L |
|---|---|---|---|---|
${filters.map(([l, a]) => line(l, a)).join('\n')}

Read the frenzy rows against the calm row. If frenzied rejects lost money
on average, the guard is doing its job on the names it never even showed
you. If calm rejects made money, that is the premium left on the table by
capacity, not by a filter, and arguing with it means arguing for a bigger
basket, not looser screens.

## Side by side

| Side | n | win rate | avg P&L | total P&L |
|---|---|---|---|---|
${line('Rejected calls', calls)}
${line('Rejected puts', puts)}

## The ten rejections that hurt most to skip

| Week | Ticker | Side | Credit | Settle vs K | P&L |
|---|---|---|---|---|---|
${best.map((l) => `| ${l.week} | ${l.ticker} | ${l.side} | $${l.cr} | ${l.settle.toFixed(2)} vs ${l.K} | ${fmt(l.pnl)} |`).join('\n')}

## The ten the screens were right about

| Week | Ticker | Side | Credit | Settle vs K | P&L |
|---|---|---|---|---|---|
${worst.map((l) => `| ${l.week} | ${l.ticker} | ${l.side} | $${l.cr} | ${l.settle.toFixed(2)} vs ${l.K} | ${fmt(l.pnl)} |`).join('\n')}

Raw legs with every flag: \`baskets/retro_cache/rejections.json\`.
`;
fs.writeFileSync(path.join(REPO, 'docs', 'rejection_retro.md'), md);
console.log(`retro: ${rejected.length} rejected legs settled across ${new Set(rejected.map((l) => l.week)).size} weeks`);
const errs = Object.entries(cache).filter(([, v]) => v.__error).length;
console.log(`price fetch failures: ${errs}`);
