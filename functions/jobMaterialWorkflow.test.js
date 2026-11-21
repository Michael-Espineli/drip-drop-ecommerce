const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');
const { createJobStopMaterials, createJobPurchaseReconciliation } = require('./jobStopMaterials');
const { createPartApprovalRejection } = require('./partApprovalRejection');
const { createPartApprovalBilling } = require('./partApprovalBilling');
const { createJobBilling } = require('./jobBilling');

const company = 'companies/co';
const job = `${company}/workOrders/job`;
const stop = `${company}/serviceStops/stop`;
const shopping = `${company}/shoppingList/`;
const purchases = `${company}/purchasedItems/`;
const approval = 'customerPartApprovals/approval';
const estimate = 'salesAgreements/estimate';
const companyId = 'co';
const owner = { uid: 'owner' };
const tech = { uid: 'tech' };

function fixture(extra = {}) {
  const db = new MemoryFirestore({
    [company]: { ownerId: 'owner', customerBillingEnabled: true },
    [`${company}/customers/customer`]: { email: 'customer@example.test' },
    [job]: { customerId: 'customer', rate: 2000, internalId: 'JOB-1' },
    [stop]: { jobId: 'job', customerId: 'customer', techId: 'tech', internalId: 'STOP-1' },
    'users/tech/userAccess/co': { active: true },
    'users/other/userAccess/co': { active: true },
    [estimate]: {
      companyId, customerId: 'customer', jobId: 'job', status: 'accepted', totalAmountCents: 2000,
      lineItems: [{ id: 'labor', name: 'Labor', type: 'service', quantity: 1, unitAmountCents: 2000, totalAmountCents: 2000 }],
    },
    ...extra,
  });
  return {
    db,
    read: path => db.records.get(path),
    record: (data, auth = tech) => createJobStopMaterials(db)({ auth, data: { companyId, serviceStopId: 'stop', ...data } }),
    match: (shoppingItemId, purchasedItemId, auth = owner) => createJobPurchaseReconciliation(db)({
      auth, data: { companyId, shoppingItemId, purchasedItemId },
    }),
  };
}

test('the assigned tech installs a purchased part without inventing a purchase date', async () => {
  const path = shopping + 'planned';
  const f = fixture({ [path]: { jobId: 'job', status: 'Need to Purchase', quantity: '2' } });
  const action = { action: 'install', shoppingItemId: 'planned' };
  await assert.rejects(f.record(action), { code: 'failed-precondition' });
  f.db.set(path, { status: 'Purchased' }, { merge: true });
  await assert.rejects(f.record(action, { uid: 'other' }), { code: 'permission-denied' });
  await f.record(action);
  const saved = f.read(path);
  assert.equal(saved.status, 'Installed');
  assert.equal(saved.installedQuantity, 2);
  assert.equal(saved.installedByUserId, 'tech');
  assert.equal(saved.datePurchased, undefined);
  await f.record(action);
  assert.deepEqual(f.read(path), saved);
});

test('extra usage is idempotent and a late receipt match assigns one cost while preserving installation', async () => {
  const f = fixture({ [purchases + 'receipt-line']: { name: 'Seal', price: 900, quantityString: '1' } });
  const action = { action: 'useExtra', requestId: 'one', name: 'Seal', quantity: 1 };
  const [a, b] = await Promise.all([f.record(action), f.record(action)]);
  assert.equal(a.id, b.id);
  await f.match(a.id, 'receipt-line');
  const row = f.read(shopping + a.id);
  assert.equal(row.status, 'Installed');
  assert.equal(row.materialUsageOnly, true);
  assert.equal(row.needsAction, false);
  assert.equal(f.read(purchases + 'receipt-line').jobId, 'job');
  assert.equal(f.read(purchases + 'receipt-line').jobBillable, false);
  assert.equal(f.read(purchases + 'receipt-line').price, 900);
  assert.equal(f.read(estimate).totalAmountCents, 2000);
  const invoice = await createJobBilling(f.db).create({ auth: owner, data: { companyId, jobId: 'job', agreementId: 'estimate' } });
  assert.equal(invoice.totalAmountCents, 2000);
  await createPartApprovalBilling(f.db).syncInvoice(invoice.id);
  assert.equal(f.read(shopping + a.id).invoiced, false);
  assert.equal(f.read(purchases + 'receipt-line').invoiced, undefined);
});

