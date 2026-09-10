import { parseDate } from './market-calendar.mjs';
export function validateStrikeOverrides(input = []) {
  if (!Array.isArray(input) || input.length > 200) throw new Error('Use at most 200 per-trade strike settings');
  const seen = new Set();
  return input.map(row => {
    const ticker = String(row.ticker ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,15}$/.test(ticker) || !['call','put'].includes(row.side)) throw new Error('Select a ticker and call or put for each OTM setting');
    parseDate(row.expiry);
    if (!Number.isFinite(row.minimumOtmPct) || row.minimumOtmPct < 0 || row.minimumOtmPct >= 100) throw new Error('Minimum OTM must be 0 to less than 100 percent');
    const key = `${ticker}:${row.side}:${row.expiry}`;
    if (seen.has(key)) throw new Error('Only one OTM setting is allowed per ticker, side and expiry');
    seen.add(key);
    return { ticker, side: row.side, expiry: row.expiry, minimumOtmPct: row.minimumOtmPct };
  });
}
export function minimumOtmFor(settings, ticker, side, expiry) {
  return settings?.strikeOverrides?.find(r => r.ticker === ticker.toUpperCase() && r.side === side && r.expiry === expiry)?.minimumOtmPct ?? 0;
}
export function otmPercent(side, strike, underlying) {
  if (!(underlying > 0) || !Number.isFinite(strike)) return NaN;
  return (side === 'call' ? strike - underlying : underlying - strike) / underlying * 100;
}
