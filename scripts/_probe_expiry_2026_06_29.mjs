import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices: ['yahooSurvey'] });
for (const t of ['AAPL','SOFI','SPY','AAL']) {
  const all = await yf.options(t);
  console.log(t, '#expirations:', all.expirationDates?.length, 'first few:', all.expirationDates?.slice(0,6).map(d=>new Date(d).toISOString().slice(0,10)));
}