test('job billing blocks an approved addition until the accepted estimate covers its exact line', async () => {
  const f = fixture({
    [approval]: { companyId, jobId: 'job', customerId: 'customer', status: 'approved', shoppingListItemId: 'approved-part', plannedTotalPriceCents: 800 },
    [shopping + 'approved-part']: { jobId: 'job', customerId: 'customer', partApprovalRequestId: 'approval', status: 'Need to Purchase' },
    [shopping + 'other-material']: { jobId: 'job', status: 'Purchased' },
  });
  const create = () => createJobBilling(f.db).create({ auth: owner, data: { companyId, jobId: 'job', agreementId: 'estimate' } });
  await assert.rejects(create(), { code: 'failed-precondition', message: /Review approved add-ons/ });
  f.db.set(estimate, { totalAmountCents: 2800, lineItems: [...f.read(estimate).lineItems, {
    id: 'approved-part', name: 'Approved part', type: 'material', quantity: 1, unitAmountCents: 800, totalAmountCents: 800,
  }] }, { merge: true });
  const invoice = await create();
  await createPartApprovalBilling(f.db).syncInvoice(invoice.id);
  assert.equal(f.read(approval).billingAutomationStatus, 'includedOnJobInvoice');
  assert.equal(f.read(shopping + 'approved-part').status, 'Need to Purchase');
  assert.equal(f.read(shopping + 'approved-part').invoiced, true);
  assert.equal(f.read(shopping + 'other-material').invoiced, undefined);
});

test('company billing off overrides auto-send and offline cash preserves the physical status', async () => {
  const path = shopping + 'standalone';
  const f = fixture({
    [`${company}/settings/companyWide`]: { customerBillingEnabled: false, partApprovalAutoSendInvoices: true },
    [path]: { customerId: 'customer', status: 'Installed', autoInvoiceOnInstall: true, price: 900, quantity: '1' },
  });
  const service = createPartApprovalBilling(f.db);
  assert.equal((await service.ensure({ companyId, shoppingItemId: 'standalone' })).reason, 'billing_disabled');
  const input = { companyId, shoppingItemId: 'standalone', action: 'cashReceived', amountCents: 900, auth: owner };
  assert.equal((await service.recordOffline(input)).status, 'cashReceived');
  assert.equal((await service.recordOffline(input)).status, 'cashReceived');
  assert.equal(f.read(path).offlineCashAmountCents, 900);
  assert.equal(f.read(path).status, 'Installed');
  assert.equal((await service.ensure({ companyId, shoppingItemId: 'standalone' })).status, 'skipped');
  assert.equal([...f.db.records.keys()].filter(key => key.startsWith('salesInvoices/')).length, 0);
});

test('staff rejection protects the shopping item once purchasing has started', async () => {
  const item = shopping + 'approved-part';
  const f = fixture({
    [approval]: { companyId, status: 'approved', shoppingListItemId: 'approved-part' },
    [item]: { status: 'Need to Purchase', partApprovalRequestId: 'approval', datePurchased: new Date() },
  });
  const reject = createPartApprovalRejection(f.db, { append: event => [event] });
  const request = { auth: owner, data: { companyId, approvalId: 'approval' } };
  await assert.rejects(reject(request), { code: 'failed-precondition' });
  assert.equal(f.read(approval).status, 'approved');
  assert.ok(f.read(item));
  f.db.set(item, { datePurchased: null }, { merge: true });
  await reject(request);
  assert.equal(f.read(approval).status, 'rejected');
  assert.equal(f.read(item), undefined);
});

test('switching to external billing closes an unsent draft and cancels its email without touching fulfillment', async () => {
  const path = shopping + 'standalone';
  const f = fixture({
    [`${company}/settings/companyWide`]: { partApprovalAutoSendInvoices: true },
    [path]: { customerId: 'customer', status: 'Installed', autoInvoiceOnInstall: true, price: 900, quantity: '1' },
  });
  let sends = 0;
  const service = createPartApprovalBilling(f.db, { sendInvoice: async () => { sends++; } });
  const draft = await service.ensure({ companyId, shoppingItemId: 'standalone' });
  f.db.set(`${company}/settings/companyWide`, { customerBillingEnabled: false }, { merge: true });
  await service.processEmail(draft.queueId);
  assert.equal(sends, 0);
  await service.recordOffline({ companyId, shoppingItemId: 'standalone', action: 'externalInvoice', reference: 'EXT-42', auth: owner });
  await service.syncInvoice(draft.invoiceId);
  assert.equal(f.read(path).externalInvoiceReference, 'EXT-42');
  assert.equal(f.read(path).status, 'Installed');
  assert.equal(f.read(path).invoiceId, '');
  assert.equal(f.read(`salesInvoices/${draft.invoiceId}`).status, 'void');
});

test('an oversized receipt line must be split before it can be charged to the job', async () => {
  const f = fixture({ [purchases + 'bulk']: { name: 'Seal', price: 900, quantityString: '5' } });
  const item = await f.record({ action: 'useExtra', requestId: 'small', name: 'Seal', quantity: 1 });
  await assert.rejects(f.match(item.id, 'bulk'), { code: 'failed-precondition', message: /Split the purchase line/ });
  assert.equal(f.read(purchases + 'bulk').jobId, undefined);
  assert.equal(f.read(shopping + item.id).purchasedItem, undefined);
});
