const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { prepareJobPlanWorkspace, reconcileJobPlanScope } = require('./jobPlanWorkspace');

// In-memory transactions stage writes, reject reads after writes, and retry when
// another writer changes records. No credentials, network, or real projects are used.
class MemoryFirestore {
  constructor(records) { this.records = new Map(Object.entries(records)); this.version = 0; }
  doc(path) {
    return { path, id: path.split('/').pop(), collection: (name) => this.collection(`${path}/${name}`), get: async () => this.read({ path, document: true }),
      set: async (data, options) => this.set(path, data, options), document: true };
  }
  collection(path) {
    const query = (constraints = []) => ({ path, constraints, doc: (name) => this.doc(`${path}/${name}`),
      where: (field, operator, value) => query([...constraints, [field, value]]), get: async () => this.read({ path, constraints }) });
    return query();
  }
  read(ref, records = this.records) {
    if (ref.document) {
      const data = records.get(ref.path);
      return { exists: records.has(ref.path), id: ref.id || ref.path.split('/').pop(), ref: this.doc(ref.path), data: () => data };
    }
    const docs = [...records].filter(([path, data]) => path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes('/') && (ref.constraints || []).every(([field, value]) => data[field] === value))
      .map(([path]) => this.read(this.doc(path), records));
    return { docs, size: docs.length, empty: !docs.length };
  }
  set(path, data, options) {
    this.records.set(path, options?.merge ? { ...this.records.get(path), ...data } : { ...data }); this.version += 1;
  }
  async runTransaction(callback) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const version = this.version, records = new Map(this.records), writes = [];
      const transaction = {
        get: async (ref) => { assert.equal(writes.length, 0, 'transaction reads must precede writes'); return this.read(ref, records); },
        set: (ref, data, options) => writes.push({ ref, data, options }), delete: (ref) => writes.push({ ref, remove: true }),
      };
      const result = await callback(transaction);
      if (this.beforeCommit) { const hook = this.beforeCommit; this.beforeCommit = null; hook(); }
      if (version !== this.version) continue;
      if (this.commitError) throw this.commitError;
      writes.forEach(({ ref, data, options, remove }) => remove ? this.records.delete(ref.path) : this.set(ref.path, data, options));
      return result;
    }
    throw new Error('Transaction retry limit');
  }
}

const jobPath = 'companies/company-1/workOrders/job-1';
const planPath = `${jobPath}/plans/plan-B`;
const empty = () => ({ tasks: [], plannedServiceStops: [], shoppingItems: [], laborLineItems: [] });
let db;
let sequence;
const planB = () => ({
  id: 'plan-B', title: 'Plan B', status: 'Draft', planTier: 2, totalAmountCents: 20000, laborCostCents: 0,
  tasks: [{ id: 'task-B', name: 'B task', status: 'Draft' }], plannedServiceStops: [], shoppingItems: [],
  laborLineItems: [{ id: 'line-B', name: 'B service', quantity: 1, totalPriceCents: 20000, internalCostCents: 0, taskIds: ['task-B'] }],
  lineItems: [{ id: 'line-B', name: 'B service', totalAmountCents: 20000 }],
});
const applyPlan = (options = {}) => db.runTransaction(async (transaction) => {
  const prepared = await prepareJobPlanWorkspace({ db, transaction, companyId: 'company-1', jobId: 'job-1', planId: 'plan-B', timestamp: 'now',
    actorUserId: 'owner-1', actorUserName: 'Owner', newId: (prefix) => `${prefix}_${++sequence}`, ...options });
  prepared.apply();
  return prepared;
});

beforeEach(() => {
  sequence = 0;
  db = new MemoryFirestore({
    'companies/company-1': { ownerId: 'owner-1' },
    [jobPath]: { id: 'job-1', customerId: 'customer-1', customerName: 'Customer', serviceLocationId: 'site-1', billingStatus: 'Estimate', operationStatus: 'Estimate Pending',
      activePlanId: 'plan-A', acceptedPlanId: '', rate: 10000, laborCost: 3000, laborLineItems: [{ id: 'line-A', totalPriceCents: 10000 }] },
    [`${jobPath}/plans/plan-A`]: { id: 'plan-A', status: 'Draft', isActivePlan: true },
    [planPath]: planB(),
    [`${jobPath}/tasks/task-A`]: { id: 'task-A', status: 'Draft' },
    [`${jobPath}/laborLineItems/line-A`]: { id: 'line-A', totalPriceCents: 10000 },
  });
});

