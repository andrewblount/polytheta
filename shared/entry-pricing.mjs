import { sessionClose } from './market-calendar.mjs';
const YEAR_MS = 365 * 86400000;
const valid = x => Number.isFinite(x) && x > 0;
export function normalCdf(x) {
  const sign = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + .3275911 * z);
  return .5 * (1 + sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-z * z)));
}
export function optionValue({ spot, strike, years, iv, rate = .04, dividendYield = 0, side }) {
  if (![spot, strike, iv].every(valid) || !Number.isFinite(years) || !Number.isFinite(rate) || !Number.isFinite(dividendYield) || !['call', 'put'].includes(side)) throw new Error('Option model inputs are unavailable');
  if (years <= 0) return Math.max(0, side === 'call' ? spot - strike : strike - spot);
  const d1 = (Math.log(spot / strike) + (rate - dividendYield + iv * iv / 2) * years) / (iv * Math.sqrt(years));
  const d2 = d1 - iv * Math.sqrt(years), s = spot * Math.exp(-dividendYield * years), k = strike * Math.exp(-rate * years);
  return Math.max(0, side === 'call' ? s * normalCdf(d1) - k * normalCdf(d2) : k * normalCdf(-d2) - s * normalCdf(-d1));
}
export function optionDelta({ spot, strike, years, iv, rate = .04, side }) {
  if (!Number.isFinite(years) || years <= 0 || !Number.isFinite(rate) || ![spot, strike, iv].every(valid) || !['call', 'put'].includes(side)) throw new Error('Delta inputs unavailable');
  const d1 = (Math.log(spot / strike) + (rate + iv * iv / 2) * years) / (iv * Math.sqrt(years));
  return normalCdf(d1) - (side === 'put' ? 1 : 0);
}
// An anchored model preserves the observed option premium, then reprices the
// same contract for elapsed calendar time, the current stock price and IV.
// VIX is a configurable approximation of stock IV, never an execution quote.
export function repriceEntry({ reference, spot, optionIv, vix, now = new Date(), settings = {} }) {
  if (!reference || ![reference.credit, reference.spot, reference.iv, reference.strike, spot].every(valid)) throw new Error('Dated option pricing reference is unavailable');
  const observed = Date.parse(reference.observedAt), expiry = +sessionClose(reference.expiry);
  const elapsed = +now - observed;
  if (!Number.isFinite(elapsed) || elapsed < -60000 || elapsed > 8 * 86400000 || observed >= expiry || +now >= expiry) throw new Error('Option pricing reference is outside its supported time window');
  let iv, ivSource;
  if (valid(optionIv)) { iv = optionIv; ivSource = 'current option IV'; }
  else if (valid(vix) && valid(reference.vix)) { iv = reference.iv * (vix / reference.vix) ** (settings.vixIvSensitivity ?? 1); ivSource = 'VIX ratio approximation'; }
  else throw new Error('Current option IV or a dated VIX comparison is required');
  if (iv > 10) throw new Error('Adjusted IV is outside the supported model range');
  const base = { spot: reference.spot, strike: reference.strike, side: reference.side, iv: reference.iv, years: (expiry - observed) / YEAR_MS, rate: (settings.modelRiskFreeRatePct ?? 4) / 100, dividendYield: reference.dividendYield ?? 0 };
  const original = optionValue(base);
  if (original < .00001) throw new Error('Option model baseline is too small for a stable adjustment');
  const years = (expiry - +now) / YEAR_MS;
  const timeOnly = optionValue({ ...base, years });
  const moved = optionValue({ ...base, years, spot });
  const adjusted = optionValue({ ...base, years, spot, iv });
  const scale = reference.credit / original;
  return { credit: adjusted * scale, referenceCredit: reference.credit, observedAt: reference.observedAt, estimatedAt: now.toISOString(),
    elapsedCalendarDays: elapsed / 86400000, spot, referenceSpot: reference.spot, iv, ivSource,
    timeEffect: (timeOnly - original) * scale, underlyingEffect: (moved - timeOnly) * scale, ivEffect: (adjusted - moved) * scale,
    model: 'market-premium-anchored Black-Scholes approximation', yearsToExpiry: years };
}
export function pricingReference(pick, proposal) {
  const reference = pick.pricing_reference ?? { observedAt: proposal.data_observed_at, spot: pick.px, iv: pick.iv, vix: proposal.macro?.VIX,
    credit: pick.cr, strike: pick.K, side: pick.side, expiry: proposal.expiry };
  if (reference.side !== pick.side || reference.strike !== pick.K || reference.expiry !== proposal.expiry || reference.ticker && reference.ticker !== pick.ticker) throw new Error('Pricing reference does not match the exact option contract');
  return reference;
}
