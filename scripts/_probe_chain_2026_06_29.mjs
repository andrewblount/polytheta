import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices: ['yahooSurvey'] });
for (const d of ['2026-07-02','2026-07-03']) {
  try {
    const c = await yf.options('AAPL',{date:new Date(d+'T00:00:00Z')});
    console.log(d, 'options[0] calls/puts:', c?.options?.[0]?.calls?.length, c?.options?.[0]?.puts?.length);
  } catch (e) { console.log(d, 'ERROR', e.message); }
}