test('accepting B replaces A service lines in both representations and preserves explicit zero cost', async () => {
  await applyPlan({ accepted: true });
  const job = db.records.get(jobPath);
  assert.equal(job.rate, 20000); assert.equal(job.laborCost, 0);
  assert.equal(job.acceptedPlanId, 'plan-B'); assert.equal(job.billingStatus, 'Accepted');
  assert.deepEqual(job.laborLineItems.map((line) => line.id), ['line-B']);
  assert.deepEqual(job.estimateLaborLineItems, job.laborLineItems);
  assert.equal(db.records.has(`${jobPath}/laborLineItems/line-A`), false);
  assert.equal(db.records.get(`${jobPath}/laborLineItems/line-B`).totalPriceCents, 20000);
  assert.equal(db.records.get(`${jobPath}/plans/plan-A`).isActivePlan, false);
  assert.equal(db.records.get(planPath).isAccepted, true);
});

test('service-only plans and free plans replace old lines instead of leaving the prior price', async () => {
  db.set(planPath, { ...planB(), tasks: [], totalAmountCents: 0, laborLineItems: [{ id: 'free-service', totalPriceCents: 0 }] });
  await applyPlan({ accepted: true });
  assert.equal(db.records.get(jobPath).rate, 0);
  assert.deepEqual(db.records.get(jobPath).laborLineItems.map((line) => line.id), ['free-service']);
  assert.equal(db.records.has(`${jobPath}/tasks/task-A`), false);
});

test('an explicitly empty saved plan clears editable drafts and old billing lines', async () => {
  db.set(planPath, { ...empty(), totalAmountCents: 0 });
  await applyPlan({ accepted: true });
  assert.deepEqual(db.records.get(jobPath).laborLineItems, []);
  assert.deepEqual(db.records.get(jobPath).estimateLaborLineItems, []);
  assert.equal(db.records.has(`${jobPath}/laborLineItems/line-A`), false);
});

test('new records do not inherit execution or purchase history from a saved snapshot', async () => {
  db.set(planPath, { ...planB(), tasks: [{ id: 'task-B', status: 'Finished', actualTime: 50, workerId: 'old-tech', serviceStopId: { id: 'old-stop' } }],
    shoppingItems: [{ id: 'part-B', status: 'Installed', purchasedItem: 'old-purchase', installedEquipmentId: 'old-pump', invoiced: true }] });
  await applyPlan({ accepted: true });
  const task = db.records.get(`${jobPath}/tasks/task-B`), item = db.records.get('companies/company-1/shoppingList/part-B');
  assert.equal(task.status, 'Draft'); assert.equal(task.actualTime, 0); assert.equal(task.workerId, ''); assert.equal(task.serviceStopId.id, '');
  assert.equal(item.status, 'Need to Purchase'); assert.equal(item.purchasedItem, ''); assert.equal(item.invoiced, false);
  assert.equal(item.installedEquipmentId, undefined);
});

test('legacy scope without headline totals derives price from the selected services', async () => {
  const plan = planB(); delete plan.totalAmountCents; delete plan.laborCostCents;
  db.set(planPath, plan);
  await applyPlan({ accepted: true });
  assert.equal(db.records.get(jobPath).rate, 20000);
  assert.equal(db.records.get(jobPath).laborCost, 0);
});

test('legacy solution records use the same promotion and are superseded consistently', async () => {
  db.records.delete(planPath);
  db.set(`${jobPath}/solutions/plan-B`, planB());
  db.set(`${jobPath}/plans/plan-A`, { status: 'Accepted', isAccepted: true });
  await applyPlan({ accepted: true });
  assert.equal(db.records.get(`${jobPath}/solutions/plan-B`).isAccepted, true);
  assert.equal(db.records.get(`${jobPath}/plans/plan-A`).status, 'Superseded');
  assert.equal(db.records.get(`${jobPath}/plans/plan-A`).isAccepted, false);
  assert.equal(db.records.has(planPath), false);
});

