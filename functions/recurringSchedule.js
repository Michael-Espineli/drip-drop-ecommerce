const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayKey = (value) => String(value || '').replace(/[\s_-]/g, '').toLowerCase();
const noon = (value) => { const date = new Date(value); date.setHours(12, 0, 0, 0); return date; };
const addDays = (value, amount) => { const date = noon(value); date.setDate(date.getDate() + amount); return date; };
const calendarDayNumber = (value) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86400000;

// Calculate each visit from the original schedule, rather than re-anchoring the
// next run on lastCreated's next weekday. Calendar-day arithmetic survives DST.
function weeklyServiceDates({ startDate, lastCreated = null, horizon, day, intervalDays = 7 }) {
  const target = weekdays.findIndex((value) => dayKey(value) === dayKey(day));
  const start = noon(startDate);
  const end = noon(horizon);
  const last = lastCreated ? noon(lastCreated) : null;
  if (target < 0 || ![7, 14].includes(intervalDays) || !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) || (last && !Number.isFinite(last.getTime()))) throw new Error('Invalid weekly recurring schedule.');
  const anchor = addDays(start, (target - start.getDay() + 7) % 7);
  const elapsed = last ? calendarDayNumber(last) - calendarDayNumber(anchor) : -1;
  const steps = Math.max(0, Math.floor(elapsed / intervalDays) + 1);
  let cursor = addDays(anchor, steps * intervalDays);
  const dates = [];
  while (cursor <= end) { dates.push(cursor); cursor = addDays(cursor, intervalDays); }
  return dates;
}

module.exports = { weeklyServiceDates };
