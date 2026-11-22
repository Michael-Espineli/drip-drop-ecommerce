const { test } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');

admin.initializeApp({ projectId: 'demo-recurring-operations' });
const realDb = admin.firestore();
let memory;
realDb.collection = (...args) => memory.collection(...args);
realDb.runTransaction = (...args) => memory.runTransaction(...args);
realDb.batch = () => {
  const operations = [];
  return { set: (ref, data, options) => operations.push(() => memory.set(ref.path, data, options)),
    update: (ref, data) => operations.push(() => memory.set(ref.path, data, { merge: true })),
    delete: (ref) => operations.push(() => memory.records.delete(ref.path)),
    commit: async () => operations.forEach((operation) => operation()) };
};
const general = require('./callableFunctions/general');
const mail = require('./sendGrid/general');
const timed = require('./timeBased/general');
const c = 'companies/company';
const rss = { id: 'rss', customerId: 'customer', customerName: 'Customer', serviceLocationId: 'site', techId: 'tech',
  frequency: 'Weekly', day: 'Monday', startDate: new Date('2026-11-02T12:00:00Z').getTime(), noEndDate: true };
function fixture() {
  memory = new MemoryFirestore({ [c]: { ownerId: 'owner' },
    [c + '/customers/customer']: { firstName: 'Test', lastName: 'Customer' },
    [c + '/serviceLocations/site']: { customerId: 'customer', address: {} },
    [c + '/companyUsers/tech']: { userId: 'tech', userName: 'Tech', status: 'Active' },
    [c + '/serviceStops/stop']: { techId: 'tech' },
    [c + '/recurringServiceStop/rss']: rss,
    [c + '/recurringRoutes/route']: { day: 'Monday', techId: 'tech', order: [], rssIds: [] },
  });
  const originalDoc = memory.doc.bind(memory);
  memory.doc = (path) => ({ ...originalDoc(path),
    update: async (data) => { assert.ok(memory.records.has(path)); memory.set(path, data, { merge: true }); },
    delete: async () => memory.records.delete(path),
    create: async (data) => {
      if (memory.records.has(path)) { const error = new Error('already exists'); error.code = 6; throw error; }
      memory.set(path, data);
    },
  });
}
const request = (payload, uid) => ({ data: { companyId: 'company', ...payload }, rawRequest: {}, auth: uid ? { uid, token: {} } : undefined });
const cases = {
  createFirstRecurringServiceStop2: { recurringServiceStop: rss }, createFirstRecurringServiceStop: { recurringServiceStop: rss },
  updateRecurringServiceStop: { recurringServiceStop: rss }, deleteRecurringServiceStop: { stopId: 'rss' },
  endRecurringServiceStop: { stopId: 'rss', endDate: Date.now() }, deleteRecurringRoute: { routeId: 'route' },
  updateRecurringRouteOrderPermanently: { routeId: 'route', serviceStopOrders: [{ recurringServiceStopId: 'rss' }] },
  updateRecurringServiceStopsRouteAssignment: { recurringServiceStopIds: ['rss'], targetTechId: 'tech', targetDay: 'Tuesday' },
  updateServiceStopDayPermanently: { serviceStopList: [{ id: 'stop' }], newTech: { userId: 'tech' }, newDay: 'Tuesday' },
  makeUpdatesToRecurringRoutes: { routeId: 'route' },
};
test('actual exported recurring callables reject unsigned and cross-company requests with no writes', async () => {
  for (const [name, payload] of Object.entries(cases)) {
    fixture();
    const before = [...memory.records];
    await assert.rejects(general[name].run(request(payload)), { code: 'unauthenticated' });
    await assert.rejects(general[name].run(request(payload, 'outsider')), { code: 'permission-denied' });
    assert.deepEqual([...memory.records], before, name);
  }
});
test('actual report callable denies unauthorized requests before any email work', async () => {
  fixture();
  await assert.rejects(mail.sendServiceReportOnFinish.run(request({ serviceStopId: 'stop' })), { code: 'unauthenticated' });
  await assert.rejects(mail.sendServiceReportOnFinish.run(request({ serviceStopId: 'stop' }, 'outsider')), { code: 'permission-denied' });
});
test('actual v2 create and retained legacy create accept owner requests and generate visits', async () => {
  for (const name of ['createFirstRecurringServiceStop2', 'createFirstRecurringServiceStop']) {
    fixture();
    const result = await general[name].run(request({ recurringServiceStop: { ...rss, id: 'new-rss' } }, 'owner'));
    assert.equal(result.status, 200);
    assert.equal([...memory.records].filter(([path, value]) => path.startsWith(c + '/serviceStops/') && value.recurringServiceStopId === 'new-rss').length, 5);
    assert.equal(memory.records.get(c + '/recurringServiceStop/new-rss').tech, 'Tech');
  }
});
test('actual v2 edit accepts nested iOS-compatible data without allowing pay injection', async () => {
  fixture();
  const req = request({ recurringServiceStop: { ...rss, payrollAgreement: { fixedAmountCents: 999999 } }, syncRoute: false }, 'owner');
  req.data = { data: req.data };
  const result = await general.updateRecurringServiceStop.run(req);
  assert.equal(result.success, true);
  assert.equal(memory.records.get(c + '/recurringServiceStop/rss').payrollAgreement, undefined);
});
test('actual rolling worker keeps the biweekly anchor and a repeat dispatch adds no visits', async () => {
  fixture();
  const last = new Date(); last.setHours(12, 0, 0, 0);
  last.setDate(last.getDate() - (last.getDay() + 6) % 7 - 14);
  const start = new Date(last); start.setDate(start.getDate() - 28);
  memory.set(c + '/recurringServiceStop/rss', { ...rss, startDate: start, lastCreated: last, frequency: 'Bi-Weekly' });
  memory.set(c + '/recurringServiceStop/rss/tasks/routine', { name: 'Checklist', type: 'Basic', contractedRate: 0, payrollMode: 'included' });
  memory.set(c + '/recurringServiceStop/rss/tasks/extra', { name: 'Extra', type: 'Basic', contractedRate: 0, payrollMode: 'custom', manualPayOverrideCents: 1500, payrollStackBehavior: 'stackable', payQuantity: 2 });
  const payload = { data: { companyId: 'company', recurringServiceStopId: 'rss' } };
  await timed.processRecurringServiceStopTask.run(payload);
  const visits = [...memory.records].filter(([path, value]) => path.startsWith(c + '/serviceStops/') && value.recurringServiceStopId === 'rss' && value.serviceDate).map(([, value]) => value).sort((a, b) => a.serviceDate - b.serviceDate);
  assert.ok(visits.length > 0);
  const expected = new Date(last); expected.setDate(expected.getDate() + 14);
  assert.equal(visits[0].serviceDate.getTime(), expected.getTime());
  const count = visits.length;
  const taskCopies = () => [...memory.records].filter(([path]) => path.startsWith(c + '/serviceStops/') && path.includes('/tasks/')).map(([, value]) => value);
  assert.equal(taskCopies().length, count * 2);
  assert.deepEqual([...new Set(taskCopies().map(task => task.name))].sort(), ['Checklist', 'Extra']);
  assert.ok(taskCopies().every(task => task.payrollMode === undefined && task.manualPayOverrideCents === undefined && task.contractedRate === undefined));
  await timed.processRecurringServiceStopTask.run(payload);
  assert.equal([...memory.records].filter(([path, value]) => path.startsWith(c + '/serviceStops/') && value.recurringServiceStopId === 'rss' && value.serviceDate).length, count);
  assert.equal(taskCopies().length, count * 2);
});

