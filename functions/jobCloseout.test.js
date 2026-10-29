const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');
const { createJobCloseout } = require('./jobCloseout');

const company = 'companies/company';
const job = company + '/workOrders/job';
const stop = company + '/serviceStops/visit';
const at = new Date('2026-10-28T18:00:00Z');
const earlier = new Date('2026-10-27T18:00:00Z');
const fixture = (extra = {}) => {
  const db = new MemoryFirestore({
    [company]: { ownerId: 'admin' },
    'users/tech/userAccess/company': { roleId: 'tech' },
    [company + '/companyUsers/tech']: { userId: 'tech', userName: 'Alex' },
    [job]: { operationStatus: 'In Progress' },
    [job + '/tasks/repair']: { name: 'Repair', status: 'Scheduled', workerId: 'tech', workerName: 'Alex' },
    [stop]: { jobId: 'job', operationStatus: 'Not Finished', techId: 'tech', tech: 'Alex' },
    [stop + '/tasks/repair-copy']: { jobTaskId: 'repair', status: 'Not Finished', workerId: 'tech', workerName: 'Alex' },
    [stop + '/tasks/cleanup']: { name: 'Clean up', status: 'Not Finished' },
    ...extra,
  });
  const closeout = createJobCloseout(db, () => at);
  const call = (data = {}, uid = 'admin') => closeout({ auth: { uid }, data: {
    companyId: 'company', jobId: 'job', requestId: 'request', finishJob: true,
    serviceStopIds: ['visit'], serviceStopTaskIds: { visit: ['repair-copy', 'cleanup'] }, ...data,
  } });
  return { db, call };
};

test('admin finishes visits, stop tasks, linked job tasks, services and products together', async () => {
  const { db, call } = fixture({
    [job + '/laborLineItems/service']: { name: 'Repair service', taskIds: ['repair'] },
    [company + '/shoppingList/part']: { jobId: 'job', status: 'Purchased', quantity: 2, purchasedItemId: 'part' },
    [company + '/purchasedItems/part']: { installed: false },
  });
  const result = await call({ productIds: ['part'] });
  assert.equal(result.finished, true);
  assert.deepEqual(result.completedServiceStopIds, ['visit']);
  assert.equal(db.records.get(job).operationStatus, 'Finished');
  assert.equal(db.records.get(stop).operationStatus, 'Finished');
  assert.equal(db.records.get(stop).manuallyFinished, true);
  assert.equal(db.records.get(stop).techId, 'tech');
  assert.equal(db.records.get(stop).duration, 0);
  assert.equal(db.records.get(stop + '/tasks/repair-copy').workerId, 'tech');
  assert.equal(db.records.get(stop + '/tasks/cleanup').workerId, 'tech');
  assert.equal(db.records.get(job + '/tasks/repair').status, 'Finished');
  assert.equal(db.records.get(job + '/tasks/repair').workerId, 'tech');
  assert.equal(db.records.get(job + '/laborLineItems/service').completionStatus, 'Finished');
  assert.equal(db.records.get(company + '/shoppingList/part').status, 'Installed');
  assert.equal(db.records.get(company + '/purchasedItems/part').installed, true);
});

test('selected visits and tasks can finish while the job and unchecked visits stay open', async () => {
  const future = company + '/serviceStops/future';
  const { db, call } = fixture({ [future]: { jobId: 'job', operationStatus: 'Not Finished' } });
  await call({ finishJob: false, cancelRemainingVisits: true });
  assert.equal(db.records.get(stop).operationStatus, 'Finished');
  assert.equal(db.records.get(job).operationStatus, 'In Progress');
  assert.equal(db.records.get(future).operationStatus, 'Not Finished');
});

test('only explicitly unchecked unused visits are skipped during whole-job completion', async () => {
  const future = company + '/serviceStops/future';
  const { db, call } = fixture({ [future]: { jobId: 'job', operationStatus: 'Not Finished' } });
  const before = new Map(db.records);
  await assert.rejects(call(), /remaining scheduled visits/);
  assert.deepEqual(db.records, before);
  await call({ cancelRemainingVisits: true });
  assert.equal(db.records.get(stop).operationStatus, 'Finished');
  assert.equal(db.records.get(future).operationStatus, 'Skipped');
  const history = [...db.records].find(([path]) => path.startsWith(job + '/history/'))[1];
  assert.deepEqual(history.completedServiceStopIds, ['visit']);
  assert.deepEqual(history.cancelledVisitIds, ['future']);
});

