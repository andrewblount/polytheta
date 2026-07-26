// Spot-check specific candidate strikes for bid/ask on 2026-05-01 expiry
import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices: ['yahooSurvey'] });
const expiryDate = new Date('2026-05-01T00:00:00Z');
const targets = [
  {ticker:'ENPH', side:'call', strike:43},
  {ticker:'NN',   side:'call', strike:22},
  {ticker:'GLXY', side:'call', strike:30},
  {ticker:'RIVN', side:'call', strike:18.5},
  {ticker:'POET', side:'put',  strike:12},
  {ticker:'ZETA', side:'put',  strike:15.5},
  {ticker:'RIOT', side:'put',  strike:16.5},
  {ticker:'SMR',  side:'put',  strike:10.5},
  // Also confirm the two bad ones
  {ticker:'DJT',  side:'put',  strike:7.5},
  {ticker:'QXO',  side:'put',  strike:17},
];
for (const t of targets) {
  try {
    let chain;
    try { chain = await yf.options(t.ticker, { date: expiryDate }); } catch {}
    if (!chain) {
      const all = await yf.options(t.ticker);
      const target = all.expirationDates.map(d=>new Date(d)).find(d=>Math.abs(d-expiryDate)<2*86400000);
      if (target) chain = await yf.options(t.ticker, { date: target });
    }
    const arr = t.side==='call' ? chain.options[0].calls : chain.options[0].puts;
    const r = arr.find(x=>x.strike===t.strike);
    if (r) {
      const mid = (r.bid!=null && r.ask!=null) ? (r.bid+r.ask)/2 : null;
      console.log(`${t.ticker.padEnd(5)} ${t.side} ${t.strike.toString().padStart(5)}  bid=${(r.bid??'—').toString().padStart(5)} ask=${(r.ask??'—').toString().padStart(5)} last=${(r.lastPrice??'—').toString().padStart(5)} mid=${mid?.toFixed(2)} OI=${r.openInterest??0} vol=${r.volume??0}`);
    } else {
      console.log(`${t.ticker} ${t.side} ${t.strike} NOT FOUND`);
    }
  } catch (e) { console.log(`${t.ticker} ${t.side}: ERR ${e.message}`); }
}