// Canonical task-group defaults are shared by initial and later recurring generation.
test('actual recurring creation consumes the historical taskGroup/taskGroup/taskItems default', async () => {
  fixture();
  const group = c + '/settings/taskGroup/taskGroup/com_set_tg_recurring_service_stops';
  memory.set(group, { name: 'Weekly Service' });
  memory.set(group + '/taskItems/brush', { id: 'stale', name: 'Brush', type: 'Clean', contractedRate: 0, estimatedTime: 5 });
  await general.createFirstRecurringServiceStop2.run(request({ recurringServiceStop: { ...rss, id: 'canonical-rss' } }, 'owner'));
  const templates = [...memory.records].filter(([path]) => path.startsWith(c + '/recurringServiceStop/canonical-rss/tasks/'));
  const copies = [...memory.records].filter(([path, task]) => path.startsWith(c + '/serviceStops/') && path.includes('/tasks/') && task.name === 'Brush');
  assert.equal(templates.length, 1); assert.equal(templates[0][1].taskGroupTaskId, 'brush'); assert.equal(copies.length, 5);
});
test('actual recurring creation reads setup-era plural defaults without moving stored data', async () => {
  fixture();
  const group = c + '/settings/taskGroups/taskGroups/com_set_tg_recurring_service_stops';
  memory.set(group + '/taskItems/brush', { name: 'Brush', type: 'Clean', contractedRate: 0, estimatedTime: 5 });
  await general.createFirstRecurringServiceStop2.run(request({ recurringServiceStop: { ...rss, id: 'compat-rss' } }, 'owner'));
  const tasks = [...memory.records].filter(([path]) => path.startsWith(c + '/recurringServiceStop/compat-rss/tasks/'));
  assert.equal(tasks.length, 1); assert.equal(tasks[0][1].taskGroupTaskId, 'brush');
  assert.equal(memory.records.has(c + '/settings/taskGroup/taskGroup/com_set_tg_recurring_service_stops'), false);
});

