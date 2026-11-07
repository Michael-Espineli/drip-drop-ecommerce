const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryFirestore } = require('./testSupport/MemoryFirestore');
const { createSalesAgreementNotifications } = require('./salesAgreementNotifications');

const path = 'salesAgreements/agreement';
const companyAlertPath = 'companies/company/alerts/sales_agreement_accepted_agreement';
const personalPath = user => `users/${user}/alerts/sales_agreement_accepted_agreement_${user}`;
const accepted = {
  companyId: 'company', companyName: 'Pool Company', customerId: 'customer',
  customerUserId: 'home', customerName: 'Home Owner', acceptedByUserId: 'home',
  status: 'accepted', acceptedSource: 'customerPortal', title: 'Weekly pool care',
  customerBillingPreference: 'invoice', operationsSetupStatus: 'needsRecurringServiceStop',
};
function fixture(agreement = {}, records = {}) {
  const db = new MemoryFirestore({
    'companies/company': { ownerId: 'owner' },
    'companies/company/companyUsers/manager-doc': { userId: 'manager', roleName: 'Manager', status: 'Active' },
    'companies/company/companyUsers/tech-doc': { userId: 'tech', roleName: 'Tech', status: 'Active' },
    [path]: { ...accepted, ...agreement }, ...records,
  });
  const worker = createSalesAgreementNotifications(db);
  const event = () => ({ before: { exists: true, data: () => ({ status: 'sent' }) }, after: db.snapshot(path, db.records) });
  return { db, worker, event, run: () => worker.onAgreementWritten(event(), { params: { agreementId: 'agreement' } }) };
}

for (const source of ['customerPortal', 'emailLink']) {
  test(`${source} acceptance creates company/operations/owner alerts linked to the agreement`, async () => {
    const f = fixture({ acceptedSource: source });
    await f.run();
    const alert = f.db.records.get(companyAlertPath);
    assert.equal(alert.title, 'Service Agreement accepted');
    assert.equal(alert.status, 'unread');
    assert.equal(alert.route, '/company/sales/agreements/agreement');
    assert.match(alert.message, /Home Owner accepted Weekly pool care/);
    assert.match(alert.message, /Billing choice: Invoice/);
    assert.equal(alert.relatedEntity.id, 'agreement');
    for (const user of ['manager', 'owner']) assert.equal(f.db.records.get(personalPath(user)).recipientUserId, user);
    assert.equal(f.db.records.has(personalPath('tech')), false);
    assert.ok(f.db.records.get(path).companyAcceptanceAlertCreatedAt);
  });
}

test('an already accepted record with a missing marker recovers on a later update', async () => {
  const f = fixture();
  const event = f.event();
  event.before = event.after;
  await f.worker.onAgreementWritten(event, { params: { agreementId: 'agreement' } });
  assert.ok(f.db.records.has(companyAlertPath));
});

test('legacy customer attribution works without a source but explicit company acceptance does not notify', async () => {
  const f = fixture({ acceptedSource: '' });
  await f.run();
  assert.ok(f.db.records.has(companyAlertPath));
  for (const agreement of [
    { acceptedSource: '', acceptedByUserId: 'owner' },
    { acceptedSource: 'internalManual' }, { acceptedSource: 'customerOffline' },
    { status: 'sent' }, { status: 'rejected' }, { status: 'canceled' },
  ]) {
    const skipped = fixture(agreement);
    await skipped.run();
    assert.equal(skipped.db.records.has(companyAlertPath), false);
  }
});

test('a stale accepted event cannot alert after the current agreement has been canceled', async () => {
  const f = fixture(), event = f.event();
  f.db.set(path, { status: 'canceled' }, { merge: true });
  await f.worker.onAgreementWritten(event, { params: { agreementId: 'agreement' } });
  assert.equal(f.db.records.has(companyAlertPath), false);
});

test('missing/deleted agreements are ignored', async () => {
  const f = fixture(), event = f.event();
  f.db.records.delete(path);
  await f.worker.onAgreementWritten(event, { params: { agreementId: 'agreement' } });
  await f.run();
  assert.equal(f.db.records.has(companyAlertPath), false);
});

