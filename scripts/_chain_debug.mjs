import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices:['yahooSurvey'] });
const ch = await yf.options('LCID', { date: new Date('2026-04-24T20:00:00Z') });
console.log('keys:', Object.keys(ch || {}));
console.log('options[0] keys:', Object.keys(ch?.options?.[0] || {}));
console.log('calls count:', ch?.options?.[0]?.calls?.length);
console.log('first call:', JSON.stringify(ch?.options?.[0]?.calls?.[0], null, 2));
console.log('expirationDates:', ch?.expirationDates?.slice?.(0,6));
