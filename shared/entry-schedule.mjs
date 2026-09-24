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
// The entry window is the execution service's window: the only time the IB
// worker may place entry orders for a week's basket. The MODEL basket is
// finalized at the same time when everything works, but it is not bound by the
// window — see buildContext and modelPublicationWindow.
export function entrySchedule(week, settings) {
  if (weekOf(week) !== week) throw new Error('Basket week must be its Monday date');
  const friday = settings.entryTiming === 'friday-close';
  const date = friday ? weeklyExpiry(addDays(week, -7)) : firstSessionOfWeek(week);
  const session = marketSession(date);
  const skipped = friday && settings.fridayHolidayPolicy === 'skip' && parseDate(date).getUTCDay() !== 5;
  const startMinute = friday ? session.closeMinute - 5 : clockMinute(settings.mondayEntryStart ?? '09:45');
  const endMinute = friday ? session.closeMinute : Math.min(clockMinute(settings.mondayEntryEnd ?? '10:30'), session.closeMinute);
  if (startMinute < session.openMinute || endMinute <= startMinute) throw new Error('Entry window is outside the exchange session');
  const mode = friday ? 'friday-close' : 'monday-morning';
  return { week, date, start: sessionTime(date, startMinute), end: sessionTime(date, endMinute), skipped,
    expiry: weeklyExpiry(week), mode };
}
export function isEntryWindow(week, settings, now = new Date()) {
  const s = entrySchedule(week, settings);
  return !s.skipped && +now >= +s.start && +now < +s.end;
}
export function entryWeek(settings, now = new Date()) {
  const week = currentWeek(now);
  return settings.entryTiming === 'friday-close' ? addDays(week, 7) : week;
}
// The model publication window: from the final-refresh lead before the entry
// window until the close of the last session BEFORE expiry. A basket finalized
// after the entry window is a late model basket; it is still published, with
// its actual pricing time, because the model track record must exist for every
// week regardless of what any broker did. Nothing is ever modeled on its own
// expiry day (0 DTE is not the strategy).
export function modelPublicationWindow(week, settings, now = new Date()) {
  const schedule = entrySchedule(week, settings);
  if (schedule.skipped) return { open: false, late: false, reason: 'Friday holiday policy skips this week', schedule };
  const today = easternTime(now);
  const session = marketSession(today.date);
  const lead = (settings.finalizeLeadMinutes ?? 10) * 60000;
  if (today.date < schedule.date || today.date === schedule.date && +now < +schedule.start - lead) return { open: false, late: false, reason: 'Finalization begins at the configured lead before the entry window', schedule };
  if (today.date >= schedule.expiry) return { open: false, late: true, reason: 'No model basket is finalized on or after its expiry session', schedule };
  if (!session.open || today.minutes < session.openMinute || today.minutes >= session.closeMinute) return { open: false, late: +now >= +schedule.end, reason: 'Exchange session closed', schedule };
  return { open: true, late: +now >= +schedule.end, schedule };
}
// Friday research prepares next week's contracts before the five-minute window.
// Monday mode can use that same dated baseline, then refresh at the open. After
// the entry window the model keeps building and publishes late rather than
// leaving a hole in the track record.
export function buildContext(settings, now = new Date()) {
  const today = easternTime(now), session = marketSession(today.date), week = currentWeek(now);
  if (!session.open || today.minutes < session.openMinute || today.minutes >= session.closeMinute) return null;
  const lead = (settings.finalizeLeadMinutes ?? 10) * 60000;
  const next = addDays(week, 7);
  if (today.date === weeklyExpiry(week) && today.minutes >= session.closeMinute - (settings.preparationLeadMinutes ?? 90)) {
    const target = entrySchedule(next, settings);
    if (target.skipped) return null;
    return { week: next, prepare: +now < +target.start - lead, late: +now >= +target.end, schedule: target };
  }
  const target = entrySchedule(week, settings);
  if (target.skipped) return null;
  if (today.date === target.date) return { week, prepare: +now < +target.start - lead, late: +now >= +target.end, schedule: target };
  if (today.date > target.date && today.date < target.expiry) return { week, prepare: false, late: true, schedule: target };
  return null;
}
export function proposalWindow(proposal) {
  const settings = proposal.allocation_settings ?? { entryTiming: 'monday-morning' };
  return entrySchedule(proposal.basket_date, settings);
}