test('reloading a snapshot keeps technician, completion, service-stop, purchase and install state', async () => {
  db.set(`${jobPath}/tasks/task-B`, { id: 'task-B', status: 'Finished', actualTime: 70, workerId: 'tech-1', serviceStopId: { id: 'stop-1' }, shoppingListItemIds: ['material-B'] });
  db.set('companies/company-1/shoppingList/material-B', { id: 'material-B', jobId: 'job-1', linkedTaskId: 'task-B', status: 'Installed', purchasedItem: 'purchase-1', purchaserId: 'buyer-1', installedEquipmentId: 'pump-1', invoiced: true });
  db.set(planPath, { ...planB(), shoppingItems: [{ id: 'material-B', linkedTaskId: 'task-B', status: 'Need to Purchase', purchasedItem: '' }] });
  await applyPlan();
  const task = db.records.get(`${jobPath}/tasks/task-B`), item = db.records.get('companies/company-1/shoppingList/material-B');
  assert.equal(task.status, 'Finished'); assert.equal(task.actualTime, 70); assert.equal(task.workerId, 'tech-1');
  assert.equal(task.serviceStopId.id, 'stop-1'); assert.deepEqual(task.shoppingListItemIds, ['material-B']);
  assert.equal(item.status, 'Installed'); assert.equal(item.purchasedItem, 'purchase-1'); assert.equal(item.installedEquipmentId, 'pump-1'); assert.equal(item.invoiced, true);
  assert.equal(item.purchaserId, 'buyer-1');
  assert.equal(db.records.get(jobPath).billingStatus, 'Estimate');
});

test('acceptance preserves purchased status and never requeues an installed item', async () => {
  db.set(planPath, { ...planB(), shoppingItems: [{ id: 'part-1' }] });
  db.set('companies/company-1/shoppingList/part-1', { id: 'part-1', jobId: 'job-1', status: 'Installed', installedAt: 'yesterday', needsAction: false });
  await applyPlan({ accepted: true });
  assert.equal(db.records.get('companies/company-1/shoppingList/part-1').status, 'Installed');
  assert.equal(db.records.get('companies/company-1/shoppingList/part-1').needsAction, false);
  assert.equal(db.records.get('companies/company-1/shoppingList/part-1').estimateAccepted, true);
});

for (const [name, path, record] of [
  ['assigned task', `${jobPath}/tasks/task-A`, { id: 'task-A', workerId: 'tech-1' }],
  ['completed task', `${jobPath}/tasks/task-A`, { id: 'task-A', status: 'Finished' }],
  ['scheduled visit', `${jobPath}/plannedServiceStops/visit-A`, { id: 'visit-A', scheduledServiceStopId: 'actual-stop-1' }],
  ['purchased item', 'companies/company-1/shoppingList/part-A', { id: 'part-A', jobId: 'job-1', status: 'Purchased', purchasedItem: 'purchase-1' }],
]) {
  test(`a plan that removes a ${name} fails without changing any records`, async () => {
    db.set(path, record);
    const before = [...db.records];
    await assert.rejects(applyPlan({ accepted: true }), { code: 'failed-precondition' });
    assert.deepEqual([...db.records], before);
  });
}

test('a purchased material protects its linked draft task, visit and quoted service', () => {
  const current = { tasks: [{ id: 'task-1' }], shoppingItems: [{ id: 'part-1', status: 'Purchased', linkedTaskId: 'task-1' }],
    plannedServiceStops: [{ id: 'visit-1', taskIds: ['task-1'] }], laborLineItems: [{ id: 'line-1', taskIds: ['task-1'] }] };
  assert.throws(() => reconcileJobPlanScope(current, { ...current, laborLineItems: [] }), { code: 'failed-precondition' });
});

test('a transaction retries against a purchase made while the plan was being loaded', async () => {
  db.set(planPath, { ...planB(), shoppingItems: [{ id: 'part-1' }] });
  db.set('companies/company-1/shoppingList/part-1', { id: 'part-1', jobId: 'job-1', status: 'Need to Purchase' });
  db.beforeCommit = () => db.set('companies/company-1/shoppingList/part-1', { id: 'part-1', jobId: 'job-1', status: 'Purchased', purchasedItem: 'new-purchase' });
  await applyPlan({ accepted: true });
  assert.equal(db.records.get('companies/company-1/shoppingList/part-1').status, 'Purchased');
  assert.equal(db.records.get('companies/company-1/shoppingList/part-1').purchasedItem, 'new-purchase');
});

test('commit failure leaves the complete previous workspace and plan selection intact', async () => {
  db.commitError = new Error('Simulated write failure');
  const before = [...db.records];
  await assert.rejects(applyPlan({ accepted: true }), /Simulated write failure/);
  assert.deepEqual([...db.records], before);
});

test('invoiced jobs and oversized scopes fail before any changes', async () => {
  db.set(jobPath, { ...db.records.get(jobPath), billingStatus: 'Invoiced' });
  await assert.rejects(applyPlan(), { code: 'failed-precondition' });
  db.set(jobPath, { ...db.records.get(jobPath), billingStatus: 'Estimate' });
  db.set(planPath, { ...planB(), tasks: Array.from({ length: 451 }, (_, index) => ({ id: `task-${index}` })) });
  const before = [...db.records];
  await assert.rejects(applyPlan(), { code: 'failed-precondition' });
  assert.deepEqual([...db.records], before);
});

