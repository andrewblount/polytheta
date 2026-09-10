import { addDays, currentWeek, marketSession, weeklyExpiry } from './market-calendar.mjs';
import { entrySchedule, sessionTime } from './entry-schedule.mjs';

const dateLabel = date => new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${date}T12:00:00Z`));
const timeLabel = date => `${new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  timeZone: 'America/New_York',
}).format(date)} ET`;

// A missing basket stays missing. The upcoming schedule is a plan, never a
// synthetic basket or evidence that a worker has completed its data checks.
export function missingBasketAvailability(settings, now = new Date()) {
  const weekOf = currentWeek(now);
  const current = entrySchedule(weekOf, settings);
  const missed = +now >= +current.end;
  const state = current.skipped ? 'skipped' : missed ? 'missed' : 'pending';
  let nextScheduled = null;
  for (let offset = 0; offset <= 4; offset++) {
    const next = entrySchedule(addDays(weekOf, offset * 7), settings);
    if (next.skipped || +now >= +next.end) continue;
    const researchDate = weeklyExpiry(addDays(next.week, -7));
    const preparationAt = sessionTime(researchDate,
      marketSession(researchDate).closeMinute - (settings.preparationLeadMinutes ?? 90));
    const finalRefreshAt = new Date(+next.start - (settings.finalizeLeadMinutes ?? 10) * 60000);
    nextScheduled = {
      weekOf: next.week,
      title: `Next basket: week of ${dateLabel(next.week)}`,
      preparationAt: preparationAt.toISOString(),
      finalRefreshAt: finalRefreshAt.toISOString(),
      entryStart: next.start.toISOString(),
      entryEnd: next.end.toISOString(),
      preparationLabel: timeLabel(preparationAt),
      finalRefreshLabel: timeLabel(finalRefreshAt),
      entryLabel: `${timeLabel(next.start)} to ${timeLabel(next.end)}`,
      note: 'Scheduled under your entry settings. Publication depends on the data and selection checks passing.',
    };
    break;
  }
  return {
    weekOf, state,
    title: `No basket for the week of ${dateLabel(weekOf)}`,
    message: current.skipped
      ? 'Your Friday holiday setting skips entry for this week.'
      : missed
        ? `No basket was published for this week. Its entry window ended ${timeLabel(current.end)}. A late basket would use different entry prices.`
        : `This week's basket has not been published yet. The entry window is ${timeLabel(current.start)} to ${timeLabel(current.end)}.`,
    nextScheduled,
  };
}