test('duplicate and concurrent events preserve read/archived notifications and original timestamps', async () => {
  const f = fixture();
  await Promise.all([f.run(), f.run()]);
  const createdAt = f.db.records.get(companyAlertPath).createdAt;
  f.db.set(companyAlertPath, { status: 'read', read: true }, { merge: true });
  f.db.set(personalPath('owner'), { status: 'archived', read: true }, { merge: true });
  f.db.set(path, { companyAcceptanceAlertCreatedAt: null }, { merge: true });
  await f.run();
  assert.equal(f.db.records.get(companyAlertPath).status, 'read');
  assert.equal(f.db.records.get(companyAlertPath).createdAt, createdAt);
  assert.equal(f.db.records.get(personalPath('owner')).status, 'archived');
  assert.equal([...f.db.records.keys()].filter(p => p.includes('/alerts/')).length, 3);
});

test('failed fan-out leaves the marker unset and a retry fills only missing destinations', async () => {
  const f = fixture(), original = f.db.runTransaction.bind(f.db);
  let calls = 0;
  f.db.runTransaction = async callback => {
    calls += 1;
    if (calls === 2) throw Error('temporary outage');
    return original(callback);
  };
  await assert.rejects(f.run(), /temporary outage/);
  assert.ok(f.db.records.has(companyAlertPath));
  assert.equal(f.db.records.get(path).companyAcceptanceAlertCreatedAt, undefined);
  f.db.set(companyAlertPath, { status: 'read', read: true }, { merge: true });
  await f.run();
  assert.equal(f.db.records.get(companyAlertPath).status, 'read');
  assert.ok(f.db.records.has(personalPath('owner')));
  assert.ok(f.db.records.get(path).companyAcceptanceAlertCreatedAt);
});

test('active recipient selection deduplicates users and excludes conflicting inactive flags', async () => {
  const f = fixture({}, {
    'companies/company/companyUsers/another-manager': { userId: 'manager', roleName: 'Manager' },
    'companies/company/companyUsers/revoked': { userId: 'revoked', roleName: 'Manager', status: 'Active', userStatus: 'Revoked' },
    'companies/company/companyUsers/inactive': { userId: 'inactive', roleName: 'Office', active: false },
  });
  await f.run();
  assert.equal([...f.db.records.keys()].filter(p => p.includes('/alerts/')).length, 3);
  assert.equal(f.db.records.has(personalPath('revoked')), false);
  assert.equal(f.db.records.has(personalPath('inactive')), false);
});

test('companies with no users still receive a company alert and owner copy', async () => {
  const f = fixture();
  f.db.records.delete('companies/company/companyUsers/manager-doc');
  f.db.records.delete('companies/company/companyUsers/tech-doc');
  await f.run();
  assert.ok(f.db.records.has(companyAlertPath));
  assert.ok(f.db.records.has(personalPath('owner')));
});

test('an owner already in companyUsers receives only one personal copy', async () => {
  const f = fixture({}, { 'companies/company/companyUsers/owner-doc': { userId: 'owner', roleName: 'Owner' } });
  await f.run();
  assert.equal([...f.db.records.keys()].filter(p => p.startsWith('users/owner/alerts/')).length, 1);
});

test('one-time estimates retain acceptance alerts without recurring-setup notifications', async () => {
  const f = fixture({ sourceType: 'oneOffJob', recurringServiceStopId: 'stop' });
  await f.run();
  assert.equal(f.db.records.get(companyAlertPath).title, 'Estimate accepted');
  assert.equal(f.db.records.has('users/home/alerts/sales_agreement_service_setup_agreement'), false);
});

test('the existing customer setup notification remains linked and is safe on retry', async () => {
  const f = fixture({ recurringServiceStopId: 'stop', recurringRouteId: 'route' });
  await f.run();
  const alertPath = 'users/home/alerts/sales_agreement_service_setup_agreement';
  assert.equal(f.db.records.get(alertPath).route, '/client/service-agreements/agreement');
  f.db.set(alertPath, { status: 'read', read: true }, { merge: true });
  f.db.set(path, { recurringServiceSetupCustomerNotifiedAt: null }, { merge: true });
  await f.run();
  assert.equal(f.db.records.get(alertPath).status, 'read');
});

test('the shared company writer retains arbitrary repair payloads and returns unique recipient IDs', async () => {
  const f = fixture();
  const result = await f.worker.writeCompanyWorkflowAlert({ companyId: 'company', alertId: 'repair', payload: { source: 'repairRequests', route: '/company/repair-requests/detail/repair', status: 'unread' } });
  assert.deepEqual(result, ['manager', 'owner']);
  assert.equal(f.db.records.get('companies/company/alerts/repair').source, 'repairRequests');
});