// Exercise the actual exported staff/customer/email-link callables as well as the
// transaction module. Replace every Firestore entry point before invoking them.
admin.initializeApp({ projectId: 'demo-job-plan-workspace' });
const adminDb = admin.firestore();
adminDb.collection = (...args) => db.collection(...args);
adminDb.runTransaction = (...args) => db.runTransaction(...args);
const callables = require('./stripe/stripeCallableForConnectedAccounts');
const authContext = { auth: { uid: 'owner-1', token: { name: 'Owner', email: 'owner@example.test' } }, rawRequest: { headers: {} } };

test('the staff callable enforces company access and plan-edit vs acceptance permissions', async () => {
  const payload = { companyId: 'company-1', jobId: 'job-1', planId: 'plan-B', mode: 'load' };
  await assert.rejects(callables.applyJobPlanWorkspace.run(payload, { rawRequest: { headers: {} } }), { code: 'unauthenticated' });
  await assert.rejects(callables.applyJobPlanWorkspace.run(payload, { ...authContext, auth: { uid: 'other-user' } }), { code: 'permission-denied' });
  db.set('users/field-tech/userAccess/company-1', { roleId: 'field-role' });
  db.set('companies/company-1/roles/field-role', { permissionIdList: ['72'] });
  const techContext = { ...authContext, auth: { uid: 'field-tech', token: {} } };
  await callables.applyJobPlanWorkspace.run(payload, techContext);
  await assert.rejects(callables.applyJobPlanWorkspace.run({ ...payload, mode: 'accept' }, techContext), { code: 'permission-denied' });
  assert.equal(db.records.get(jobPath).billingStatus, 'Estimate');
  db.set('companies/company-1/roles/field-role', { permissionIdList: ['400'] });
  await callables.applyJobPlanWorkspace.run({ ...payload, mode: 'accept' }, techContext);
  assert.equal(db.records.get(jobPath).billingStatus, 'Accepted');
});

const seedAgreement = () => db.set('salesAgreements/agreement-1', {
  id: 'agreement-1', companyId: 'company-1', customerId: 'customer-1', customerUserId: 'owner-1',
  jobId: 'job-1', sourceType: 'oneOffJob', status: 'sent', title: 'Job estimate', email: 'customer@example.test',
  totalAmountCents: 10000, lineItems: [], selectedPlanId: 'plan-A',
  planOptions: [{ planId: 'plan-A', totalAmountCents: 10000 }, { ...planB(), planId: 'plan-B' }],
  emailDelivery: { reviewAccessToken: 'test-review-token' },
});
const acceptancePayload = () => ({ agreementId: 'agreement-1', selectedPlanId: 'plan-B', signatureName: 'Test Customer',
  acceptedTerms: true, acceptedPricing: true, acceptedAutopayNotice: true, customerBillingPreference: 'requestInvoice', accessToken: 'test-review-token' });

test('staff marking an estimate accepted commits agreement, legacy contract and job together without resetting Scheduled', async () => {
  seedAgreement();
  db.set('contracts/contract-1', { senderId: 'company-1', jobId: 'job-1', status: 'Draft' });
  db.set(jobPath, { ...db.records.get(jobPath), operationStatus: 'Scheduled' });
  await callables.applyJobPlanWorkspace.run({ companyId: 'company-1', jobId: 'job-1', planId: 'plan-B', mode: 'accept', agreementId: 'agreement-1', contractId: 'contract-1' }, authContext);
  assert.equal(db.records.get(jobPath).operationStatus, 'Scheduled');
  assert.equal(db.records.get(jobPath).rate, 20000);
  assert.equal(db.records.get('contracts/contract-1').receiverAcceptance, true);
  assert.equal(db.records.get('salesAgreements/agreement-1').totalAmountCents, 20000);
  assert.equal(db.records.get('salesAgreements/agreement-1').acceptedSnapshot.lineItems[0].id, 'line-B');
});

test('staff acceptance leaves agreement and legacy contract untouched on a scope conflict', async () => {
  seedAgreement();
  db.set('contracts/contract-1', { senderId: 'company-1', jobId: 'job-1', status: 'Draft' });
  db.set(`${jobPath}/tasks/task-A`, { id: 'task-A', status: 'Finished' });
  const before = [...db.records];
  await assert.rejects(callables.applyJobPlanWorkspace.run({ companyId: 'company-1', jobId: 'job-1', planId: 'plan-B', mode: 'accept', agreementId: 'agreement-1', contractId: 'contract-1' }, authContext), { code: 'failed-precondition' });
  assert.deepEqual([...db.records], before);
});

