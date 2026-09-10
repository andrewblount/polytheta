import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { missingBasketAvailability } from '../shared/basket-availability.mjs';
import { validateBrokerSettings } from '../shared/broker-settings.mjs';

const monday = validateBrokerSettings({});

test('a missed Labor Day week stays missing and points to the next dated preparation and entry', () => {
  const status = missingBasketAvailability(monday, new Date('2026-09-10T14:00:00Z'));
  assert.equal(status.weekOf, '2026-09-07');
  assert.equal(status.state, 'missed');
  assert.match(status.message, /Sep 8.*10:30 AM ET/);
  assert.equal(status.nextScheduled.weekOf, '2026-09-14');
  assert.equal(status.nextScheduled.preparationAt, '2026-09-11T18:30:00.000Z');
  assert.equal(status.nextScheduled.finalRefreshAt, '2026-09-14T13:35:00.000Z');
  assert.equal(status.nextScheduled.entryStart, '2026-09-14T13:45:00.000Z');
  assert.equal(status.nextScheduled.entryEnd, '2026-09-14T14:30:00.000Z');
  assert.equal('basket' in status, false);
});

test('a Monday holiday remains pending until the Tuesday entry window actually ends', () => {
  for (const now of ['2026-09-07T16:00:00Z', '2026-09-08T14:29:59Z']) {
    const status = missingBasketAvailability(monday, new Date(now));
    assert.equal(status.state, 'pending');
    assert.equal(status.nextScheduled.weekOf, '2026-09-07');
    assert.equal(status.nextScheduled.entryStart, '2026-09-08T13:45:00.000Z');
  }
  assert.equal(missingBasketAvailability(monday, new Date('2026-09-08T14:30:00Z')).state, 'missed');
});

test('Friday entry status follows a preceding early close and configurable lead times', () => {
  const settings = validateBrokerSettings({ entryTiming: 'friday-close', preparationLeadMinutes: 120, finalizeLeadMinutes: 15 });
  const status = missingBasketAvailability(settings, new Date('2026-12-23T15:00:00Z'));
  assert.equal(status.nextScheduled.weekOf, '2026-12-28');
  assert.equal(status.nextScheduled.preparationAt, '2026-12-24T16:00:00.000Z');
  assert.equal(status.nextScheduled.finalRefreshAt, '2026-12-24T17:40:00.000Z');
  assert.equal(status.nextScheduled.entryStart, '2026-12-24T17:55:00.000Z');
  assert.equal(status.nextScheduled.entryEnd, '2026-12-24T18:00:00.000Z');
});

test('the displayed schedule keeps Eastern wall times across the daylight-saving weekend', () => {
  const status = missingBasketAvailability(monday, new Date('2026-10-29T15:00:00Z'));
  assert.equal(status.nextScheduled.weekOf, '2026-11-02');
  assert.equal(status.nextScheduled.preparationAt, '2026-10-30T18:30:00.000Z');
  assert.equal(status.nextScheduled.entryStart, '2026-11-02T14:45:00.000Z');
  assert.match(status.nextScheduled.preparationLabel, /2:30 PM ET/);
  assert.match(status.nextScheduled.entryLabel, /9:45 AM ET/);
});

test('native summary accepts the old empty response and the new dated availability without substituting an archive', { skip: process.platform !== 'darwin' }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polytheta-basket-availability-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const availability = { ...missingBasketAvailability(monday, new Date('2026-09-10T14:00:00Z')),
    latestPublished: { slug: 'weekly-basket-2026-08-31', title: 'August 31 basket', weekOf: '2026-08-31' } };
  const encoded = Buffer.from(JSON.stringify({ basket: null, availability })).toString('base64');
  const source = fs.readFileSync(new URL('../ios/Sources/Models.swift', import.meta.url), 'utf8');
  const swift = `${source}
let legacy = try JSONDecoder().decode(SummaryResponse.self, from: Data(#"{"basket":null}"#.utf8))
precondition(legacy.basket == nil && legacy.availability == nil)
let current = try JSONDecoder().decode(SummaryResponse.self, from: Data(base64Encoded: "${encoded}")!)
precondition(current.basket == nil)
precondition(current.availability?.weekOf == "2026-09-07")
precondition(current.availability?.state == "missed")
precondition(current.availability?.nextScheduled?.weekOf == "2026-09-14")
precondition(current.availability?.latestPublished?.weekOf == "2026-08-31")
let roundTrip = try JSONDecoder().decode(SummaryResponse.self, from: JSONEncoder().encode(current))
precondition(roundTrip.basket == nil && roundTrip.availability?.latestPublished?.slug == "weekly-basket-2026-08-31")
print("native availability contract passed")
`;
  const file = path.join(directory, 'main.swift'); fs.writeFileSync(file, swift);
  const result = spawnSync('swift', [file], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /native availability contract passed/);
});
