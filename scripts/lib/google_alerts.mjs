// Google Alert query construction for the weekly basket.
//
// Google retired the Alerts API, so creation/deletion is browser automation
// (scheduled assistant tasks drive google.com/alerts). This module owns the
// *queries*, which is the part worth getting right.
//
// Design notes:
//  - Query on the COMPANY NAME, not the ticker. Bare tickers are terrible
//    news queries — "SLS" is the Space Launch System, "BSX" is a clothing
//    brand. The name is quoted so Google treats it as a phrase.
//  - Trim corporate suffixes: "SELLAS Life Sciences Group, Inc." → "SELLAS
//    Life Sciences". Suffixes rarely appear in headlines and the comma
//    breaks phrase matching.
//  - Side-aware keyword sets mirror the in-house radars
//    (src/server/services/news-radar.ts): acquisition language for short
//    calls, distress language for short puts. This keeps Google Alerts as a
//    genuinely additive second source rather than an unfiltered firehose —
//    Google News indexes far more publications than the Yahoo ticker feed.
//  - One alert per position. At 6-8 names a week that's a manageable inbox,
//    and each alert is deleted after the trade settles.

const ACQUISITION_TERMS = [
  'acquisition', 'acquire', 'takeover', 'buyout', 'merger',
  '"tender offer"', '"going private"', '"strategic alternatives"',
  '"stake in"',
];

const DOWNSIDE_TERMS = [
  'bankruptcy', '"chapter 11"', '"going concern"', 'fraud',
  '"SEC investigation"', 'probe', 'restatement', 'delisting',
  'recall', '"data breach"', '"guidance cut"', '"short seller"',
  '"class action"', '"offering"',
];

// Strip legal suffixes and trailing punctuation that hurt phrase matching.
export function cleanCompanyName(name) {
  if (!name) return null;
  return name
    .replace(/,?\s+(Inc\.?|Incorporated|Corp\.?|Corporation|Ltd\.?|Limited|PLC|N\.V\.|S\.A\.|Holdings?|Group|Company|Co\.?)\b\.?/gi, '')
    .replace(/[.,]\s*$/, '')
    .trim();
}

export function buildAlertQuery(pick) {
  const clean = cleanCompanyName(pick.name);
  // Fall back to the ticker with a market qualifier if no name is available —
  // less precise, but better than an unqualified symbol.
  const subject = clean ? `"${clean}"` : `"${pick.ticker}" stock`;
  const terms = pick.side === 'call' ? ACQUISITION_TERMS : DOWNSIDE_TERMS;
  return `${subject} (${terms.join(' OR ')})`;
}

// Returns the full alert plan for a proposal: one entry per pick, plus the
// metadata the delete pass needs to find them again.
export function buildAlertPlan(proposal) {
  return {
    basket_date: proposal.basket_date,
    expiry: proposal.expiry,
    // Alerts are removed after settlement — the Saturday pass uses this.
    remove_after: proposal.expiry,
    alerts: proposal.picks.map((p) => ({
      ticker: p.ticker,
      side: p.side,
      company: cleanCompanyName(p.name) ?? p.ticker,
      query: buildAlertQuery(p),
    })),
  };
}
