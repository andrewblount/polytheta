import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioSnapshot, validateExitRequest, accountFingerprint } from '../shared/broker-portfolio.mjs';
import { isExcluded, validateBrokerSettings } from '../shared/broker-settings.mjs';
import { selectCompliantStrike } from '../scripts/lib/shortlist.mjs';
import { otmPercent, minimumOtmFor } from '../shared/strike-settings.mjs';
import { WebApiBroker } from '../scripts/broker/web-api.mjs';
import { parseIbTime } from '../scripts/broker/tws.mjs';
const now = new Date('2026-09-08T14:00:00Z');
const c = { conid: 123, symbol: 'ABC', expiry: '2026-09-11', strike: 25, side: 'call', multiplier: 100 };
function sample() {
  const journal = { intents: { ref: { action: 'entry', contract: c, status: 'Filled' } }, fills: {
    a: { action: 'entry', contract: c, quantity: 3, price: .6, commission: 2 },
    b: { action: 'exit', contract: c, quantity: 1, price: .2, commission: 1 },
  } };
  return portfolioSnapshot({ journal, positions: [{ conid: 123, quantity: -10, marketPrice: .3 }, { conid: 456, quantity: -100, marketPrice: 100 }], account: 'U_TEST', activated: true, connection: 'tws', now });
}
test('live portfolio uses only attributable PolyTheta quantities and fill cost', () => {
  const s = sample(); assert.equal(s.positions.length, 1); assert.equal(s.positions[0].quantity, 2);
  assert.ok(Math.abs(s.unrealizedPnl - 60) < 1e-8); assert.ok(Math.abs(s.realizedPnl - 40) < 1e-8);
  assert.equal(s.fees, 3); assert.equal(s.complete, true); assert.equal(s.accountKey, accountFingerprint('U_TEST'));
});
test('manual exits reject stale state, unknown holdings, and inactive execution', () => {
  const input = { requestId: '00000000-0000-4000-a000-000000000000', accountKey: accountFingerprint('U_TEST'), scope: 'all' };
  assert.deepEqual(validateExitRequest(input, sample(), now).targets, [{ conid: 123, quantity: 2 }]);
  assert.throws(() => validateExitRequest(input, sample(), new Date(+now + 121000)), /stale/);
  assert.throws(() => validateExitRequest(input, { ...sample(), activated: false }, now), /not activated/);
  assert.throws(() => validateExitRequest({ ...input, scope: 'position', conid: 456 }, sample(), now), /No eligible/);
});
test('exclusions default to Tesla and SpaceX, accept aliases, and can be removed', () => {
  const settings = validateBrokerSettings({});
  assert.equal(isExcluded({ ticker: 'tsla' }, settings), true);
  assert.equal(isExcluded({ ticker: 'SPCX' }, settings), true);
  assert.equal(isExcluded({ ticker: 'NEW', name: 'Space Exploration Technologies Corp.' }, settings), true);
  assert.equal(isExcluded({ ticker: 'TSLA' }, validateBrokerSettings({ excludedTickers: [] })), false);
  assert.deepEqual(validateBrokerSettings({ excludedTickers: 'tsla, SpaceX, tsla' }).excludedTickers, ['TSLA', 'SPCX']);
});
test('minimum OTM chooses eligible strikes at or beyond the requested distance', () => {
  const rows = [24,24.5,25].map(strike => ({ type: 'call', strike, bid: .8 - (strike-24)*.2, ask: .9 - (strike-24)*.2, delta_est: .18, iv: .7 }));
  assert.equal(selectCompliantStrike({ side:'call', price:20, atr:2, rows, minimumOtmPct:21 }).strike, 24.5);
  assert.equal(selectCompliantStrike({ side:'call', price:20, atr:2, rows, minimumOtmPct:26 }), null);
  assert.equal(otmPercent('put', 18, 20), 10);
  const settings = validateBrokerSettings({ strikeOverrides: [{ticker:'abc',side:'call',expiry:'2026-09-11',minimumOtmPct:21}] });
  assert.equal(minimumOtmFor(settings,'ABC','call','2026-09-11'),21);
  assert.equal(minimumOtmFor(settings,'ABC','call','2026-09-18'),0);
});
test('IB Web API uses separate underlying bid/ask and preserves negative put delta', async () => {
  const broker = new WebApiBroker({ account: 'U_TEST', requestImpl: async () => [
    { conid:123,84:'.45',86:'.55',88:'10',85:'12',6509:'RpB',7308:'-0.18',7635:'0.50',_updated:+now },
    { conid:456,84:'19.99',86:'20.01',6509:'RpB',_updated:+now },
  ] });
  const q = await broker.quote({conid:123,underlyingConid:456});
  assert.equal(q.delta,-.18); assert.equal(q.underlyingPrice,20); assert.equal(q.observedAt,+now);
});
test('broker timestamps never silently interpret an ambiguous local time', () => {
  assert.equal(parseIbTime('20260908-14:00:00'),'2026-09-08T14:00:00Z');
  assert.equal(parseIbTime('20260908  14:00:00 UTC'),'2026-09-08T14:00:00Z');
  assert.equal(parseIbTime('20260908  14:00:00'),null);
});
