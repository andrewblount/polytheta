import { addDays, currentWeek, easternTime, firstSessionOfWeek, marketSession, parseDate, sessionClose, weeklyExpiry, weekOf } from './market-calendar.mjs';

export function clockMinute(value) {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new Error('Use HH:MM for trading times');
  const [h, m] = value.split(':').map(Number);
  if (h > 23 || m > 59) throw new Error('Invalid trading time');
  return h * 60 + m;
}
export function sessionTime(date, minute) {
  return new Date(+sessionClose(date) + (minute - marketSession(date).closeMinute) * 60000);
}
export function entrySchedule(week, settings) {
  if (weekOf(week) !== week) throw new Error('Basket week must be its Monday date');
  const friday = settings.entryTiming === 'friday-close';
  const date = friday ? weeklyExpiry(addDays(week, -7)) : firstSessionOfWeek(week);
  const session = marketSession(date);
  const skipped = friday && settings.fridayHolidayPolicy === 'skip' && parseDate(date).getUTCDay() !== 5;
  const startMinute = friday ? session.closeMinute - 5 : clockMinute(settings.mondayEntryStart ?? '09:45');
  const endMinute = friday ? session.closeMinute : Math.min(clockMinute(settings.mondayEntryEnd ?? '10:30'), session.closeMinute);
  if (startMinute < session.openMinute || endMinute <= startMinute) throw new Error('Entry window is outside the exchange session');
  return { week, date, start: sessionTime(date, startMinute), end: sessionTime(date, endMinute), skipped,
    expiry: weeklyExpiry(week), mode: friday ? 'friday-close' : 'monday-morning' };
}
export function isEntryWindow(week, settings, now = new Date()) {
  const s = entrySchedule(week, settings);
  return !s.skipped && +now >= +s.start && +now < +s.end;
}
export function entryWeek(settings, now = new Date()) {
  const week = currentWeek(now);
  return settings.entryTiming === 'friday-close' ? addDays(week, 7) : week;
}
// Friday research prepares next week's contracts before the five-minute window.
// Monday mode can use that same dated baseline, then refresh at the open.
export function buildContext(settings, now = new Date()) {
  const today = easternTime(now), session = marketSession(today.date), week = currentWeek(now);
  if (!session.open || today.minutes < session.openMinute || today.minutes >= session.closeMinute) return null;
  const next = addDays(week, 7);
  if (today.date === weeklyExpiry(week) && today.minutes >= session.closeMinute - (settings.preparationLeadMinutes ?? 90)) {
    const target = entrySchedule(next, settings);
    if (target.skipped) return null;
    return { week: next, prepare: +now < +target.start - (settings.finalizeLeadMinutes ?? 10) * 60000, schedule: target };
  }
  if (settings.entryTiming !== 'friday-close') {
    const target = entrySchedule(week, settings);
    if (today.date === target.date && +now < +target.end) return { week, prepare: +now < +target.start - (settings.finalizeLeadMinutes ?? 10) * 60000, schedule: target };
  }
  return null;
}

export function proposalWindow(proposal) {
  const settings = proposal.allocation_settings ?? { entryTiming: 'monday-morning' };
  return entrySchedule(proposal.basket_date, settings);
}