const { calendarDate, dateKey } = require('./routeState');
const routeZone = 'America/Los_Angeles';
const routeDate = key => calendarDate(key, routeZone);
const routeRecord = (collection, id) => memory.records.get(`${c}/${collection}/${id}`);

function currentWeekFixture(context, opts = {}) {
  context.mock.timers.enable({ apis: ['Date'], now: new Date(opts.now || '2026-11-05T20:00:00Z') });
  fixture();
  memory.set(c, { ownerId: 'owner', timeZone: routeZone });
  memory.set(c + '/companyUsers/other', { userId: 'other', userName: 'Other Tech', status: 'Active' });
  memory.set(c + '/recurringServiceStop/rss', {
    ...rss, day: 'Friday', daysOfWeek: 'Friday', startDate: routeDate(opts.start || '2026-10-02'),
    lastCreated: routeDate('2026-11-13'), tech: 'Tech', frequency: opts.frequency || 'Weekly',
  });
  const stop = (date, fields = {}) => ({
    serviceDate: routeDate(date), techId: 'tech', tech: 'Tech', recurringServiceStopId: 'rss',
    operationStatus: 'Not Finished', ...fields,
  });
  memory.set(c + '/serviceStops/current', stop('2026-11-06', opts.current));
  memory.set(c + '/serviceStops/future', stop('2026-11-13'));
  memory.set(c + '/serviceStops/current/tasks/task', { workerId: 'tech', status: 'Scheduled', contractedRate: 500 });
  memory.set(c + '/activeRoutes/friday', {
    date: routeDate('2026-11-06'), techId: 'tech', serviceStopsIds: ['current'],
    order: [{ serviceStopId: 'current', order: 1 }], totalStops: 1, finishedStops: 0, status: 'Did Not Start',
  });
  memory.set(c + '/recurringRoutes/route', {
    day: 'Friday', techId: 'tech', rssIds: ['rss'], order: [{ recurringServiceStopId: 'rss', order: 1 }],
  });
  return { stop };
}

const routeRequests = {
  permanentMove: ['updateServiceStopDayPermanently', {
    serviceStopList: [{ id: 'current' }], newDay: 'Monday', newTech: { userId: 'other' },
  }],
  assignment: ['updateRecurringServiceStopsRouteAssignment', {
    recurringServiceStopIds: ['rss'], targetDay: 'Monday', targetTechId: 'other',
  }],
  update: ['updateRecurringServiceStop', { recurringServiceStop: {
    id: 'rss', day: 'Monday', daysOfWeek: 'Monday', techId: 'other',
  } }],
};
function routeCall(path, currentWeekReview) {
  const [name, payload] = routeRequests[path];
  return general[name].run(request({ ...payload, ...(currentWeekReview && { currentWeekReview }) }, 'owner'));
}
const routePreview = path => routeCall(path, { action: 'preview' });
const routeCommit = (path, preview, choices, requestId = 'schedule-change') =>
  routeCall(path, { action: 'commit', previewId: preview.previewId, requestId, choices });

