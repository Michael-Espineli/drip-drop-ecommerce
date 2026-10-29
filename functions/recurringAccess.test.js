const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRecurringAccess } = require('./recurringAccess');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');

const c = 'companies/company';
const template = { id: 'rss', customerId: 'customer', customerName: 'Untrusted label', serviceLocationId: 'site',
  techId: 'tech', tech: 'Untrusted worker', frequency: 'Weekly', day: 'Monday', noEndDate: true,
  typeId: 'system_recurring_service_stop', startDate: new Date('2026-11-02'), dateCreated: new Date('2026-10-27') };
function fixture(extra = {}, options = {}) {
  const db = new MemoryFirestore({
    [c]: { ownerId: 'owner' },
    'users/editor/userAccess/company': { roleId: 'operations', roleName: 'Operations' },
    'users/tech/userAccess/company': { roleId: 'technician' },
    [c + '/roles/operations']: { permissionIdList: ['242', '244', '246', '234', '236'] },
    [c + '/roles/technician']: { permissionIdList: ['240'] },
    [c + '/companyUsers/employee-doc']: { userId: 'tech', userName: 'Alex', status: 'Active' },
    [c + '/customers/customer']: { firstName: 'Test', lastName: 'Customer' },
    [c + '/serviceLocations/site']: { customerId: 'customer', address: { streetAddress: 'Test Street' } },
    [c + '/recurringServiceStop/rss']: { ...template, lastCreated: new Date('2026-11-30') },
    [c + '/serviceStops/stop']: { techId: 'tech', recurringServiceStopId: 'rss', customerId: 'customer', serviceLocationId: 'site' },
    [c + '/recurringRoutes/route']: { techId: 'tech', day: 'Monday' },
    'salesAgreements/agreement': { companyId: 'company', customerId: 'customer', serviceLocationIds: ['site'] },
    'salesBillingSubscriptions/subscription': { companyId: 'company', customerId: 'customer', agreementId: 'agreement' },
    ...extra,
  });
  let invocations = 0;
  const access = createRecurringAccess(db, options);
  const call = (action, payload, uid = 'editor', handler = async (clean, context) => { invocations++; return { clean, context }; }) =>
    access.wrap(action, handler)({ data: { companyId: 'company', ...payload }, auth: uid ? { uid, token: {} } : undefined, rawRequest: {} });
  return { db, access, call, invocations: () => invocations };
}
const invalid = (promise, code = 'permission-denied') => assert.rejects(promise, { code });
const payloads = {
  create: { recurringServiceStop: template }, update: { recurringServiceStop: template },
  delete: { stopId: 'rss' }, end: { stopId: 'rss', endDate: new Date() },
  routeOrder: { routeId: 'route', recurringRouteOrder: [{ recurringServiceStopId: 'rss', order: 1 }], serviceStopOrders: [{ recurringServiceStopId: 'rss', serviceStopId: 'stop', order: 1 }] },
  routeDelete: { routeId: 'route' }, routeAssignment: { recurringServiceStopIds: ['rss'], targetTechId: 'tech', targetDay: 'Monday' },
  permanentMove: { serviceStopList: [{ id: 'stop' }], newTech: { userId: 'tech' }, newDay: 'Tuesday' },
  report: { serviceStopId: 'stop' },
};
test('every recurring action rejects anonymous, foreign-company, and revoked callers before invoking mutations', async () => {
  for (const [action, payload] of Object.entries(payloads)) {
    const f = fixture({ 'users/revoked/userAccess/company': { roleId: 'operations', status: 'Revoked' } });
    await invalid(f.call(action, payload, null), 'unauthenticated');
    await invalid(f.call(action, payload, 'outsider'));
    await invalid(f.call(action, payload, 'revoked'));
    assert.equal(f.invocations(), 0);
  }
});
test('permissions are explicit, missing role definitions fail closed, and route deletion needs both permissions', async () => {
  for (const action of Object.keys(payloads).filter((value) => value !== 'report')) {
    const f = fixture({ [c + '/roles/operations']: { permissionIdList: ['240'] } });
    await invalid(f.call(action, payloads[action]));
    f.db.records.delete(c + '/roles/operations');
    await invalid(f.call(action, payloads[action]));
    assert.equal(f.invocations(), 0);
  }
  const f = fixture({ [c + '/roles/operations']: { permissionIdList: ['236'] } });
  await invalid(f.call('routeDelete', payloads.routeDelete));
});
test('owners without a userAccess document and authorized operators can use all operational actions', async () => {
  for (const [action, payload] of Object.entries(payloads)) {
    for (const uid of ['owner', 'editor']) {
      const f = fixture();
      const result = await f.call(action, payload, uid);
      assert.equal(result.clean.companyId, 'company'); assert.equal(f.invocations(), 1);
    }
  }
});
test('legacy nested payloads use verified context and never trust client-provided uid/role', async () => {
  const f = fixture();
  const handler = f.access.wrap('delete', async (clean, context) => ({ clean, context }));
  const payload = { data: { companyId: 'company', stopId: 'rss', auth: { uid: 'owner' } } };
  await invalid(handler(payload, {}), 'unauthenticated');
  const result = await handler(payload, { auth: { uid: 'editor' } });
  assert.equal(result.context.auth.uid, 'editor'); assert.equal(result.clean.stopId, 'rss');
});
test('legacy token fallback verifies tokens instead of accepting auth payloads', async () => {
  const tokens = [];
  const f = fixture({}, { verifyIdToken: async (token) => { tokens.push(token); if (token !== 'valid') throw Error('invalid'); return { uid: 'editor' }; } });
  const handler = f.access.wrap('delete', async (clean) => clean);
  await invalid(handler({ companyId: 'company', stopId: 'rss', auth: { uid: 'owner' }, idToken: 'forged' }, {}), 'unauthenticated');
  assert.equal((await handler({ companyId: 'company', stopId: 'rss', idToken: 'valid' }, {})).stopId, 'rss');
  assert.deepEqual(tokens, ['forged', 'valid']);
});
test('template writes discard execution/pay fields and preserve the server cursor on edits', async () => {
  const f = fixture();
  const result = await f.call('update', { recurringServiceStop: { ...template, completionWorkStatus: 'completed',
    payrollAgreement: { fixedAmountCents: 999999 }, manualPayOverrideCents: 999999, status: 'Finished', arbitrary: true,
    lastCreated: new Date('2099-01-01'), salesAgreementId: 'agreement', salesBillingSubscriptionId: 'subscription' } });
  const saved = result.clean.recurringServiceStop;
  for (const field of ['payrollAgreement', 'completionWorkStatus', 'manualPayOverrideCents', 'arbitrary', 'status']) assert.equal(saved[field], undefined);
  assert.equal(saved.lastCreated.toISOString(), '2026-11-30T00:00:00.000Z');
  assert.equal(saved.tech, 'Alex'); assert.equal(saved.customerName, 'Test Customer');
  assert.deepEqual(saved.address, { streetAddress: 'Test Street' });
});
test('foreign/mismatched customers, locations, technicians, agreements, and subscriptions cannot be attached', async () => {
  const attempts = [
    { customerId: 'foreign' }, { serviceLocationId: 'foreign' }, { techId: 'foreign' },
    { salesAgreementId: 'foreign' }, { salesBillingSubscriptionId: 'foreign' },
    { salesAgreementId: 'wrong-customer' }, { serviceLocationId: 'wrong-customer' },
    { salesAgreementId: 'agreement', salesBillingSubscriptionId: 'wrong-agreement' },
  ];
  for (const patch of attempts) {
    const f = fixture({ 'salesAgreements/foreign': { companyId: 'other' },
      'salesAgreements/wrong-customer': { companyId: 'company', customerId: 'different' },
      [c + '/serviceLocations/wrong-customer']: { customerId: 'different' },
      'salesBillingSubscriptions/foreign': { companyId: 'other' },
      'salesBillingSubscriptions/wrong-agreement': { companyId: 'company', customerId: 'customer', agreementId: 'other' },
    });
    await assert.rejects(f.call('create', { recurringServiceStop: { ...template, ...patch } }));
    assert.equal(f.invocations(), 0);
  }
});
test('inactive workers and document path injection fail before invoking the handler', async () => {
  const f = fixture({ [c + '/companyUsers/employee-doc']: { userId: 'tech', status: 'Past' } });
  await invalid(f.call('create', payloads.create), 'failed-precondition');
  await invalid(f.call('delete', { stopId: '../other' }), 'invalid-argument');
  await invalid(f.call('delete', { companyId: 'company/other', stopId: 'rss' }), 'invalid-argument');
  assert.equal(f.invocations(), 0);
});
test('clearing a corrupt saved Sales link cannot bypass ownership checks through the edit fallback', async () => {
  const f = fixture({ [c + '/recurringServiceStop/rss']: { ...template, salesAgreementId: 'foreign' },
    'salesAgreements/foreign': { companyId: 'different', customerId: 'customer' } });
  await invalid(f.call('update', { recurringServiceStop: { ...template, salesAgreementId: '' } }));
  assert.equal(f.invocations(), 0);
});
test('create-only permission cannot be used to overwrite an existing recurring template', async () => {
  const f = fixture({ [c + '/roles/operations']: { permissionIdList: ['242'] } });
  await f.call('create', { recurringServiceStop: { ...template, id: 'new-rss' } });
  await invalid(f.call('create', { recurringServiceStop: { ...template, description: 'Forged update' } }));
  assert.equal(f.invocations(), 1);
});
test('assigned technicians may send their own report but cannot send another technician report', async () => {
  const f = fixture({ [c + '/serviceStops/other-stop']: { techId: 'different' } });
  await f.call('report', { serviceStopId: 'stop' }, 'tech');
  await invalid(f.call('report', { serviceStopId: 'other-stop' }, 'tech'));
  assert.equal(f.invocations(), 1);
});
test('route assignment/order ignore forged labels and validate destination and referenced stops', async () => {
  const f = fixture();
  const result = await f.call('routeOrder', { ...payloads.routeOrder,
    recurringRouteOrder: [{ recurringServiceStopId: 'rss', customerId: 'forged', customerName: 'Forged', order: 1 }] });
  assert.equal(result.clean.recurringRouteOrder[0].customerId, 'customer');
  await invalid(f.call('routeAssignment', { ...payloads.routeAssignment, destinationRouteId: 'foreign-route' }), 'failed-precondition');
  await invalid(f.call('routeOrder', { ...payloads.routeOrder, serviceStopOrders: [{ recurringServiceStopId: 'foreign' }] }), 'failed-precondition');
});
test('external service locations require accepted scoped contracts and report reads enforce that relationship', async () => {
  const records = {
    'companies/source/customers/customer': { firstName: 'External', lastName: 'Customer' },
    'companies/source/serviceLocations/site': { customerId: 'customer', address: {} },
    'recurringLaborContracts/contract': { senderId: 'source', receiverId: 'company', senderAcceptance: true, receiverAcceptance: true, isActive: true },
    'recurringLaborContracts/contract/recurringWork/work': { customerId: 'customer', serviceLocationId: 'site' },
  };
  const rss = { ...template, mainCompanyId: 'source', otherCompany: true, laborContractId: 'contract' };
  const f = fixture(records);
  assert.equal((await f.call('create', { recurringServiceStop: rss })).clean.recurringServiceStop.mainCompanyId, 'source');
  f.db.records.delete('recurringLaborContracts/contract/recurringWork/work');
  await invalid(f.call('create', { recurringServiceStop: rss }));
  f.db.set(c + '/serviceStops/stop', rss);
  await invalid(f.call('report', { serviceStopId: 'stop' }));
  assert.equal(f.invocations(), 1);
});
