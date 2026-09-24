// Model sizing settings, stored in app_settings under key 'model'. They size
// the MODEL basket and the model's historical performance; the IB account has
// its own copy in the broker settings and is never affected by these.
//
//   modelEquity        the model's equity basis (POLYTHETA_MODEL_EQUITY overrides it for scripts)
//   accountTradedPct   share of model equity committed each week (default 100%)
//   marginAvailablePct notional backing per committed dollar (default 400% = 4× portfolio margin)
//   sellCalls/sellPuts which sides the model sells (both on by default)
export const DEFAULT_MODEL_SETTINGS = Object.freeze({
  modelEquity: 1000000, accountTradedPct: 100, marginAvailablePct: 400, sellCalls: true, sellPuts: true,
});
export function validateModelSettings(input) {
  const s = { ...DEFAULT_MODEL_SETTINGS, ...(input ?? {}) };
  for (const [key, low, high] of [['modelEquity', 1000, 1e9], ['accountTradedPct', 0, 100], ['marginAvailablePct', 100, 1000]]) {
    s[key] = Number(s[key]);
    if (!Number.isFinite(s[key]) || s[key] < low || s[key] > high) throw new Error(`Invalid ${key}: expected ${low}–${high}`);
  }
  for (const key of ['sellCalls', 'sellPuts']) if (typeof s[key] !== 'boolean') throw new Error('Sell calls and sell puts must be on or off');
  return Object.fromEntries(Object.keys(DEFAULT_MODEL_SETTINGS).map(key => [key, s[key]]));
}
// The selection/sizing policy the model basket is built under: broker settings
// that shape the basket (split, maximum trades, timing, strikes) with the
// model's own equity, share, margin and side toggles laid over them.
export function modelPolicy(brokerSettings, modelSettings) {
  const m = validateModelSettings(modelSettings);
  return { ...brokerSettings, entryCapitalPct: m.accountTradedPct, accountTradedPct: m.accountTradedPct, marginAvailablePct: m.marginAvailablePct, sellCalls: m.sellCalls, sellPuts: m.sellPuts, modelEquity: m.modelEquity };
}