for (const path of Object.keys(routeRequests)) {
  test(`${path} requires review and keeps Friday while starting Monday of the immediately following week`, async context => {
    currentWeekFixture(context);
    const before = [...memory.records];
    await assert.rejects(routeCall(path), { code: 'failed-precondition' });
    const preview = await routePreview(path);
    assert.deepEqual([...memory.records], before);
    assert.equal(preview.weekStart, '2026-11-01');
    assert.deepEqual(preview.schedules[0].nextDates, ['2026-11-09', '2026-11-16', '2026-11-23']);
    assert.deepEqual(preview.schedules[0].visits.map(row => row.id), ['current']);
    await assert.rejects(routeCommit(path, preview, []), { code: 'failed-precondition' });
    assert.deepEqual([...memory.records], before);
    const result = await routeCommit(path, preview, [{ stopId: 'current', action: 'keep' }]);
    assert.equal(result.success, true);
    assert.equal(dateKey(routeRecord('serviceStops', 'current').serviceDate, routeZone), '2026-11-06');
    assert.equal(routeRecord('serviceStops', 'current').techId, 'tech');
    assert.deepEqual(routeRecord('activeRoutes', 'friday').serviceStopsIds, ['current']);
    assert.equal(dateKey(routeRecord('serviceStops', 'future').serviceDate, routeZone), '2026-11-09');
    assert.equal(routeRecord('serviceStops', 'future').techId, 'other');
    assert.deepEqual(routeRecord('activeRoutes', 'com_ar_20261109_other').serviceStopsIds, ['future']);
    assert.equal(routeRecord('recurringServiceStop', 'rss').day, 'Monday');
    const again = await routeCommit(path, preview, [{ stopId: 'current', action: 'keep' }]);
    assert.equal(again.alreadyApplied, true);
    assert.equal(routeRecord('serviceStops', 'future').assignmentRevision, 1);
  });
}

test('Move uses the requested day and separate technician, keeping the visit, tasks, and correct route counters', async context => {
  currentWeekFixture(context);
  const preview = await routePreview('permanentMove');
  await assert.rejects(routeCommit('permanentMove', preview, [{ stopId: 'current', action: 'move', dateKey: '2026-11-09', techId: 'other' }]), { code: 'invalid-argument' });
  await routeCommit('permanentMove', preview, [{ stopId: 'current', action: 'move', dateKey: '2026-11-05', techId: 'other' }]);
  const current = routeRecord('serviceStops', 'current');
  assert.equal(dateKey(current.serviceDate, routeZone), '2026-11-05');
  assert.equal(current.recurringServiceStopDateKey, '2026-11-06');
  assert.equal(current.techId, 'other');
  assert.equal(routeRecord('serviceStops', 'current/tasks/task').workerId, 'other');
  assert.equal(routeRecord('serviceStops', 'current/tasks/task').contractedRate, 500);
  assert.equal(routeRecord('activeRoutes', 'friday').totalStops, 0);
  assert.deepEqual(routeRecord('activeRoutes', 'com_ar_20261105_other').serviceStopsIds, ['current']);
});

test('overdue work appears and completed visits do not require a choice or create a replacement', async context => {
  const { stop } = currentWeekFixture(context, { current: { operationStatus: 'Finished' } });
  memory.set(c + '/serviceStops/overdue', stop('2026-11-03'));
  const preview = await routePreview('assignment');
  assert.deepEqual(preview.schedules[0].visits.map(row => [row.id, row.state]), [['current', 'history'], ['overdue', 'open']]);
  await routeCommit('assignment', preview, [{ stopId: 'overdue', action: 'keep' }]);
  assert.equal(routeRecord('serviceStops', 'current').operationStatus, 'Finished');
  assert.equal(dateKey(routeRecord('serviceStops', 'overdue').serviceDate, routeZone), '2026-11-03');
});

