// Model equity for basket selection.
//
// The weekly basket is a MODEL. It is selected and sized against a model
// equity that never depends on the state of any brokerage account, so the
// basket is generated every week whether or not IB is connected, funded, on
// the right account, or publishing an equity snapshot. Source order:
//   1. POLYTHETA_MODEL_EQUITY (explicit operator model basis)
//   2. settings.modelEquity when the operator stores one
//   3. the historical $1,000,000 modeling basis (website track record)
//
// The execution service sizes its OWN entries against the live IB account
// (shared/execution-policy.mjs entryBudget). Comparing the two is what the
// model-versus-account performance report measures; the model must not be
// polluted by the account it is being compared against.
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

export function resolveModelEquity({ settings, env = process.env } = {}) {
  const override = env.POLYTHETA_MODEL_EQUITY;
  if (override != null && override !== '') {
    const value = Number(override);
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid POLYTHETA_MODEL_EQUITY');
    return { modelEquity: value, source: 'env-override', observedAt: null };
  }
  const stored = Number(settings?.modelEquity);
  if (settings?.modelEquity != null && Number.isFinite(stored) && stored > 0) return { modelEquity: stored, source: 'settings', observedAt: null };
  return { modelEquity: DEFAULT_MODEL_EQUITY, source: 'modeling-default', observedAt: null };
}

// Informational only: the account the model will be compared against at the
// time the basket was built. Never used for selection or sizing.
export function accountEquityReference(brokerEquity, { now = new Date() } = {}) {
  if (!brokerEquity) return null;
  const value = Number(brokerEquity.netLiquidation);
  const age = +now - Date.parse(brokerEquity.observedAt);
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(age)) return null;
  return { netLiquidation: value, mode: brokerEquity.mode ?? null, hostId: brokerEquity.hostId ?? null, observedAt: brokerEquity.observedAt, stale: age > MAX_BROKER_EQUITY_AGE_MS };
}
