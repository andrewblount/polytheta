import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chainQuoteQuality, CHAIN_MIN_QUOTED_SHARE } from '../scripts/lib/refresh.mjs';

const HEADER = 'ticker,strike,type,bid,ask,last,iv,volume,oi,delta_est,distance_pct,chain_received_at,underlying_observed_at';
function chainFile(rows) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chainq-')), 'chains_2026-09-18_v2.csv');
  fs.writeFileSync(file, [HEADER, ...rows.map(([bid, dist]) => `T,10,call,${bid},${bid + 0.05},0,0.5,1,1,0.18,${dist},x,y`)].join('\n'));
  return file;
}

test('a snapshot with unpopulated bids after the open is rejected', () => {
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push([i < 2 ? 0.5 : 0, 5]);
  const q = chainQuoteQuality(chainFile(rows));
  assert.equal(q.near, 200);
  assert.equal(q.quoted, 2);
  assert.ok(q.share < CHAIN_MIN_QUOTED_SHARE);
});

test('a healthy mid-session snapshot passes even though far strikes never quote', () => {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push([i < 27 ? 0.5 : 0, 10]);
  for (let i = 0; i < 300; i++) rows.push([0, 60]);
  const q = chainQuoteQuality(chainFile(rows));
  assert.equal(q.near, 100, 'far-from-the-money rows are excluded from the denominator');
  assert.ok(q.share >= CHAIN_MIN_QUOTED_SHARE);
});

test('a missing chain file scores zero', () => {
  assert.deepEqual(chainQuoteQuality('/nonexistent/chains.csv'), { near: 0, quoted: 0, share: 0 });
});
