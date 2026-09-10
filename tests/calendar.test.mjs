import test from 'node:test';
import assert from 'node:assert/strict';
import { marketSession, firstSessionOfWeek, weeklyExpiry, sessionClose, isMarketOpen, inBriefingWindow, assertCurrentProposal } from '../shared/market-calendar.mjs';
import { deriveBasketDate } from '../scripts/lib/basket_date.mjs';
test('US exchange holidays, observed days and exceptional closures', () => {
  for (const date of ['2025-01-09','2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25','2027-06-18','2027-12-24']) assert.equal(marketSession(date).open, false, date);
  for (const date of ['2026-07-02','2026-10-12','2026-11-11','2027-12-31']) assert.equal(marketSession(date).open, true, date);
  assert.throws(() => marketSession('2029-01-02'), /review/);
  assert.throws(() => marketSession('2026-02-30'), /Invalid/);
});
test('Monday holiday recovery keeps the same week; Friday holidays move expiry', () => {
  assert.equal(firstSessionOfWeek('2026-09-07'), '2026-09-08');
  assert.equal(deriveBasketDate(new Date('2026-09-08T14:00:00Z')), '2026-09-07');
  assert.equal(deriveBasketDate(new Date('2026-09-09T14:00:00Z')), '2026-09-07');
  assert.equal(deriveBasketDate(new Date('2026-09-12T14:00:00Z')), '2026-09-14');
  assert.equal(deriveBasketDate(new Date('2026-09-08T01:00:00Z')), '2026-09-07');
  assert.equal(weeklyExpiry('2026-03-30'), '2026-04-02');
  assert.equal(weeklyExpiry('2026-06-15'), '2026-06-18');
  assert.equal(weeklyExpiry('2026-06-29'), '2026-07-02');
  assert.equal(weeklyExpiry('2026-12-21'), '2026-12-24');
});
test('session hours include DST and early closes; expiry is not midnight', () => {
  assert.equal(sessionClose('2026-09-11').toISOString(), '2026-09-11T20:00:00.000Z');
  assert.equal(sessionClose('2026-11-27').toISOString(), '2026-11-27T18:00:00.000Z');
  assert.equal(sessionClose('2026-12-24').toISOString(), '2026-12-24T18:00:00.000Z');
  assert.equal(isMarketOpen(new Date('2026-09-07T15:00:00Z')), false);
  assert.equal(isMarketOpen(new Date('2026-09-11T15:00:00Z')), true);
  assert.equal(inBriefingWindow('close', new Date('2026-11-27T18:10:00Z')), true);
  assert.equal(inBriefingWindow('close', new Date('2026-11-27T21:10:00Z')), false);
  assert.equal(inBriefingWindow('open', new Date('2026-09-07T13:45:00Z')), false);
});
test('stale, future and wrong-week proposals cannot be delivered', () => {
  const now = new Date('2026-09-08T14:00:00Z');
  const p = { basket_date:'2026-09-07', expiry:'2026-09-11', generated_ts:now.toISOString(), data_observed_at:now.toISOString(), picks:[{}] };
  assert.doesNotThrow(() => assertCurrentProposal(p, now));
  assert.throws(() => assertCurrentProposal({...p,basket_date:'2026-08-31'},now), /week/);
  assert.throws(() => assertCurrentProposal({...p,data_observed_at:'2026-09-04T14:00:00Z'},now), /stale/);
  assert.throws(() => assertCurrentProposal({...p,expiry:'2026-09-18'},now), /expiry/);
  assert.throws(() => assertCurrentProposal({...p,generated_ts:'2026-09-09T14:00:00Z'},now), /stale/);
});
