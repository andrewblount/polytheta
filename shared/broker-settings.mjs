import { validateStrikeOverrides } from './strike-settings.mjs';
export const DEFAULT_BROKER_SETTINGS = Object.freeze({
  connection: 'tws', quoteSource: 'ibkr', pauseEntries: true,
  entryCapitalPct: 100, maxTrades: 8, callAllocationPct: 100, putAllocationPct: 0,
  reserveLeverageCeiling: 4, minimumCreditRatio: 0.9, maxEntrySpread: 0.15,
  maxQuoteAgeSeconds: 15, entryTimeoutSeconds: 300, maxExitPremiumMultiple: 1.5,
  excludedTickers: Object.freeze(['TSLA', 'SPCX']),
  strikeOverrides: Object.freeze([]),
});
export function validateBrokerSettings(input) {
  const s = { ...DEFAULT_BROKER_SETTINGS, ...input };
  if (!['tws', 'web-api'].includes(s.connection) || s.quoteSource !== 'ibkr') throw new Error('Select TWS or Web API; execution quotes must use IB');
  if (typeof s.pauseEntries !== 'boolean') throw new Error('Invalid entry pause setting');
  s.excludedTickers = normalizeExclusions(s.excludedTickers);
  s.strikeOverrides = validateStrikeOverrides(s.strikeOverrides);
  for (const [key, low, high] of [
    ['entryCapitalPct', 0, 100], ['maxTrades', 1, 20], ['callAllocationPct', 0, 100], ['putAllocationPct', 0, 100],
    ['reserveLeverageCeiling', 1, 4], ['minimumCreditRatio', 0.5, 1], ['maxEntrySpread', 0.01, 0.15],
    ['maxQuoteAgeSeconds', 1, 30], ['entryTimeoutSeconds', 30, 900], ['maxExitPremiumMultiple', 1, 3],
  ]) if (!Number.isFinite(s[key]) || s[key] < low || s[key] > high) throw new Error(`Invalid ${key}: expected ${low}–${high}`);
  if (Math.abs(s.callAllocationPct + s.putAllocationPct - 100) > 0.001) throw new Error('Call and put allocations must total 100%');
  if (!Number.isInteger(s.maxTrades) || !basketCounts(s).total) throw new Error('Maximum trades and allocation split must allow whole, equally allocated trades');
  return Object.fromEntries(Object.keys(DEFAULT_BROKER_SETTINGS).map(key => [key, s[key]]));
}

export function normalizeExclusions(input) {
  const entries = typeof input === 'string' ? input.split(/[\s,;]+/) : input;
  if (!Array.isArray(entries) || entries.length > 200) throw new Error('Enter up to 200 excluded tickers');
  const symbols = [...new Set(entries.map(x => String(x).trim().toUpperCase().replace(/^SPACEX$/, 'SPCX')).filter(Boolean))];
  if (symbols.some(x => !/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(x))) throw new Error('Use ticker symbols separated by commas or new lines');
  return symbols;
}
export function isExcluded(pick, settings) {
  const excluded = new Set(normalizeExclusions(settings.excludedTickers ?? DEFAULT_BROKER_SETTINGS.excludedTickers));
  const symbol = String(pick.ticker ?? pick.symbol ?? '').toUpperCase();
  if (excluded.has(symbol)) return true;
  const name = String(pick.name ?? pick.companyName ?? '').replace(/[^a-z]/gi, '').toUpperCase();
  return excluded.has('SPCX') && (name.includes('SPACEX') || name.includes('SPACEEXPLORATIONTECHNOLOGIES'));
}

// The allocation split controls trade counts, not unequal dollar allocations.
export function basketCounts(settings, availableCalls = Infinity, availablePuts = Infinity) {
  for (let total = settings.maxTrades; total >= 1; total--) {
    const call = total * settings.callAllocationPct / 100;
    if (Math.abs(call - Math.round(call)) > 1e-8) continue;
    const calls = Math.round(call), puts = total - calls;
    if (calls <= availableCalls && puts <= availablePuts) return { calls, puts, total };
  }
  return { calls: 0, puts: 0, total: 0 };
}
