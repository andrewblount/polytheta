import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelEquity, brokerEquitySnapshot, accountEquityReference, DEFAULT_MODEL_EQUITY } from '../shared/model-equity.mjs';
import { executionCycle } from '../scripts/broker/execution-engine.mjs';
const now = new Date('2026-09-14T13:30:00Z');
const fresh = { netLiquidation: 60000, mode: 'paper', observedAt: '2026-09-14T13:00:00Z' };
test('the model never sizes against the IB account, whatever the account or host state', () => {
  // A selected execution computer with a fresh IB snapshot changes nothing for the model.
  const r = resolveModelEquity({ brokerEquity: fresh, settings: { executionHostId: 'h', accountMode: 'paper' }, env: {}, now });
  assert.deepEqual(r, { modelEquity: DEFAULT_MODEL_EQUITY, source: 'modeling-default', observedAt: null });
  // A missing, stale or cross-mode snapshot cannot block the model either.
  for (const brokerEquity of [null, { ...fresh, observedAt: '2026-09-01T13:00:00Z' }, { ...fresh, mode: 'live' }, { ...fresh, netLiquidation: 0 }, { ...fresh, observedAt: 'never' }]) {
    assert.doesNotThrow(() => resolveModelEquity({ brokerEquity, settings: { executionHostId: 'h', accountMode: 'paper' }, env: {}, now }));
  }
});
test('model equity comes from the operator override, then stored settings, then the $1M modeling basis', () => {
  assert.equal(resolveModelEquity({ settings: {}, env: {}, now }).modelEquity, DEFAULT_MODEL_EQUITY);
  assert.deepEqual(resolveModelEquity({ settings: {}, env: { POLYTHETA_MODEL_EQUITY: '250000' }, now }), { modelEquity: 250000, source: 'env-override', observedAt: null });
  assert.deepEqual(resolveModelEquity({ settings: { modelEquity: 75000 }, env: {}, now }), { modelEquity: 75000, source: 'settings', observedAt: null });
  assert.equal(resolveModelEquity({ settings: { modelEquity: 75000 }, env: { POLYTHETA_MODEL_EQUITY: '50000' }, now }).modelEquity, 50000, 'the explicit override wins');
  assert.throws(() => resolveModelEquity({ settings: {}, env: { POLYTHETA_MODEL_EQUITY: 'x' }, now }), /POLYTHETA_MODEL_EQUITY/);
  assert.throws(() => resolveModelEquity({ settings: {}, env: { POLYTHETA_MODEL_EQUITY: '-1' }, now }), /POLYTHETA_MODEL_EQUITY/);
});
test('the account is recorded as a reference for slippage analysis, never as an input', () => {
  assert.equal(accountEquityReference(null), null);
  assert.equal(accountEquityReference({ netLiquidation: 0, observedAt: fresh.observedAt }), null);
  const reference = accountEquityReference(fresh, { now });
  assert.equal(reference.netLiquidation, 60000); assert.equal(reference.mode, 'paper'); assert.equal(reference.stale, false);
  assert.equal(accountEquityReference({ ...fresh, observedAt: '2026-09-01T13:00:00Z' }, { now }).stale, true);
});
test('equity snapshot requires a real NetLiquidation', () => {
  assert.throws(() => brokerEquitySnapshot({ netLiquidation: NaN }, { mode: 'live' }), /NetLiquidation/);
  const s = brokerEquitySnapshot({ netLiquidation: 60000, availableFunds: 1, excessLiquidity: 2, cash: 3 }, { mode: 'paper', hostId: 'h', observedAt: now });
  assert.equal(s.netLiquidation, 60000); assert.equal(s.mode, 'paper'); assert.equal(s.observedAt, now.toISOString());
});
test('paper accounts run only with the local opt-in and never share a journal with live', async () => {
  const account = { grossPositionValue: 0, netLiquidation: 60000, availableFunds: 60000, excessLiquidity: 60000, cash: 60000 };
  const broker = { account: 'DU_TEST', connect: async () => ({ mode: 'paper' }), positions: async () => [], orders: async () => [], executions: async () => [], accountSummary: async () => account, disconnect() {} };
  const settings = { connection: 'tws', maxAccountLossPct: 20, reserveLeverageCeiling: 4 };
  await assert.rejects(executionCycle({ broker, proposal: null, settings, journal: {}, save: async () => {}, now }), /live account only/);
  const journal = {};
  const result = await executionCycle({ broker, proposal: null, settings, journal, save: async () => {}, allowPaper: true, now });
  assert.equal(result.health.mode, 'paper'); assert.equal(journal.mode, 'paper');
  await assert.rejects(executionCycle({ broker, proposal: null, settings, journal: { ...journal, mode: 'live', account: 'DU_TEST' }, save: async () => {}, allowPaper: true, now }), /account mode/);
});
