import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelEquity, brokerEquitySnapshot, DEFAULT_MODEL_EQUITY } from '../shared/model-equity.mjs';
import { executionCycle } from '../scripts/broker/execution-engine.mjs';
const now = new Date('2026-09-14T13:30:00Z');
const fresh = { netLiquidation: 60000, mode: 'paper', observedAt: '2026-09-14T13:00:00Z' };
test('basket equity follows the published IB account value', () => {
  const r = resolveModelEquity({ brokerEquity: fresh, settings: { executionHostId: 'h' }, env: {}, now });
  assert.deepEqual(r, { modelEquity: 60000, source: 'ib-paper', observedAt: fresh.observedAt });
  // IB wins even when an env override is present
  assert.equal(resolveModelEquity({ brokerEquity: fresh, settings: {}, env: { POLYTHETA_MODEL_EQUITY: '1' }, now }).modelEquity, 60000);
});
test('without an execution computer the modeling basis remains $1M, env override honored', () => {
  assert.equal(resolveModelEquity({ brokerEquity: null, settings: {}, env: {}, now }).modelEquity, DEFAULT_MODEL_EQUITY);
  assert.equal(resolveModelEquity({ brokerEquity: null, settings: {}, env: { POLYTHETA_MODEL_EQUITY: '250000' }, now }).source, 'env-override');
  assert.throws(() => resolveModelEquity({ brokerEquity: null, settings: {}, env: { POLYTHETA_MODEL_EQUITY: 'x' }, now }), /POLYTHETA_MODEL_EQUITY/);
});
test('a selected execution computer refuses to size against a missing or stale snapshot', () => {
  const settings = { executionHostId: 'h' };
  assert.throws(() => resolveModelEquity({ brokerEquity: null, settings, env: {}, now }), /ib:check/);
  const stale = { ...fresh, observedAt: '2026-09-01T13:00:00Z' };
  assert.throws(() => resolveModelEquity({ brokerEquity: stale, settings, env: {}, now }), /old/);
  assert.throws(() => resolveModelEquity({ brokerEquity: { ...fresh, netLiquidation: 0 }, settings, env: {}, now }), /Invalid/);
  assert.throws(() => resolveModelEquity({ brokerEquity: { ...fresh, observedAt: 'never' }, settings, env: {}, now }), /timestamp/);
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
