import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices:['yahooSurvey'] });
const dates = [
  new Date('2026-04-24T00:00:00Z'),
  new Date('2026-04-24T13:00:00Z'),
  new Date('2026-04-24T20:00:00Z'),
];
for (const d of dates) {
  const ch = await yf.options('LCID', { date: d });
  console.log(d.toISOString(), '-> calls:', ch?.options?.[0]?.calls?.length, 'puts:', ch?.options?.[0]?.puts?.length, 'expDate:', ch?.options?.[0]?.expirationDate);
}
// Try without date param (front month)
const ch2 = await yf.options('LCID');
console.log('default -> expDate:', ch2?.options?.[0]?.expirationDate, 'calls:', ch2?.options?.[0]?.calls?.length);
console.log('first call:', JSON.stringify(ch2?.options?.[0]?.calls?.[0], null, 2));
