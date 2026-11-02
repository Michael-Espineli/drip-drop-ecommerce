const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');
const { createTechnicianWorkWorkflow } = require('./technicianWorkWorkflow');
const { createTechnicianExecution } = require('./technicianExecution');
const { createWorkOfferProgress } = require('./workOfferProgress');
const { createPayrollWorkflow } = require('./payrollWorkflow');
const { createJobCloseout } = require('./jobCloseout');

const company = 'companies/company';
const at = new Date('2026-10-31T18:00:00Z');
const finishedAt = new Date('2026-11-01T01:00:00Z');

async function fixture(paySource = 'Offered Amount', extra = {}) {
  const db = new MemoryFirestore({
    [company]: { ownerId: 'admin', name: 'Company' },
    'users/tech/userAccess/company': { roleId: 'tech' },
    [company + '/roles/tech']: { permissionIdList: ['322', '326', '334'] },
    [company + '/companyUsers/tech']: { userId: 'tech', userName: 'Alex', workerType: 'Employee' },
    [company + '/settings/companyWide']: { workOffersAutoAssignOnAcceptance: true },
    [company + '/companyPayTypes/repair']: { name: 'Repair', category: 'repair', defaultRateType: 'flatPerTask' },
    [company + '/technicianRates/rate']: { technicianId: 'tech', payTypeId: 'repair', payBasis: 'serviceStopTask', rateType: 'flatPerTask', amountCents: 5000, status: 'active' },
    [company + '/workOrders/job']: { internalId: 'J1', customerId: 'customer', serviceLocationId: 'site', operationStatus: 'In Progress' },
    [company + '/workOrders/job/tasks/task']: { name: 'Repair', status: 'Draft', payTypeId: 'repair', estimatedTime: 60 },
    ...extra,
  });
  const work = createTechnicianWorkWorkflow(db, () => at);
  const command = (uid, data) => work.command({ auth: { uid }, data: { companyId: 'company', ...data } });
  await command('admin', { action: 'save', offer: {
    id: 'offer', title: 'Repair', jobId: 'job', jobTaskIds: ['task'],
    offerType: 'Internal Board', postedToBoard: true, boardVisibility: 'Employees & Contractors',
    paySource, offeredAmountCents: 10000, incentive: { type: 'flat', amountCents: 1000 }, allowsTechnicianSelfScheduling: true,
  } });
  await command('tech', { action: 'accept', offerId: 'offer', claimId: 'claim' });
  const { serviceStopId } = await createTechnicianExecution(db, () => at).schedule({
    auth: { uid: 'tech' }, data: { companyId: 'company', offerId: 'offer', claimId: 'claim', serviceDateMillis: at.getTime() },
  });
  const payroll = createPayrollWorkflow(db);
  const progress = createWorkOfferProgress(db, () => finishedAt);
  const stopPath = company + '/serviceStops/' + serviceStopId;
  const event = (path, before, params) => ({ params: { companyId: 'company', ...params }, data: {
    before: { exists: true, data: () => before }, after: { exists: true, data: () => db.records.get(path) },
  } });
  const earned = () => [...db.records].filter(([path, row]) => path.startsWith(company + '/technicianPayLineItems/') && row.calculationStatus !== 'voided').map(([, row]) => row);
  const finishStop = async () => {
    const before = db.records.get(stopPath);
    // Match the iOS batch fields: native finishes use endTime, without completedAt.
    db.set(stopPath, { operationStatus: 'Finished', endTime: finishedAt, completionWorkStatus: 'queued', completionWorkSendServiceReport: false }, { merge: true });
    const e = event(stopPath, before, { serviceStopId, stopId: serviceStopId });
    await payroll.onStopWrite(e);
    await progress.onStop(e);
  };
  const review = async (finishJob = true) => {
    const taskPath = company + '/workOrders/job/tasks/task';
    const before = db.records.get(taskPath);
    await createJobCloseout(db, () => finishedAt)({ auth: { uid: 'tech' }, data: {
      companyId: 'company', jobId: 'job', requestId: 'mobile-closeout', finishJob,
      taskIds: ['task'], serviceIds: [], productIds: [], cancelRemainingVisits: false,
    } });
    const e = event(taskPath, before, { jobId: 'job', taskId: 'task' });
    await payroll.onJobTaskWrite(e);
    await progress.onTask(e);
    await payroll.reconcileOffer('company', 'offer');
  };
  return { db, serviceStopId, stopPath, payroll, progress, earned, finishStop, review };
}

