const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { addCalendarDays, calendarDate, dateKey } = require('./routeState');

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('This test requires the local Firestore emulator.');
admin.initializeApp({ projectId: 'demo-dripdrop-workflow' });
const db = admin.firestore();
const { updateServiceStopDayPermanently } = require('./callableFunctions/general');
after(() => admin.app().delete());

test('a reviewed permanent move commits dates, tasks, both route types, and the result atomically in Firestore', async () => {
  const companyId = 'route-week-emulator';
  const zone = 'America/Los_Angeles';
  const today = dateKey(new Date(), zone);
  const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
  const sunday = addCalendarDays(today, -weekday);
  const friday = addCalendarDays(sunday, 5);
  const nextFriday = addCalendarDays(friday, 7);
  const nextMonday = addCalendarDays(sunday, 8);
  const asDate = key => calendarDate(key, zone);
  const company = db.collection('companies').doc(companyId);
  const doc = path => db.doc(`${company.path}/${path}`);
  const add = (batch, path, value) => batch.set(doc(path), value);
  const batch = db.batch();
  batch.set(company, { ownerId: 'office', timeZone: zone });
  add(batch, 'companyUsers/alex', { userId: 'alex', userName: 'Alex', status: 'Active' });
  add(batch, 'companyUsers/sam', { userId: 'sam', userName: 'Sam', status: 'Active' });
  add(batch, 'recurringServiceStop/weekly', {
    day: 'Friday', startDate: asDate(addCalendarDays(friday, -28)), noEndDate: true, frequency: 'Weekly',
    techId: 'alex', tech: 'Alex', customerName: 'QA pool', lastCreated: asDate(nextFriday),
  });
  for (const [id, date] of Object.entries({ due: friday, future: nextFriday })) {
    add(batch, 'serviceStops/' + id, { recurringServiceStopId: 'weekly', techId: 'alex',
      tech: 'Alex', serviceDate: asDate(date), operationStatus: 'Not Finished' });
  }
  add(batch, 'activeRoutes/alex-friday', { date: asDate(friday), techId: 'alex',
    serviceStopsIds: ['due'], order: [{ serviceStopId: 'due', order: 1 }], totalStops: 1, finishedStops: 0 });
  add(batch, 'serviceStops/due/tasks/brush', { status: 'Scheduled', workerId: 'alex', contractedRate: 0 });
  add(batch, 'recurringRoutes/weekly-route', { day: 'Friday', techId: 'alex',
    rssIds: ['weekly'], order: [{ recurringServiceStopId: 'weekly', order: 1 }] });
  await batch.commit();

  const run = review => updateServiceStopDayPermanently.run({
    rawRequest: {}, auth: { uid: 'office', token: {} },
    data: { companyId, serviceStopList: [{ id: 'due' }], newDay: 'Monday', newTech: { userId: 'sam' }, currentWeekReview: review },
  });
  const preview = await run({ action: 'preview' });
  assert.equal(preview.schedules[0].nextDates[0], nextMonday);
  const request = { action: 'commit', previewId: preview.previewId, requestId: 'approve',
    choices: [{ stopId: 'due', action: 'move', dateKey: today, techId: 'sam' }] };
  const result = await run(request);
  const [current, future, originalRoute, destination, task, journal] = await Promise.all([
    doc('serviceStops/due').get(), doc('serviceStops/future').get(), doc('activeRoutes/alex-friday').get(),
    doc('activeRoutes/com_ar_' + today.replaceAll('-', '') + '_sam').get(),
    doc('serviceStops/due/tasks/brush').get(), doc('routeMoveRequests/approve').get(),
  ]);
  assert.equal(result.status, 200);
  assert.equal(current.data().recurringServiceStopDateKey, friday);
  assert.equal(dateKey(current.data().serviceDate, zone), today);
  assert.equal(dateKey(future.data().serviceDate, zone), nextMonday);
  assert.deepEqual(originalRoute.data().serviceStopsIds, []);
  assert.deepEqual(destination.data().serviceStopsIds, ['due']);
  assert.equal(task.data().workerId, 'sam');
  assert.equal(journal.data().result.requestId, 'approve');
  assert.equal((await run(request)).alreadyApplied, true);
});
