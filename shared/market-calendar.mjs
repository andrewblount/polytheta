// US equity / standard single-stock option sessions. NYSE calendar verified
// 2026-09-09: https://www.nyse.com/trade/hours-calendars
// Refuse unreviewed years. Add emergency closures before restarting jobs.
export const CALENDAR_YEARS = [2025, 2026, 2027, 2028];
const extraClosures = { '2025-01-09': 'National day of mourning' };
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export function easternTime(now = new Date()) {
  const p = Object.fromEntries(formatter.formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
export function parseDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Invalid date: ${iso}`);
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== iso) throw new Error(`Invalid date: ${iso}`);
  return d;
}
export function addDays(iso, days) {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function weekOf(iso) { return addDays(iso, -((parseDate(iso).getUTCDay() + 6) % 7)); }
export function currentWeek(now = new Date()) { return weekOf(easternTime(now).date); }
function nthDay(y, m, weekday, n) {
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  return addDays(first, (weekday - parseDate(first).getUTCDay() + 7) % 7 + (n - 1) * 7);
}
function observed(iso, newYear = false) {
  const day = parseDate(iso).getUTCDay();
  // NYSE stays open on Dec 31 when Jan 1 falls on Saturday.
  return day === 6 ? (newYear ? iso : addDays(iso, -1)) : day === 0 ? addDays(iso, 1) : iso;
}
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451), v = h + l - 7 * m + 114;
  return `${y}-${String(Math.floor(v / 31)).padStart(2, '0')}-${String(v % 31 + 1).padStart(2, '0')}`;
}
export function marketSession(iso) {
  const d = parseDate(iso), y = d.getUTCFullYear(), day = d.getUTCDay();
  if (!CALENDAR_YEARS.includes(y)) throw new Error(`Exchange calendar needs review for ${y}`);
  const memorial = addDays(`${y}-05-31`, -((parseDate(`${y}-05-31`).getUTCDay() + 6) % 7));
  const holidays = new Map([
    [observed(`${y}-01-01`, true), 'New Year'], [nthDay(y, 1, 1, 3), 'MLK Day'],
    [nthDay(y, 2, 1, 3), 'Presidents Day'], [addDays(easter(y), -2), 'Good Friday'],
    [memorial, 'Memorial Day'], [observed(`${y}-06-19`), 'Juneteenth'],
    [observed(`${y}-07-04`), 'Independence Day'], [nthDay(y, 9, 1, 1), 'Labor Day'],
    [nthDay(y, 11, 4, 4), 'Thanksgiving'], [observed(`${y}-12-25`), 'Christmas'],
    ...Object.entries(extraClosures),
  ]);
  const holiday = holidays.get(iso);
  if (day === 0 || day === 6 || holiday) return { date: iso, open: false, reason: holiday ?? 'Weekend', openMinute: 570, closeMinute: 960 };
  const early = iso === addDays(nthDay(y, 11, 4, 4), 1) || iso === `${y}-12-24` ||
    (iso === `${y}-07-03` && day >= 1 && day <= 4);
  return { date: iso, open: true, reason: early ? 'Early close' : 'Regular session', openMinute: 570, closeMinute: early ? 780 : 960 };
}
export function firstSessionOfWeek(iso) {
  let date = weekOf(iso);
  for (let n = 0; n < 5; n++, date = addDays(date, 1)) if (marketSession(date).open) return date;
  throw new Error(`No trading session in week ${iso}`);
}
export function weeklyExpiry(iso) {
  let date = addDays(weekOf(iso), 4);
  for (let n = 0; n < 5; n++, date = addDays(date, -1)) if (marketSession(date).open) return date;
  throw new Error(`No weekly expiry in week ${iso}`);
}
export function isMarketOpen(now = new Date()) {
  const t = easternTime(now), s = marketSession(t.date);
  return s.open && t.minutes >= s.openMinute && t.minutes < s.closeMinute;
}
export function inBriefingWindow(slot, now = new Date()) {
  const t = easternTime(now), s = marketSession(t.date);
  const start = slot === 'open' ? s.openMinute + 1 : s.closeMinute + 2;
  return s.open && t.minutes >= start && t.minutes <= start + 43;
}
export function sessionClose(iso) {
  let date = iso;
  while (!marketSession(date).open) date = addDays(date, -1);
  const s = marketSession(date);
  const anchor = new Date(`${date}T12:00:00Z`);
  const offset = 720 - easternTime(anchor).minutes;
  return new Date(+parseDate(date) + (s.closeMinute + offset) * 60000);
}
export function assertCurrentDelivery(proposal, now = new Date()) {
  const today = easternTime(now).date;
  if (proposal.basket_date !== currentWeek(now)) throw new Error('Basket is for a different trading week');
  if (proposal.expiry !== weeklyExpiry(proposal.basket_date)) throw new Error('Basket expiry does not match the exchange calendar');
  if (today < firstSessionOfWeek(proposal.basket_date) || +now >= +sessionClose(proposal.expiry)) throw new Error('Basket is outside its entry/expiry window');
  for (const field of ['generated_ts', 'data_observed_at']) {
    const at = new Date(proposal[field]);
    const age = +now - +at;
    if (!Number.isFinite(age) || age < -60000 || easternTime(at).date < firstSessionOfWeek(proposal.basket_date)) throw new Error(`Basket ${field} is missing or stale`);
  }
  if (!Array.isArray(proposal.picks) || !proposal.picks.length) throw new Error('Basket has no entries');
}
export function assertCurrentProposal(proposal, now = new Date()) {
  assertCurrentDelivery(proposal, now);
  const today = easternTime(now).date;
  for (const field of ['generated_ts', 'data_observed_at']) {
    const at = new Date(proposal[field]);
    if (+now - +at > 2 * 3600000 || easternTime(at).date !== today) throw new Error(`Basket ${field} is missing or stale`);
  }
}
