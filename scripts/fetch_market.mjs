import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const yf = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices: ['yahooSurvey'] });
const OUT = path.join(REPO_ROOT, 'baskets', '2026-04-20', 'data');
fs.mkdirSync(OUT, { recursive: true });

function csvRow(vals) { return vals.map(v => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }).join(','); }

// 1) Macro + GSRS inputs
const macroTickers = ['SPY','^GSPC','^VIX','^SKEW','^MOVE','^OVX','^RVX','QQQ','IWM','TLT','HYG','JNK','DXY','UUP','GLD','USO','XLE','XLF','XLK'];
const macroQuotes = await yf.quote(macroTickers);
const macroOut = ['ticker,price,currency,exchange,market_time,prev_close,fifty_two_wk_high,fifty_two_wk_low'];
for (const q of macroQuotes) {
  macroOut.push(csvRow([q.symbol, q.regularMarketPrice, q.currency, q.fullExchangeName, q.regularMarketTime ? new Date(q.regularMarketTime*1000).toISOString() : '', q.regularMarketPreviousClose, q.fiftyTwoWeekHigh, q.fiftyTwoWeekLow]));
}
fs.writeFileSync(path.join(OUT,'macro_quotes.csv'), macroOut.join('\n'));
console.log('macro_quotes.csv rows:', macroQuotes.length);

// 2) SPY / SPX / VIX history (6 months)
const end = new Date();
const start = new Date(end.getTime() - 180*86400*1000);
for (const t of ['SPY','^GSPC','^VIX']) {
  try {
    const h = await yf.chart(t, { period1: start, period2: end, interval: '1d' });
    const rows = ['date,open,high,low,close,volume'];
    for (const q of h.quotes) {
      rows.push(csvRow([q.date?.toISOString?.().slice(0,10) ?? q.date, q.open, q.high, q.low, q.close, q.volume]));
    }
    const fname = t.replace(/[^A-Za-z0-9]/g,'') + '_history.csv';
    fs.writeFileSync(path.join(OUT, fname), rows.join('\n'));
    console.log(t, 'history rows:', h.quotes.length);
  } catch (e) { console.error(t, 'hist err', e.message); }
}

// 3) VIX 1-day change (for GSRS)
const vix = macroQuotes.find(q=>q.symbol==='^VIX');
if (vix) {
  const chg = vix.regularMarketPrice - vix.regularMarketPreviousClose;
  console.log('VIX 1d change:', chg.toFixed(2), '(', ((chg/vix.regularMarketPreviousClose)*100).toFixed(2),'%)');
}
