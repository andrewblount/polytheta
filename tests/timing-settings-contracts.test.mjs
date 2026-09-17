import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import settingsModule from '../src/server/services/broker-settings.ts';
import portfolioModule from '../src/server/services/broker-portfolio.ts';
import basketModule from '../src/server/repos/baskets.ts';
import syncModule from '../src/server/services/market-sync.ts';
import { validateBrokerSettings } from '../shared/broker-settings.mjs';
const { mergeBrokerSettingsUpdate } = settingsModule;
const { brokerPortfolioIsStale, queueBrokerExit } = portfolioModule;
const { currentBasketWeekRange } = basketModule;
const { entrySnapshotIsDue } = syncModule;
const now = new Date('2026-09-11T19:50:00Z');
const hostA = '00000000-0000-4000-a000-000000000001';
const hostB = '00000000-0000-4000-a000-000000000002';

test('host selection and configuration changes invalidate otherwise recent exit snapshots', () => {
  const state = {
    snapshot: { hostId: hostA, connection: 'tws', observedAt: now.toISOString() },
    status: { hostId: hostA, connection: 'tws', connected: true },
    settings: { executionHostId: hostA, connection: 'tws' }, settingsUpdatedAt: new Date(+now - 10000),
  };
  assert.equal(brokerPortfolioIsStale(state, now), false);
  assert.equal(brokerPortfolioIsStale({ ...state, settings: { ...state.settings, executionHostId: hostB } }, now), true);
  // A -> B -> A has the original ID again, but the old A snapshot must not regain authority.
  assert.equal(brokerPortfolioIsStale({ ...state, settingsUpdatedAt: new Date(+now + 1) }, new Date(+now + 2)), true);
  assert.equal(brokerPortfolioIsStale({ ...state, snapshot: { ...state.snapshot, hostId: hostB } }, now), true);
  assert.equal(brokerPortfolioIsStale({ ...state, snapshot: { ...state.snapshot, hostId: undefined } }, now), true);
  assert.equal(brokerPortfolioIsStale({ ...state, settings: { ...state.settings, connection: 'web-api' } }, now), true);
  assert.equal(brokerPortfolioIsStale({ ...state, status: { ...state.status, connected: false } }, now), true);
  assert.equal(brokerPortfolioIsStale(state, new Date(+now + 120001)), true);
});

test('older installed iOS settings updates preserve new host, endpoint and timing controls', () => {
  const current = validateBrokerSettings({ accountMode: 'paper', executionHostId: hostA, entryTiming: 'friday-close', twsPort: 7497,
    preparationLeadMinutes: 120, finalizeLeadMinutes: 15, vixIvSensitivity: 1.2, modelRiskFreeRatePct: 3.75, maxAccountLossPct: 37.5 });
  const updated = mergeBrokerSettingsUpdate(current, { entryCapitalPct: 40, excludedTickers: ['TSLA', 'SPCX', 'ABC'] });
  assert.equal(updated.entryCapitalPct, 40);
  for (const key of ['accountMode', 'executionHostId', 'entryTiming', 'twsPort', 'webApiUrl', 'preparationLeadMinutes', 'finalizeLeadMinutes', 'vixIvSensitivity', 'modelRiskFreeRatePct', 'maxAccountLossPct']) {
    assert.equal(updated[key], current[key], key);
  }
  assert.throws(() => mergeBrokerSettingsUpdate(current, null), /object/);
  assert.throws(() => mergeBrokerSettingsUpdate(current, []), /object/);
});

test('per-ticker loss limit defaults to 20 percent of account equity and accepts 0.1 through 100 percent', () => {
  assert.equal(validateBrokerSettings({}).maxAccountLossPct, 20);
  for (const maxAccountLossPct of [0.1, 20, 37.5, 100]) assert.equal(validateBrokerSettings({ maxAccountLossPct }).maxAccountLossPct, maxAccountLossPct);
  for (const maxAccountLossPct of [0, -1, 0.09, 100.1, null, '20', NaN, Infinity]) assert.throws(() => validateBrokerSettings({ maxAccountLossPct }), /maxAccountLossPct/);
});

test('Friday and holiday-eve publication exposes next week without leaking older baskets', () => {
  assert.deepEqual(currentBasketWeekRange(new Date('2026-09-10T19:50:00Z')), { start: '2026-09-07', end: '2026-09-14' });
  assert.deepEqual(currentBasketWeekRange(now), { start: '2026-09-07', end: '2026-09-21' });
  assert.deepEqual(currentBasketWeekRange(new Date('2026-07-02T19:50:00Z')), { start: '2026-06-29', end: '2026-07-13' });
  assert.deepEqual(currentBasketWeekRange(new Date('2026-09-14T13:30:00Z')), { start: '2026-09-14', end: '2026-09-21' });
});

test('a basket finalized before its entry window cannot acquire future-dated live entry marks', () => {
  const planned = new Date('2026-09-11T19:55:00Z');
  assert.equal(entrySnapshotIsDue(planned, now), false);
  assert.equal(entrySnapshotIsDue(planned, planned), true);
  assert.equal(entrySnapshotIsDue(planned, new Date(+planned + 1000)), true);
  assert.equal(entrySnapshotIsDue('invalid', now), false);
});

