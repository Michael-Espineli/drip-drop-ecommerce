const { test } = require('node:test');
const assert = require('node:assert/strict');
const { weeklyServiceDates } = require('./recurringSchedule');
const date = (value) => new Date(value + 'T12:00:00');
const keys = (values) => values.map((value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`);
const schedule = (overrides = {}) => weeklyServiceDates({ startDate: date('2026-11-02'), horizon: date('2026-11-30'), day: 'Monday', intervalDays: 14, ...overrides });
test('biweekly seed and subsequent runs retain a fourteen-day schedule anchor', () => {
  assert.deepEqual(keys(schedule()), ['2026-11-02', '2026-11-16', '2026-11-30']);
  assert.deepEqual(keys(schedule({ lastCreated: date('2026-11-02') })), ['2026-11-16', '2026-11-30']);
  assert.deepEqual(keys(schedule({ lastCreated: date('2026-11-16') })), ['2026-11-30']);
});
test('repeated weekly dispatcher runs do not progressively shift the biweekly schedule', () => {
  let lastCreated = date('2026-11-02');
  const generated = [];
  for (const horizon of ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']) {
    const dates = schedule({ lastCreated, horizon: date(horizon) });
    generated.push(...dates); if (dates.length) lastCreated = dates[dates.length - 1];
  }
  assert.deepEqual(keys(generated), ['2026-11-16', '2026-11-30']);
});
test('existing off-cycle legacy visits do not become a new anchor', () => {
  assert.deepEqual(keys(schedule({ lastCreated: date('2026-11-09') })), ['2026-11-16', '2026-11-30']);
});
test('start date is aligned on or after the chosen day and cursors before it cannot create earlier visits', () => {
  assert.deepEqual(keys(schedule({ startDate: date('2026-11-03'), lastCreated: date('2026-10-01') })), ['2026-11-09', '2026-11-23']);
});
test('weekly cadence, inclusive end boundaries, and a horizon before the next visit remain correct', () => {
  assert.deepEqual(keys(schedule({ intervalDays: 7, lastCreated: date('2026-11-02') })), ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
  assert.deepEqual(schedule({ lastCreated: date('2026-11-30') }), []);
  assert.deepEqual(schedule({ horizon: date('2026-11-01') }), []);
});
test('daylight saving changes do not shift biweekly calendar dates', () => {
  assert.deepEqual(keys(schedule({ startDate: date('2026-10-26'), lastCreated: date('2026-10-26') })), ['2026-11-09', '2026-11-23']);
});
test('invalid scheduling inputs fail explicitly', () => {
  assert.throws(() => schedule({ day: 'Invalid' }), /Invalid weekly/);
  assert.throws(() => schedule({ startDate: new Date('invalid') }), /Invalid weekly/);
});