test('a stale preview cannot overwrite a concurrent completion, and a closed destination leaves no partial save', async context => {
  currentWeekFixture(context);
  const preview = await routePreview('assignment');
  memory.set(c + '/serviceStops/current', { operationStatus: 'In Progress' }, { merge: true });
  await assert.rejects(routeCommit('assignment', preview, [{ stopId: 'current', action: 'keep' }]), /Refresh the review/i);
  const retry = await routePreview('assignment');
  memory.set(c + '/activeRoutes/closed', { date: routeDate('2026-11-09'), techId: 'other', status: 'Finished', endTime: routeDate('2026-11-09') });
  const before = [...memory.records];
  await assert.rejects(routeCommit('assignment', retry, []), /destination route is closed/i);
  assert.deepEqual([...memory.records], before);
});

test('the rolling worker honors a reviewed biweekly off week and does not recreate past service or reset its tasks', async context => {
  currentWeekFixture(context, { frequency: 'Bi-Weekly', start: '2026-10-02' });
  memory.records.delete(c + '/serviceStops/current');
  memory.records.delete(c + '/serviceStops/current/tasks/task');
  const preview = await routePreview('assignment');
  assert.deepEqual(preview.schedules[0].visits, []);
  assert.deepEqual(preview.schedules[0].nextDates, ['2026-11-09', '2026-11-23', '2026-12-07']);
  await routeCommit('assignment', preview, []);
  const payload = { data: { companyId: 'company', recurringServiceStopId: 'rss' } };
  await timed.processRecurringServiceStopTask.run(payload);
  await timed.processRecurringServiceStopTask.run(payload);
  const dates = [...memory.records].filter(([path, stop]) => path.startsWith(c + '/serviceStops/') && stop.recurringServiceStopId === 'rss')
    .map(([, stop]) => dateKey(stop.serviceDate, routeZone)).sort();
  assert.deepEqual(dates, ['2026-11-09', '2026-11-23']);
});

test('a missing expected visit blocks a route change instead of pretending there is no visit due', async context => {
  currentWeekFixture(context);
  memory.records.delete(c + '/serviceStops/current');
  const preview = await routePreview('assignment');
  assert.match(preview.schedules[0].conflict, /missing/i);
  await assert.rejects(routeCommit('assignment', preview, []), /resolve the missing or duplicate visit/i);
  assert.equal(routeRecord('recurringServiceStop', 'rss').day, 'Friday');
});

test('an in-flight generator using the old schedule cannot create a stale visit or advance the new cursor', async context => {
  currentWeekFixture(context);
  memory.records.delete(c + '/serviceStops/future');
  memory.set(c + '/recurringServiceStop/rss', {
    lastCreated: routeDate('2026-11-06'), routeScheduleRevision: 1,
    type: 'Weekly Service', typeId: 'weekly', typeImage: 'figure.pool.swim', category: 'Route',
  }, { merge: true });
  memory.beforeCommit = () => memory.set(c + '/recurringServiceStop/rss', {
    routeScheduleRevision: 2, day: 'Monday',
    routeScheduleAnchorDateKey: '2026-11-09', routeScheduleEffectiveDateKey: '2026-11-08',
    routeScheduleTimeZone: routeZone, lastCreated: null,
  }, { merge: true });
  const payload = { data: { companyId: 'company', recurringServiceStopId: 'rss' } };
  await timed.processRecurringServiceStopTask.run(payload);
  assert.equal(routeRecord('recurringServiceStop', 'rss').lastCreated, null);
  assert.equal([...memory.records.values()].filter(stop => stop.recurringServiceStopId === 'rss').length, 1);
  await timed.processRecurringServiceStopTask.run(payload);
  const dates = [...memory.records.values()].filter(stop => stop.recurringServiceStopId === 'rss').map(stop => dateKey(stop.serviceDate, routeZone)).sort();
  assert.deepEqual(dates, ['2026-11-06', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
});