test('staff cannot attach an estimate belonging to another job or company', async () => {
  seedAgreement();
  db.set('salesAgreements/agreement-1', { ...db.records.get('salesAgreements/agreement-1'), companyId: 'company-2' });
  const before = [...db.records];
  await assert.rejects(callables.applyJobPlanWorkspace.run({ companyId: 'company-1', jobId: 'job-1', planId: 'plan-B', mode: 'accept', agreementId: 'agreement-1' }, authContext), { code: 'permission-denied' });
  assert.deepEqual([...db.records], before);
});

test('staff acceptance of a free option clears the previous estimate price and line items', async () => {
  const free = { ...planB(), totalAmountCents: 0, laborLineItems: [], lineItems: [] };
  db.set(planPath, free);
  seedAgreement();
  db.set('salesAgreements/agreement-1', { ...db.records.get('salesAgreements/agreement-1'), planOptions: [{ ...free, planId: 'plan-B' }] });
  await callables.applyJobPlanWorkspace.run({ companyId: 'company-1', jobId: 'job-1', planId: 'plan-B', mode: 'accept', agreementId: 'agreement-1' }, authContext);
  assert.equal(db.records.get(jobPath).rate, 0);
  assert.equal(db.records.get('salesAgreements/agreement-1').totalAmountCents, 0);
  assert.deepEqual(db.records.get('salesAgreements/agreement-1').lineItems, []);
});

for (const callableName of ['acceptSalesServiceAgreement', 'acceptPublicSalesServiceAgreement']) {
  test(`${callableName} commits agreement, selected work, and B billing lines together`, async () => {
    seedAgreement();
    await callables[callableName].run(acceptancePayload(), authContext);
    assert.equal(db.records.get('salesAgreements/agreement-1').status, 'accepted');
    assert.equal(db.records.get('salesAgreements/agreement-1').totalAmountCents, 20000);
    assert.equal(db.records.get('salesAgreements/agreement-1').acceptedSnapshot.totalAmountCents, 20000);
    assert.equal(db.records.get('salesAgreements/agreement-1').lineItems[0].id, 'line-B');
    assert.equal(db.records.get('salesAgreements/agreement-1').acceptedSnapshot.lineItems[0].id, 'line-B');
    assert.equal(db.records.get(jobPath).acceptedPlanId, 'plan-B');
    assert.equal(db.records.get(jobPath).rate, 20000);
    assert.deepEqual(db.records.get(jobPath).laborLineItems.map((line) => line.id), ['line-B']);
    assert.equal(db.records.has(`${jobPath}/laborLineItems/line-A`), false);
  });
  test(`${callableName} leaves the estimate unaccepted if work cannot be replaced`, async () => {
    seedAgreement();
    db.set(`${jobPath}/tasks/task-A`, { id: 'task-A', status: 'Finished', actualTime: 30 });
    const before = [...db.records];
    await assert.rejects(callables[callableName].run(acceptancePayload(), authContext), { code: 'failed-precondition' });
    assert.deepEqual([...db.records], before);
    assert.equal(db.records.get('salesAgreements/agreement-1').status, 'sent');
  });
  test(`${callableName} accepts an explicitly free option without using A's price`, async () => {
    const freePlan = { ...planB(), tasks: [], laborLineItems: [], lineItems: [], totalAmountCents: 0 };
    db.set(planPath, freePlan);
    seedAgreement();
    const agreement = db.records.get('salesAgreements/agreement-1');
    db.set('salesAgreements/agreement-1', { ...agreement, planOptions: [{ planId: 'plan-B', ...freePlan }] });
    await callables[callableName].run(acceptancePayload(), authContext);
    assert.equal(db.records.get(jobPath).rate, 0);
    assert.equal(db.records.get('salesAgreements/agreement-1').totalAmountCents, 0);
    assert.deepEqual(db.records.get(jobPath).laborLineItems, []);
  });
  test(`${callableName} requires a revised estimate when the saved plan's prices changed`, async () => {
    seedAgreement();
    db.set(planPath, { ...planB(), totalAmountCents: 30000 });
    const before = [...db.records];
    await assert.rejects(callables[callableName].run(acceptancePayload(), authContext), { code: 'failed-precondition' });
    assert.deepEqual([...db.records], before);
  });
}
