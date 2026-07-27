import YahooFinance from "yahoo-finance2";

// News radars from the trading system spec, automated.
//
// Acquisition radar (call side): a takeover of a shorted name gaps the stock
// up with no ceiling — the spec's worst-case for naked calls. Any credible
// M&A signal means the radar is "no longer clean" and the position exits.
//
// Downside-gap radar (put side): fraud, bankruptcy, regulatory action, or a
// catastrophic operational event gaps the stock down through the strike.
//
// Keyword matching on fresh headlines is deliberately sensitive — the spec
// says ANY credible signal triggers the radar. The alert email carries the
// headline and link; the trader judges credibility. Keep the keyword lists
// in sync with scripts/lib/news_radar.mjs (pre-entry scan).

const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ["yahooSurvey"],
});

const ACQUISITION_KEYWORDS = [
  "acqui", // acquisition / acquire / acquired / acquirer
  "takeover", "take-over", "buyout", "merger", "merge with", "tender offer",
  "go private", "going private", "take-private", "strategic alternatives",
  "strategic review", "activist stake", "13d", "bid for", "deal talks",
  "in talks to buy", "to be bought", "explores sale", "exploring a sale",
  "sale of the company",
];

const DOWNSIDE_KEYWORDS = [
  "bankrupt", "chapter 11", "going concern", "sec investigation", "sec probe",
  "doj probe", "fraud", "restatement", "accounting issues", "delist",
  "recall", "data breach", "cyberattack", "cyber attack", "hacked",
  "guidance cut", "cuts guidance", "withdraws guidance", "slashes guidance",
  "ceo resigns", "ceo steps down", "cfo resigns", "cfo departs",
  "stock offering", "share offering", "public offering", "secondary offering",
  "dilut", "trading halted", "short seller", "short report", "class action",
  "under investigation",
];

export interface RadarHit {
  title: string;
  link: string;
  publisher: string;
  publishedAt: string;
  matched: string;
}

const LOOKBACK_HOURS = 72;

export async function scanNewsRadar(
  ticker: string,
  side: "call" | "put",
): Promise<RadarHit[]> {
  const keywords = side === "call" ? ACQUISITION_KEYWORDS : DOWNSIDE_KEYWORDS;
  let news: Array<{
    title?: string;
    link?: string;
    publisher?: string;
    providerPublishTime?: Date | number;
  }> = [];
  try {
    const result = await yf.search(ticker, { newsCount: 10, quotesCount: 0 });
    news = result.news ?? [];
  } catch (err) {
    console.warn(`news radar: search failed for ${ticker}:`, err);
    return [];
  }

  const cutoff = Date.now() - LOOKBACK_HOURS * 3600 * 1000;
  const hits: RadarHit[] = [];
  for (const item of news) {
    if (!item.title || !item.link) continue;
    const publishedAt = item.providerPublishTime
      ? new Date(item.providerPublishTime)
      : null;
    if (publishedAt && publishedAt.getTime() < cutoff) continue;
    const lower = item.title.toLowerCase();
    const matched = keywords.find((k) => lower.includes(k));
    if (!matched) continue;
    hits.push({
      title: item.title,
      link: item.link,
      publisher: item.publisher ?? "unknown",
      publishedAt: publishedAt?.toISOString() ?? "",
      matched,
    });
  }
  return hits;
}
