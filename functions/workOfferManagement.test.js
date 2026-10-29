const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');
const { createTechnicianWorkWorkflow } = require('./technicianWorkWorkflow');
const company = 'companies/company';
const now = new Date('2026-10-29T12:00:00Z');
const fixture = extra => {
  const db = new MemoryFirestore({
    [company]: { ownerId: 'owner' },
    'users/editor/userAccess/company': { roleId: 'editor' },
    'users/viewer/userAccess/company': { roleId: 'viewer' },
    'users/tech/userAccess/company': { roleId: 'tech' },
    [company + '/roles/editor']: { permissionIdList: ['324', '328'] },
    [company + '/roles/viewer']: { permissionIdList: ['332'] },
    [company + '/roles/tech']: { permissionIdList: ['334'] },
    [company + '/companyUsers/editor']: { userId: 'editor', userName: 'Manager', workerType: 'Employee' },
    [company + '/companyUsers/viewer']: { userId: 'viewer', userName: 'Viewer', workerType: 'Employee' },
    [company + '/companyUsers/tech']: { userId: 'tech', userName: 'Alex', workerType: 'Employee' },
    [company + '/workOrders/job']: { internalId: 'J1' },
    [company + '/workOrders/job/tasks/task']: { id: 'task', name: 'Repair', status: 'Draft', contractedRate: 5000 },
    [company + '/workOffers/offer']: { id: 'offer', jobId: 'job', jobTaskIds: ['task'], offerType: 'Direct User', status: 'Sent', title: 'Repair pump', offeredToUserId: 'tech', offeredToUserName: 'Alex', paySource: 'Offered Amount', offeredAmountCents: 10000, revision: 3, createdByUserId: 'owner', createdAt: now, claims: [], estimatedMinutes: 60 },
    ...extra,
  });
  const workflow = createTechnicianWorkWorkflow(db, () => now);
  const call = (action, data = {}, uid = 'editor') => workflow.command({ auth: { uid }, data: { companyId: 'company', action, offerId: 'offer', ...data } });
  return { db, call, offer: () => db.records.get(company + '/workOffers/offer') };
};

test('read-all management can open a direct offer for another technician without acceptance eligibility', async () => {
  const f = fixture();
  const details = await f.call('details', {}, 'viewer');
  assert.equal(details.offer.title, 'Repair pump');
  assert.equal(details.scope.tasks[0].name, 'Repair');
  assert.equal(details.management.canEdit, false);
  assert.equal(details.management.canDelete, false);
  assert.equal(details.management.canIncentivize, false);
  await assert.rejects(f.call('update', { changes: { title: 'Unauthorized' } }, 'viewer'), { code: 'permission-denied' });
  await assert.rejects(f.call('delete', {}, 'viewer'), { code: 'permission-denied' });
});

test('an update-only manager can edit an unclaimed offer without create permission', async () => {
  const f = fixture();
  await f.call('update', { revision: 3, changes: { title: 'Updated repair', offeredAmountCents: 12500, estimatedMinutes: 90, completionDeadlineAt: new Date('2026-11-05').getTime() } });
  const saved = f.offer();
  assert.equal(saved.title, 'Updated repair');
  assert.equal(saved.jobId, 'job');
  assert.equal(saved.revision, 4);
  assert.equal(saved.offeredAmountCents, 12500);
  assert.equal(saved.estimatedBasePayCents, 12500);
  assert.equal(saved.estimatedPayWithIncentiveCents, 12500);
  assert.equal(saved.createdByUserId, 'owner');
  assert.deepEqual(saved.createdAt, now);
  assert.deepEqual(saved.scopeSnapshot.tasks.map(row => row.id), ['task']);
});

test('editing dates clears legacy aliases and rejects malformed dates or foreign fields', async () => {
  const f = fixture();
  Object.assign(f.offer(), { timelineStartAt: now, deadlineAt: now, dueAt: now });
  await f.call('update', { revision: 3, changes: { proposedStartDate: null, completionDeadlineAt: null, proposedEndDate: null } });
  assert.equal(f.offer().timelineStartAt, null);
  assert.equal(f.offer().deadlineAt, null);
  assert.equal(f.offer().dueAt, null);
  for (const changes of [{ proposedStartDate: 'invalid' }, { offeredAmountCents: 'invalid' }, { claims: [] }, { jobId: 'other-job' }]) {
    const before = new Map(f.db.records);
    await assert.rejects(f.call('update', { changes }), { code: 'invalid-argument' });
    assert.deepEqual(f.db.records, before);
  }
});

