// Model equity for basket selection. The basket must be selected against the
// same equity the execution service sizes against, otherwise names that clear
// the affordability filter at a modeled $1M cannot fill one whole contract in
// the real account. Source order:
//   1. `broker_equity` published by the execution worker from IB NetLiquidation
//   2. POLYTHETA_MODEL_EQUITY (explicit operator override / modeling runs)
//   3. the historical $1,000,000 modeling basis, only while no execution
//      computer is selected (website performance track record)
export const DEFAULT_MODEL_EQUITY = 1000000;
export const MAX_BROKER_EQUITY_AGE_MS = 7 * 24 * 3600000;

export function brokerEquitySnapshot(account, { mode, hostId, observedAt = new Date() } = {}) {
  const value = Number(account?.netLiquidation);
  if (!Number.isFinite(value) || value <= 0) throw new Error('IB NetLiquidation unavailable; equity snapshot not published');
  return {
    netLiquidation: value,
    availableFunds: Number(account.availableFunds), excessLiquidity: Number(account.excessLiquidity), cash: Number(account.cash),
    mode, hostId, observedAt: new Date(observedAt).toISOString(),
  };
}

export function resolveModelEquity({ brokerEquity, settings, env = process.env, now = new Date() }) {
  const override = env.POLYTHETA_MODEL_EQUITY;
  const hostSelected = Boolean(settings?.executionHostId);
  if (brokerEquity) {
    const age = +now - Date.parse(brokerEquity.observedAt);
    if (!Number.isFinite(age) || age < -60000) throw new Error('Broker equity snapshot has an invalid timestamp');
    if (age > MAX_BROKER_EQUITY_AGE_MS) {
      if (hostSelected && override == null) throw new Error(`Broker equity snapshot is ${Math.round(age / 3600000)}h old; run npm run ib:check with IB signed in`);
    } else {
      const value = Number(brokerEquity.netLiquidation);
      if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid broker equity snapshot');
      return { modelEquity: value, source: `ib-${brokerEquity.mode ?? 'account'}`, observedAt: brokerEquity.observedAt };
    }
  }
  if (override != null) {
    const value = Number(override);
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid POLYTHETA_MODEL_EQUITY');
    return { modelEquity: value, source: 'env-override', observedAt: null };
  }
  if (hostSelected) throw new Error('No IB equity snapshot published for the selected execution computer; run npm run ib:check with IB signed in');
  return { modelEquity: DEFAULT_MODEL_EQUITY, source: 'modeling-default', observedAt: null };
}