test('unreviewed tasks, including tasks added after opening the popup, block all writes', async () => {
  const { db, call } = fixture({ [stop + '/tasks/new']: { status: 'Draft' } });
  const before = new Map(db.records);
  await assert.rejects(call(), /tasks changed/);
  assert.deepEqual(db.records, before);
  await assert.rejects(call({ serviceStopTaskIds: undefined }), /review all unfinished stop tasks/);
});

test('failed transaction leaves tasks, visits and job unchanged', async () => {
  const { db, call } = fixture();
  db.commitError = new Error('offline');
  const before = new Map(db.records);
  await assert.rejects(call(), /offline/);
  assert.deepEqual(db.records, before);
});

test('retry preserves the first result and a single attributed audit event', async () => {
  const { db, call } = fixture();
  const result = await call();
  const first = new Map(db.records);
  assert.deepEqual(await call(), result);
  assert.deepEqual(db.records, first);
  assert.equal([...db.records.keys()].filter((path) => path.startsWith(job + '/history/')).length, 1);
  assert.equal(db.records.get(stop).completedByUserId, 'admin');
  assert.deepEqual(db.records.get(stop).completedAt, at);
});

test('existing completed visits and tasks preserve their times and original attribution', async () => {
  const finished = company + '/serviceStops/finished';
  const { db, call } = fixture({
    [finished]: { jobId: 'job', operationStatus: 'Finished', completedAt: earlier, completedByUserId: 'original' },
    [stop + '/tasks/done']: { status: 'Finished', completedAt: earlier, completedByUserId: 'original' },
  });
  const originalStop = db.records.get(finished);
  const originalTask = db.records.get(stop + '/tasks/done');
  await call({ serviceStopIds: ['visit', 'finished'] });
  assert.deepEqual(db.records.get(finished), originalStop);
  assert.deepEqual(db.records.get(stop + '/tasks/done'), originalTask);
});

test('legacy work-order references are validated and can be completed', async () => {
  const { db, call } = fixture({
    [stop]: { workOrderId: 'job', operationStatus: 'Not Finished', techId: 'tech' },
    [company + '/shoppingList/legacy']: { assignedJobId: 'job', status: 'Purchased' },
  });
  await assert.rejects(call(), /product installations/);
  await call({ productIds: ['legacy'] });
  assert.equal(db.records.get(stop).operationStatus, 'Finished');
  assert.equal(db.records.get(company + '/shoppingList/legacy').status, 'Installed');
});

test('job serviceStopIds references include otherwise unlinked visits in validation', async () => {
  const { db, call } = fixture({
    [job]: { operationStatus: 'In Progress', serviceStopIds: [{ id: 'visit' }] },
    [stop]: { operationStatus: 'Not Finished', techId: 'tech' },
  });
  await call();
  assert.equal(db.records.get(stop).operationStatus, 'Finished');
});

test('unrelated stops, malformed selections and other technicians work are rejected', async () => {
  const unrelated = company + '/serviceStops/unrelated';
  const { db, call } = fixture({ [unrelated]: { jobId: 'different-job', techId: 'other' } });
  const before = new Map(db.records);
  await assert.rejects(call({ serviceStopIds: ['unrelated'] }), /no longer belongs/);
  await assert.rejects(call({ serviceStopIds: 'visit' }), /valid service stops/);
  db.set(stop, { techId: 'other' }, { merge: true });
  await assert.rejects(call({}, 'tech'), /another technician/);
  db.set(stop, before.get(stop));
  db.set(stop + '/tasks/cleanup', { status: 'Not Finished', workerId: 'other' });
  await assert.rejects(call({}, 'tech'), /another technician/);
  assert.equal(db.records.get(job).operationStatus, 'In Progress');
});
