import test from 'node:test';
import assert from 'node:assert/strict';
import legAnalysis from '../src/lib/leg-analysis.ts';
const { analyzeLeg } = legAnalysis;

// Half-hour closes over a week, regular session only, in ET-safe UTC stamps.
function path(days, closesByDay) {
  const out = [];
  for (const [i, day] of days.entries()) {
    const closes = closesByDay[i];
    closes.forEach((p, j) => out.push({ t: `${day}T${String(14 + Math.floor(j / 2)).padStart(2, '0')}:${j % 2 ? '30' : '00'}:00Z`, p, h: p + 0.2, l: p - 0.2 }));
  }
  return out;
}
const days = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
const base = { ticker: 'ABC', side: 'call', strike: 30, entryPrice: 27, entryAt: '2026-09-14T14:00:00Z', expiry: '2026-09-18', credit: 0.4, contracts: 10, margin: 12000, atr: 1.2, delta: 0.17, snapshots: [], exitPrice: null, exitAt: null, radarHit: null };

test('a leg that expired worthless reports its cushion, closest approach and full credit capture', () => {
  const points = path(days, [[27, 27.2], [27.5, 27.8], [28.4, 28.9], [28.2, 27.9], [27.5, 27.1]]);
  const a = analyzeLeg({ ...base, points, expiryPrice: 27.1, settledState: 'expired-otm', settledPnl: 400 });
  assert.equal(a.outcome, 'otm');
  assert.equal(a.breakeven, 30.4);
  assert.equal(a.cushionPct, 11.11); assert.equal(a.cushionAtr, 2.5);
  assert.equal(a.closestPrice, 29.1, 'the Wednesday bar high'); assert.ok(a.closestPct > 60 && a.closestPct < 71);
  assert.equal(a.firstBreachAt, null); assert.equal(a.breachedSessions, 0);
  assert.equal(a.creditCapturePct, 100); assert.equal(a.intrinsicAtExpiry, 0);
  assert.equal(a.postMortem, null);
});

test('a leg that expired in the money gets a post-mortem with the surviving strike and the exit alternatives', () => {
  // Grinds through the strike on Wednesday and closes at 32 on Friday.
  const points = path(days, [[27, 27.4], [28.1, 28.9], [29.6, 30.4], [31.0, 31.5], [31.8, 32.0]]);
  const snapshots = [
    { observedAt: '2026-09-16T15:00:00Z', underlyingPrice: 29.6, pnlAmount: -900, state: 'approaching-strike', confidence: 'Estimated' },
    { observedAt: '2026-09-16T19:00:00Z', underlyingPrice: 30.4, pnlAmount: -1400, state: 'breached', confidence: 'Estimated' },
    { observedAt: '2026-09-17T19:00:00Z', underlyingPrice: 31.5, pnlAmount: -2900, state: 'breached', confidence: 'Estimated' },
  ];
  const a = analyzeLeg({ ...base, points, snapshots, expiryPrice: 32, settledState: 'expired-itm', settledPnl: -1600 });
  assert.equal(a.outcome, 'itm');
  assert.equal(a.intrinsicAtExpiry, 2); assert.equal(a.movePct, 18.52);
  assert.equal(a.firstBreachAt, '2026-09-16T14:30:00Z'); assert.equal(a.breachedSessions, 3);
  assert.equal(a.creditCapturePct, -400);
  const pm = a.postMortem;
  assert.ok(pm, 'post-mortem present');
  assert.match(pm.summary, /ground 18\.5% higher/);
  assert.match(pm.findings[1], /Loss = intrinsic \$2\.00 − credit \$0\.40/);
  assert.match(pm.findings.join(' '), /grind rather than a gap/);
  const strike = pm.alternatives.find(x => x.label.startsWith('Strike $32.50'));
  assert.ok(strike, 'suggests the strike that would have survived'); assert.match(strike.detail, /20\.4% out of the money/);
  const breach = pm.alternatives.find(x => x.label.startsWith('Exit when the strike was first breached'));
  assert.equal(breach.pnl, -1400);
  assert.equal(pm.alternatives.find(x => x.label.startsWith('Automatic exit at −25%')), undefined, 'no snapshot reached −25% of the $12,000 margin');
  const b = analyzeLeg({ ...base, points, snapshots: [...snapshots, { observedAt: '2026-09-18T15:00:00Z', underlyingPrice: 31.8, pnlAmount: -3100, state: 'breached', confidence: 'Estimated' }], expiryPrice: 32, settledState: 'expired-itm', settledPnl: -1600 });
  assert.equal(b.postMortem.alternatives.find(x => x.label.startsWith('Automatic exit at −25%')), undefined, 'an exit that would have lost more than holding is not offered');
  const c = analyzeLeg({ ...base, points, snapshots: [...snapshots, { observedAt: '2026-09-18T15:00:00Z', underlyingPrice: 31.8, pnlAmount: -3100, state: 'breached', confidence: 'Estimated' }], expiryPrice: 34, settledState: 'expired-itm', settledPnl: -3600 });
  assert.equal(c.postMortem.alternatives.find(x => x.label.startsWith('Automatic exit at −25%')).pnl, -3100);
});

test('a gap through the strike is called a gap and the intraday exits are not offered', () => {
  const points = path(days, [[27, 27.1], [27.3, 27.2], [31.5, 31.8], [31.6, 31.9], [31.7, 32.0]]);
  const a = analyzeLeg({ ...base, points, expiryPrice: 32, settledState: 'expired-itm', settledPnl: -1600 });
  assert.match(a.postMortem.summary, /^Gap through the strike/);
  assert.ok(!a.postMortem.alternatives.some(x => x.label.startsWith('Exit at the first close')));
});

test('an open leg has no post-mortem and tracks the last price', () => {
  const points = path(days.slice(0, 2), [[27, 27.2], [27.6, 27.9]]);
  const a = analyzeLeg({ ...base, points, expiryPrice: null, settledState: null, settledPnl: null });
  assert.equal(a.outcome, 'open'); assert.equal(a.lastPrice, 27.9); assert.equal(a.postMortem, null);
});
