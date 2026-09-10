// Headlines are data, never executable instructions. A match and a verified
// issuer/target relationship are separate requirements for automatic exits.
const callTerms = /\b(takeover|take-over|buyout|merger|merge with|tender offer|go private|going private|take-private|strategic alternatives|strategic review|activist stake|13d|deal talks|to be bought|explores sale|exploring a sale|sale of the company|acquisition|acquire[ds]?)\b/i;
const putTerms = /\b(bankrupt(?:cy)?|chapter 11|going concern|sec investigation|sec probe|doj probe|fraud|restatement|delist(?:ing)?|recall|data breach|cyberattack|cyber attack|guidance cut|cuts guidance|withdraws guidance|slashes guidance|ceo resigns|ceo steps down|cfo resigns|cfo departs|stock offering|share offering|public offering|secondary offering|trading halted|short seller|short report|under investigation)\b/i;
const trusted = new Set(['reuters.com','bloomberg.com','wsj.com','ft.com','sec.gov','apnews.com']);
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function publicationTime(value) {
  return value instanceof Date ? +value : typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value);
}
export function classifyNews(items, { ticker, name = '', lookbackHours = 96, now = new Date() }) {
  const out = { call: [], put: [], checked_at: now.toISOString() };
  const company = name.replace(/\b(incorporated|inc\.?|corporation|corp\.?|ltd\.?|limited|holdings?|class [a-z]|common stock)\b/ig, '').replace(/[, .]+$/g, '').trim();
  const names = [ticker, ...(company.length >= 4 ? [company] : [])];
  const issuer = new RegExp(`\\b(?:${names.map(escape).join('|')})\\b`, 'i');
  for (const item of items) {
    const title = item.title, link = item.link;
    const time = publicationTime(item.providerPublishTime ?? item.publishedAt);
    if (!title || !link || !Number.isFinite(time) || time > +now + 60000 || time < +now - lookbackHours * 3600000) continue;
    let host; try { const u = new URL(link); if (u.protocol !== 'https:') continue; host = u.hostname.replace(/^www\./, ''); } catch { continue; }
    // Search results may include unrelated articles; ticker tags alone are insufficient.
    if (!issuer.test(title)) continue;
    const relevant = !item.relatedTickers?.length || item.relatedTickers.includes(ticker);
    if (!relevant) continue;
    const trustedSource = trusted.has(host) || /^(Reuters|Bloomberg|The Wall Street Journal|Financial Times|Associated Press)$/i.test(item.publisher ?? '');
    for (const [side, pattern] of [['call', callTerms], ['put', putTerms]]) {
      const match = title.match(pattern);
      if (!match) continue;
      // A company BUYING another business is not a takeover of our short call.
      const issuerPattern = `(?:${names.map(escape).join('|')})`;
      const buyer = new RegExp(`\\b${issuerPattern}\\b.{0,40}\\b(to acquire|acquires|buys|completes acquisition|acquisition of)\\b`, 'i').test(title);
      const target = new RegExp(`\\b${issuerPattern}\\b.{0,60}\\b(takeover|buyout|to be acquired|to be bought|take-private|going private|strategic alternatives|explores sale|deal talks|merger talks|merger agreement|merger with|merger approved|agrees to merge|agreed to merge)\\b|\\b(acquire|acquires|buyout of|takeover of|bid for)\\s+${issuerPattern}\\b`, 'i').test(title);
      const actionable = trustedSource && (side === 'put' || target && !buyer);
      if (side === 'call' && buyer) continue;
      out[side].push({ title, link, publisher: item.publisher ?? host, publishedAt: new Date(time).toISOString(), matched: match[0], actionable });
    }
  }
  return out;
}