for (const [source, expected] of [['Offered Amount', 11000], ['Technician Rate', 6000]]) {
  test(`native offered stop plus reviewed remaining work earns ${source} once without sending email`, async () => {
    const f = await fixture(source);
    await f.finishStop();
    assert.equal(f.db.records.get(company + '/workOrders/job').operationStatus, 'In Progress');
    assert.equal(f.earned().length, 0, 'unfinished accepted tasks are not silently performed or paid');
    await f.review();
    assert.equal(f.db.records.get(company + '/workOrders/job').operationStatus, 'Finished');
    assert.equal(f.db.records.get(company + '/workOffers/offer').claims[0].status, 'Completed');
    assert.equal(f.earned().reduce((sum, row) => sum + row.totalAmountCents, 0), expected);
    assert.equal(f.earned().filter(row => row.payrollSource === 'workOfferIncentive').length, 1);
    assert.ok(f.earned().every(row => row.serviceStopId === f.serviceStopId && row.workOfferId === 'offer'));
    await f.review();
    await f.payroll.reconcileOffer('company', 'offer');
    assert.equal(f.earned().reduce((sum, row) => sum + row.totalAmountCents, 0), expected);
    const base = f.earned().find(row => row.payrollSource !== 'workOfferIncentive');
    assert.equal(base.completedDate.getTime(), finishedAt.getTime());
  });
}

test('accepted fixed pay accrues after reviewed work even when the entire job stays open', async () => {
  const f = await fixture();
  await f.finishStop();
  await f.review(false);
  assert.equal(f.db.records.get(company + '/workOrders/job').operationStatus, 'In Progress');
  assert.equal(f.earned().reduce((sum, row) => sum + row.totalAmountCents, 0), 11000);
});

test('confirmed native task completion before the stop finishes uses the same accepted terms', async () => {
  const f = await fixture();
  f.db.set(company + '/workOrders/job/tasks/task', { status: 'Finished', completedAt: finishedAt }, { merge: true });
  await f.payroll.onJobTaskWrite({ params: { companyId: 'company', jobId: 'job', taskId: 'task' }, data: {
    before: { exists: true, data: () => ({ status: 'Scheduled' }) },
    after: { exists: true, data: () => f.db.records.get(company + '/workOrders/job/tasks/task') },
  } });
  assert.equal(f.earned().length, 0, 'fixed work still requires its agreed visit');
  await f.finishStop();
  await f.payroll.reconcileOffer('company', 'offer');
  assert.equal(f.earned().reduce((sum, row) => sum + row.totalAmountCents, 0), 11000);
});

test('retrying native offered work preserves an approved base line and its single bonus', async () => {
  const f = await fixture();
  await f.finishStop(); await f.review();
  const base = f.earned().find(row => row.payrollSource !== 'workOfferIncentive');
  f.db.set(company + '/technicianPayLineItems/' + base.id, { calculationStatus: 'approved', approvedAt: finishedAt }, { merge: true });
  const approved = f.db.records.get(company + '/technicianPayLineItems/' + base.id);
  await f.payroll.reconcileOffer('company', 'offer');
  assert.deepEqual(f.db.records.get(company + '/technicianPayLineItems/' + base.id), approved);
  assert.equal(f.earned().reduce((sum, row) => sum + row.totalAmountCents, 0), 11000);
});

test('legacy duplicate scheduled copies of one job task still produce one accepted task payment', async () => {
  const f = await fixture('Technician Rate');
  const [, original] = [...f.db.records].find(([path]) => path.startsWith(f.stopPath + '/tasks/'));
  f.db.set(f.stopPath + '/tasks/legacy-copy', { ...original, id: 'legacy-copy' });
  await f.finishStop(); await f.review();
  assert.equal(f.earned().filter(row => row.payrollSource !== 'workOfferIncentive').length, 1);
  assert.equal(f.earned().reduce((sum, row) => sum + row.totalAmountCents, 0), 6000);
});