test('exit queue uses ordered transaction queries and pauses all exits without replacing settings', async () => {
  const command = { requestId: '00000000-0000-4000-a000-000000000010', scope: 'all', accountKey: 'a'.repeat(24), targets: [{ conid: 123, quantity: 1 }, { conid: 456, quantity: 2 }], status: 'queued' };
  const pending = { ...command, requestId: 'existing', scope: 'position', targets: [command.targets[0]], status: 'monitoring' };
  const calls = [];
  const result = await queueBrokerExit(command, async (text, parameters = []) => {
    calls.push({ text, parameters });
    if (text.includes("key like 'ib_exit:%'")) return [{ value: pending }];
    return [];
  });
  assert.match(calls[0].text, /pg_advisory_xact_lock/);
  assert.equal(calls.filter(call => call.text.startsWith('insert into app_settings')).length, 2);
  const queued = JSON.parse(calls.find(call => call.parameters.length === 2).parameters[1]);
  assert.deepEqual(queued.targets, command.targets);
  assert.deepEqual(queued.reusedRequestIds, ['existing']);
  assert.match(calls.at(-1).text, /app_settings\.value \|\|/);
  assert.deepEqual(result, queued);
  const replayCalls = [];
  const replay = await queueBrokerExit(command, async text => {
    replayCalls.push(text);
    return text.includes('where key=$1') ? [{ value: result }] : [];
  });
  assert.deepEqual(replay, result);
  assert.equal(replayCalls.some(text => text.startsWith('insert')), false);
});

test('native settings decode prior responses and round-trip every new timing and connection field', { skip: process.platform !== 'darwin' }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polytheta-settings-contract-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modelSource = fs.readFileSync(new URL('../ios/Sources/BrokerSettingsView.swift', import.meta.url), 'utf8')
    .split('struct BrokerSettingsSection: View')[0].replace('import SwiftUI', 'import Foundation');
  const portfolioSource = fs.readFileSync(new URL('../ios/Shared/BrokerModels.swift', import.meta.url), 'utf8');
  const current = validateBrokerSettings({ accountMode: 'paper', executionHostId: hostA, entryTiming: 'friday-close', twsPort: 7497,
    preparationLeadMinutes: 120, finalizeLeadMinutes: 15, vixIvSensitivity: 1.2, modelRiskFreeRatePct: 3.75, maxAccountLossPct: 37.5 });
  const oldKeys = ['connection','pauseEntries','entryCapitalPct','callAllocationPct','putAllocationPct','maxTrades','reserveLeverageCeiling','minimumCreditRatio','entryTimeoutSeconds','excludedTickers','strikeOverrides'];
  const old = Object.fromEntries(oldKeys.map(key => [key, current[key]]));
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64');
  const position = { conid: 123, ticker: 'ABC', side: 'call', strike: 25, expiry: '2026-09-18', quantity: 2,
    averageFill: 0.5, mark: 0.4, unrealizedPnl: 20, status: 'Open', canExit: true, workingEntry: false };
  const lossStop = { status: 'triggered', baselineEquity: 100000, thresholdAmount: 20000, lossAmount: 25000,
    lossPct: 25, triggeredAt: now.toISOString(), message: 'Ticker loss threshold reached; closing PolyTheta contracts' };
  const entryPricing = { credit: 0.5, referenceCredit: 0.6, elapsedCalendarDays: 2.75, referenceSpot: 20, spot: 20.5,
    iv: 0.7, ivSource: 'IB option IV', timeEffect: -0.2, underlyingEffect: 0.08, ivEffect: 0.02,
    observedAt: now.toISOString(), estimatedAt: now.toISOString() };
  const swift = `${modelSource}
${portfolioSource}
let legacy = try JSONDecoder().decode(BrokerSettings.self, from: Data(base64Encoded: "${encoded(old)}")!)
precondition(legacy.entryTiming == "monday-morning" && legacy.executionHostId == "")
precondition(legacy.preparationLeadMinutes == 90 && legacy.finalizeLeadMinutes == 10)
precondition(legacy.maxAccountLossPct == 20 && legacy.accountMode == "live")
let current = try JSONDecoder().decode(BrokerSettings.self, from: Data(base64Encoded: "${encoded(current)}")!)
let roundTrip = try JSONDecoder().decode(BrokerSettings.self, from: JSONEncoder().encode(current))
precondition(roundTrip.executionHostId == "${hostA}" && roundTrip.entryTiming == "friday-close")
precondition(roundTrip.accountMode == "paper")
precondition(roundTrip.twsPort == 7497 && roundTrip.preparationLeadMinutes == 120 && roundTrip.finalizeLeadMinutes == 15)
precondition(roundTrip.vixIvSensitivity == 1.2 && roundTrip.modelRiskFreeRatePct == 3.75)
precondition(roundTrip.maxAccountLossPct == 37.5)
let oldPosition = try JSONDecoder().decode(BrokerPosition.self, from: Data(base64Encoded: "${encoded(position)}")!)
precondition(oldPosition.lossStop == nil && oldPosition.entryPricing == nil)
let currentPosition = try JSONDecoder().decode(BrokerPosition.self, from: Data(base64Encoded: "${encoded({ ...position, lossStop, entryPricing })}")!)
precondition(currentPosition.lossStop?.status == "triggered" && currentPosition.lossStop?.lossPct == 25)
precondition(currentPosition.lossStop?.baselineEquity == 100000 && currentPosition.lossStop?.thresholdAmount == 20000)
precondition(currentPosition.entryPricing?.elapsedCalendarDays == 2.75)
let unavailable = try JSONDecoder().decode(BrokerPosition.self, from: Data(base64Encoded: "${encoded({ ...position, lossStop: { status: 'unavailable', baselineEquity: null, thresholdAmount: null, lossAmount: null, lossPct: null, triggeredAt: null, message: 'IB loss marks unavailable' } })}")!)
precondition(unavailable.lossStop?.lossAmount == nil && unavailable.lossStop?.baselineEquity == nil)
print("native settings contract passed")
`;
  const file = path.join(directory, 'main.swift'); fs.writeFileSync(file, swift);
  const result = spawnSync('swift', [file], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /native settings contract passed/);
});
