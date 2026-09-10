import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrokerSettings } from '../shared/broker-settings.mjs';
import { entrySchedule, isEntryWindow, buildContext } from '../shared/entry-schedule.mjs';
import { assertCurrentProposal } from '../shared/market-calendar.mjs';
import { repriceEntry, optionValue } from '../shared/entry-pricing.mjs';
const monday = validateBrokerSettings({});
const friday = validateBrokerSettings({ entryTiming: 'friday-close' });

test('Friday entries target next week and only the final five minutes', () => {
  const window = entrySchedule('2026-09-14', friday);
  assert.equal(window.start.toISOString(), '2026-09-11T19:55:00.000Z');
  assert.equal(window.end.toISOString(), '2026-09-11T20:00:00.000Z');
  assert.equal(window.expiry, '2026-09-18');
  assert.equal(isEntryWindow(window.week, friday, new Date('2026-09-11T19:54:59Z')), false);
  assert.equal(isEntryWindow(window.week, friday, new Date('2026-09-11T19:55:00Z')), true);
  assert.equal(isEntryWindow(window.week, friday, window.end), false);
  assert.equal(isEntryWindow(window.week, friday, new Date('2026-09-14T14:00:00Z')), false);
});
test('Friday holiday uses the preceding session and its actual early close', () => {
  const christmas = entrySchedule('2026-12-28', friday);
  assert.equal(christmas.start.toISOString(), '2026-12-24T17:55:00.000Z');
  assert.equal(christmas.end.toISOString(), '2026-12-24T18:00:00.000Z');
  assert.equal(christmas.expiry, '2026-12-31');
  assert.equal(entrySchedule('2026-04-06', friday).date, '2026-04-02');
});
test('Monday holiday shifts the morning window, never creates a late-week entry', () => {
  const window = entrySchedule('2026-09-07', monday);
  assert.equal(window.start.toISOString(), '2026-09-08T13:45:00.000Z');
  assert.equal(isEntryWindow(window.week, monday, new Date('2026-09-08T14:29:59Z')), true);
  assert.equal(isEntryWindow(window.week, monday, new Date('2026-09-08T14:30:00Z')), false);
  assert.equal(buildContext(monday, new Date('2026-09-09T14:00:00Z')), null);
  assert.equal(entrySchedule('2026-11-02', monday).start.toISOString(), '2026-11-02T14:45:00.000Z');
});
test('screening starts ahead of Friday and finalization precedes the entry window', () => {
  assert.equal(buildContext(friday, new Date('2026-09-11T18:29:59Z')), null);
  assert.equal(buildContext(friday, new Date('2026-09-11T18:30:00Z')).prepare, true);
  assert.equal(buildContext(friday, new Date('2026-09-11T19:45:00Z')).prepare, false);
  assert.equal(buildContext(friday, new Date('2026-09-11T20:00:00Z')), null);
  assert.equal(buildContext(monday, new Date('2026-09-11T19:45:00Z')).prepare, true);
  assert.equal(buildContext(friday, new Date('2026-09-12T18:00:00Z')), null);
});
test('only a dated Friday-mode proposal can publish for next week on Friday', () => {
  const now = new Date('2026-09-11T19:50:00Z');
  const p = { basket_date: '2026-09-14', expiry: '2026-09-18', allocation_settings: friday, generated_ts: now.toISOString(), data_observed_at: now.toISOString(), picks: [{}] };
  assert.doesNotThrow(() => assertCurrentProposal(p, now));
  assert.throws(() => assertCurrentProposal({ ...p, allocation_settings: monday }, now), /week|window/);
  assert.throws(() => assertCurrentProposal({ ...p, expiry: '2026-09-11' }, now), /expiry/);
});
const reference = { observedAt: '2026-09-04T19:55:00Z', spot: 100, strike: 104, iv: .4, vix: 20, credit: 1, side: 'call', expiry: '2026-09-11' };
test('repricing uses full elapsed holiday-weekend time and separates its effects', () => {
  const now = new Date('2026-09-08T13:45:00Z');
  const p = repriceEntry({ reference, spot: 100, optionIv: .4, now, settings: monday });
  assert.ok(p.elapsedCalendarDays > 3.7 && p.elapsedCalendarDays < 3.8);
  assert.ok(p.credit < reference.credit);
  assert.equal(p.underlyingEffect, 0); assert.equal(p.ivEffect, 0);
  assert.ok(Math.abs(reference.credit + p.timeEffect + p.underlyingEffect + p.ivEffect - p.credit) < 1e-9);
});
test('current underlying gap is preserved instead of reverting to Friday', () => {
  const now = new Date('2026-09-08T13:45:00Z');
  const base = repriceEntry({ reference, spot: 100, optionIv: .4, now });
  const gap = repriceEntry({ reference, spot: 103, optionIv: .4, now });
  assert.equal(gap.spot, 103); assert.ok(gap.underlyingEffect > 0); assert.ok(gap.credit > base.credit);
});
test('exact current option IV takes precedence and VIX is an explicit fallback', () => {
  const now = new Date('2026-09-08T13:45:00Z');
  const exact = repriceEntry({ reference, spot: 100, optionIv: .45, vix: 40, now });
  assert.equal(exact.iv, .45); assert.equal(exact.ivSource, 'current option IV');
  const proxy = repriceEntry({ reference, spot: 100, vix: 25, now, settings: { vixIvSensitivity: 1 } });
  assert.equal(proxy.iv, .5); assert.equal(proxy.ivSource, 'VIX ratio approximation');
  assert.throws(() => repriceEntry({ reference, spot: 100, now }), /IV|VIX/);
});
test('fresh Monday references do not have weekend decay subtracted again', () => {
  const now = new Date('2026-09-08T13:45:00Z');
  const p = repriceEntry({ reference: { ...reference, observedAt: now.toISOString(), credit: .6 }, spot: 100, optionIv: .4, now });
  assert.equal(p.elapsedCalendarDays, 0); assert.equal(p.timeEffect, 0);
  assert.ok(Math.abs(p.credit - .6) < 1e-10);
});
test('expired, future-dated and unstable references fail closed', () => {
  assert.throws(() => repriceEntry({ reference, spot: 100, optionIv: .4, now: new Date('2026-09-11T20:00:00Z') }), /time window/);
  assert.throws(() => repriceEntry({ reference, spot: 100, optionIv: .4, now: new Date('2026-09-03T20:00:00Z') }), /time window/);
  assert.throws(() => repriceEntry({ reference: { ...reference, iv: .001, strike: 1000 }, spot: 100, optionIv: .4, now: new Date('2026-09-08T14:00:00Z') }), /too small/);
  assert.equal(optionValue({ spot: 110, strike: 100, years: 0, iv: .4, side: 'call' }), 10);
});
