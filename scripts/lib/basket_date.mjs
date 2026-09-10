import { easternTime, weekOf, addDays, parseDate, weeklyExpiry } from '../../shared/market-calendar.mjs';
export const isoDate = d => d.toISOString().slice(0, 10);
export function nextOrTodayWeekday(d, weekday) {
  return parseDate(addDays(isoDate(d), (weekday - d.getUTCDay() + 7) % 7));
}
// Week IDs mean Monday; actual entry can be Tuesday after a holiday.
// A missed weekday run recovers THIS week, never silently selects next week.
export function deriveBasketDate(now = new Date()) {
  const date = easternTime(now).date;
  const day = parseDate(date).getUTCDay();
  return day === 0 || day === 6 ? addDays(weekOf(date), 7) : weekOf(date);
}
export const expiryFromBasketDate = weeklyExpiry;
