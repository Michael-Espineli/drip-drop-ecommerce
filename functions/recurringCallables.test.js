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
  assert.ok(taskCopies().filter(task => task.name === 'Checklist').every(task => task.payrollMode === 'included'));
  assert.ok(taskCopies().filter(task => task.name === 'Extra').every(task => task.payrollMode === 'custom' && task.manualPayOverrideCents === 1500 && task.payrollStackBehavior === 'stackable' && task.payQuantity === 2));
  await timed.processRecurringServiceStopTask.run(payload);
  assert.equal([...memory.records].filter(([path, value]) => path.startsWith(c + '/serviceStops/') && value.recurringServiceStopId === 'rss' && value.serviceDate).length, count);
  assert.equal(taskCopies().length, count * 2);
});
