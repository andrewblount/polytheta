import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false } });
const q = await yf.quote(['SPY','^VIX','^GSPC','^SKEW','^MOVE','^OVX','^RVX']);
console.log(JSON.stringify(q.map(r=>({s:r.symbol,p:r.regularMarketPrice,t:r.regularMarketTime,ex:r.fullExchangeName})),null,2));