test('accepted offers allow metadata edits and keep every agreed term and assignment', async () => {
  const f = fixture();
  await f.call('accept', { claimId: 'claim' }, 'tech');
  const agreement = structuredClone(f.offer().claims[0].agreement);
  await f.call('update', { changes: { title: 'New title', description: 'Access details', adminNotes: 'Call office' } });
  assert.equal(f.offer().title, 'New title');
  assert.equal(f.offer().status, 'Accepted');
  assert.deepEqual(f.offer().claims[0].agreement, agreement);
  assert.equal(f.db.records.get(company + '/workOrders/job/tasks/task').workerId, 'tech');
  for (const changes of [{ offeredAmountCents: 1 }, { jobTaskIds: [] }, { offeredToUserId: 'viewer' }]) {
    await assert.rejects(f.call('update', { changes }), /locked/);
  }
  await assert.rejects(f.call('delete'), /cannot be deleted/);
  await assert.rejects(f.call('incentive', { incentive: { type: 'flat', amountCents: 100 } }), /already been claimed/);
});

test('accepted pay details remain private from read-all roles without finance access', async () => {
  const f = fixture();
  await f.call('accept', { claimId: 'claim' }, 'tech');
  const details = await f.call('details', {}, 'viewer');
  assert.equal(details.pay, null);
  assert.equal(details.offer.claims[0].agreement.rates, undefined);
  assert.equal(details.offer.claims[0].agreement.totalCents, undefined);
  assert.equal(details.management.canDelete, false);
});

test('stale updates, incentives, and deletions leave the latest offer unchanged', async () => {
  const f = fixture();
  for (const [action, data] of [['update', { changes: { title: 'Stale' } }], ['delete', {}], ['incentive', { incentive: { type: 'none' } }]]) {
    const before = new Map(f.db.records);
    await assert.rejects(f.call(action, { ...data, revision: 2 }), /changed/);
    assert.deepEqual(f.db.records, before);
  }
});

test('deletion atomically releases pending reservations while retaining the job, tasks, and stops', async () => {
  const f = fixture({ [company + '/settings/companyWide']: { workOffersRequireApprovalBeforeAssignment: true } });
  await f.call('accept', { claimId: 'claim' }, 'tech');
  f.db.set(company + '/serviceStops/stop', { pendingWorkOfferId: 'offer', operationStatus: 'Not Finished' });
  f.offer().claims[0].stopIds = ['stop'];
  await f.call('delete');
  assert.equal(f.offer(), undefined);
  assert.equal(f.db.records.get(company + '/workOrders/job/tasks/task').claimedWorkOfferId, null);
  assert.equal(f.db.records.get(company + '/serviceStops/stop').pendingWorkOfferId, null);
  assert.ok(f.db.records.has(company + '/workOrders/job'));
  assert.ok(f.db.records.has(company + '/workOrders/job/tasks/task'));
  assert.ok(f.db.records.has(company + '/serviceStops/stop'));
});

test('failed deletion commits no partial changes and a concurrent acceptance prevents deletion', async () => {
  const f = fixture();
  f.db.commitError = Error('offline');
  await assert.rejects(f.call('delete'), /offline/);
  assert.ok(f.offer());
  f.db.commitError = null;
  f.db.beforeCommit = () => f.db.set(company + '/workOffers/offer', { ...f.offer(), status: 'Accepted', acceptedByUserId: 'tech' });
  await assert.rejects(f.call('delete'), /cannot be deleted/);
  assert.equal(f.offer().acceptedByUserId, 'tech');
});

test('incentives recalculate displayed fixed pay and can be removed without stale totals', async () => {
  const f = fixture();
  await f.call('incentive', { revision: 3, incentive: { type: 'percentage', percentage: 12.5, notes: 'Priority' } });
  assert.equal(f.offer().estimatedBasePayCents, 10000);
  assert.equal(f.offer().estimatedPayWithIncentiveCents, 11250);
  assert.equal(f.offer().incentive.notes, 'Priority');
  await f.call('incentive', { revision: 4, incentive: { type: 'none' } });
  assert.equal(f.offer().estimatedPayWithIncentiveCents, 10000);
  assert.equal(f.offer().incentive.notes, '');
  await assert.rejects(f.call('incentive', { incentive: { type: 'flat', amountCents: 'invalid' } }), { code: 'invalid-argument' });
});

test('legacy offers acquire a new revision and payroll-backed records cannot be deleted', async () => {
  const f = fixture();
  delete f.offer().revision;
  await f.call('update', { revision: 1, changes: { title: 'Legacy update' } });
  assert.equal(f.offer().revision, 2);
  await assert.rejects(f.call('update', { revision: 1, changes: { title: 'Stale update' } }), /changed/);
  f.db.set(company + '/payLineItems/earned', { workOfferId: 'offer', totalAmountCents: 10000 });
  await assert.rejects(f.call('delete'), /recorded payroll/);
  assert.ok(f.offer());
});

test('historical scope remains viewable when a task has been removed from the job plan', async () => {
  const f = fixture();
  f.offer().scopeSnapshot = { tasks: [{ id: 'task', name: 'Original repair' }], services: [], products: [], stops: [] };
  f.db.records.delete(company + '/workOrders/job/tasks/task');
  const details = await f.call('details');
  assert.equal(details.scope.tasks[0].name, 'Original repair');
  assert.equal(details.scopeChanged, true);
});
