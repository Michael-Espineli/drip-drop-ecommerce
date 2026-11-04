const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');
const { createJobCloseout } = require('./jobCloseout');
const { createEquipmentCompletion, nextServiceDate } = require('./equipmentCompletion');
const c = 'companies/company', j = `${c}/workOrders/job`, e = `${c}/equipment/filter`;
const at = new Date('2026-11-02T18:00:00Z'), old = new Date('2026-01-01T18:00:00Z');
const fixture = (extra = {}) => {
  const db = new MemoryFirestore({
    [c]: { ownerId: 'admin' },
    [j]: { type: 'Maintenance', jobIntent: 'maintenance', equipmentId: 'filter', equipmentIds: ['filter'], operationStatus: 'In Progress' },
    [j + '/tasks/task']: { name: 'Clean filter', type: 'Clean Filter', equipmentId: 'filter', status: 'Scheduled', workerId: 'admin', workerName: 'Alex', workerType: 'Employee' },
    [e]: { name: 'Filter', status: 'Needs Maintenance', isActive: true, lastServiceDate: old, nextServiceDate: old, needsService: true, serviceFrequency: 6, serviceFrequencyEvery: 'Monthly' },
    [e + '/scheduledWork/visit']: { jobId: 'job', status: 'Scheduled', dateCompleted: null },
    ...extra,
  });
  const completion = createEquipmentCompletion(db, () => at), closeout = createJobCloseout(db, () => at);
  const finish = (data = {}) => closeout({ auth: { uid: 'admin' }, data: { companyId: 'company', jobId: 'job', requestId: 'request', finishJob: true, taskIds: ['task'], productIds: [], serviceIds: [], ...data } });
  const event = (after = {}, params = {}) => ({ params: { companyId: 'company', jobId: 'job', taskId: 'task', ...params }, data: { after: { exists: true, data: () => after } } });
  const histories = (equipment = e) => [...db.records].filter(([path]) => path.startsWith(equipment + '/serviceHistory/')).map(([, value]) => value);
  return { db, completion, finish, event, histories };
};

test('closeout atomically records maintenance, dates, status and scheduled-work completion', async () => {
  const f = fixture();
  await f.finish();
  assert.equal(f.db.records.get(j).operationStatus, 'Finished');
  assert.equal(f.db.records.get(j + '/tasks/task').status, 'Finished');
  assert.equal(f.histories().length, 1);
  assert.equal(f.histories()[0].id, 'auto_equ_sh_task');
  assert.equal(f.histories()[0].jobTaskId, 'task');
  assert.equal(f.histories()[0].techName, 'Alex');
  assert.deepEqual(f.histories()[0].date, at);
  assert.equal(f.db.records.get(e).status, 'Operational');
  assert.equal(f.db.records.get(e).needsService, true);
  assert.deepEqual(f.db.records.get(e).lastServiceDate, at);
  assert.deepEqual(f.db.records.get(e).nextServiceDate, new Date('2027-05-02T18:00:00Z'));
  assert.equal(f.db.records.get(e + '/scheduledWork/visit').status, 'Completed');
});

test('failed closeout rolls equipment history and task/job writes back together', async () => {
  const f = fixture(), before = new Map(f.db.records);
  f.db.commitError = new Error('interrupted');
  await assert.rejects(f.finish(), /interrupted/);
  assert.deepEqual(f.db.records, before);
  delete f.db.commitError;
  await f.finish();
  assert.equal(f.histories().length, 1);
});

test('closeout, new request IDs and server trigger retries preserve one event and its original date', async () => {
  const f = fixture();
  await f.finish();
  const initial = f.histories()[0];
  await f.finish();
  await f.finish({ requestId: 'different-request' });
  await f.completion.onJob(f.event({ operationStatus: 'Finished' }));
  await f.completion.onTask(f.event({ status: 'Finished' }));
  assert.deepEqual(f.histories(), [initial]);
  assert.deepEqual(f.db.records.get(e).lastServiceDate, at);
});

test('generic template jobs record one fallback for each linked equipment only at whole-job completion', async () => {
  const pump = `${c}/equipment/pump`;
  const f = fixture({
    [j]: { type: 'Filter package', jobIntent: 'maintenance', equipmentIds: ['filter', 'pump'], operationStatus: 'In Progress' },
    [j + '/tasks/task']: { type: 'Basic', status: 'Scheduled', equipmentId: 'filter' },
    [pump]: { name: 'Pump', status: 'Needs Maintenance', serviceFrequency: 1, serviceFrequencyEvery: 'Yearly' },
  });
  await f.finish({ finishJob: false });
  assert.equal(f.histories().length, 0);
  assert.equal(f.histories(pump).length, 0);
  assert.equal(f.db.records.get(e + '/scheduledWork/visit').status, 'Scheduled');
  await f.finish({ requestId: 'whole', taskIds: [] });
  assert.equal(f.histories().length, 1);
  assert.equal(f.histories(pump).length, 1);
  assert.equal(f.histories()[0].id, 'auto_equ_sh_job_equipment_job_maintenance');
  assert.equal(f.db.records.get(pump).status, 'Operational');
});

test('old native jobs with no task or equipment fields recover their scheduledWork equipment link', async () => {
  const f = fixture({ [j]: { type: 'Repair', operationStatus: 'In Progress' } });
  f.db.records.delete(j + '/tasks/task');
  await f.finish({ taskIds: [] });
  assert.equal(f.histories().length, 1);
  assert.equal(f.histories()[0].type, 'Repair');
  assert.deepEqual(f.db.records.get(e).lastServiceDate, old);
  assert.equal(f.db.records.get(e + '/scheduledWork/visit').status, 'Completed');
});

test('scheduled-work discovery cannot update another company even if job IDs collide', async () => {
  const other = 'companies/other/equipment/pump/scheduledWork/visit';
  const f = fixture({ [other]: { jobId: 'job', status: 'Scheduled' } });
  await f.finish();
  assert.equal(f.db.records.get(other).status, 'Scheduled');
  assert.equal([...f.db.records.keys()].filter(path => path.startsWith('companies/other/equipment/pump/serviceHistory/')).length, 0);
});

test('repair completes equipment without changing its maintenance cadence', async () => {
  const f = fixture({ [j + '/tasks/task']: { type: 'Repair', equipmentId: 'filter', status: 'Scheduled' }, [e]: { status: 'Needs Repair', lastServiceDate: old, nextServiceDate: old } });
  await f.finish();
  assert.equal(f.histories()[0].type, 'Repair');
  assert.equal(f.db.records.get(e).status, 'Operational');
  assert.deepEqual(f.db.records.get(e).lastServiceDate, old);
  assert.deepEqual(f.db.records.get(e).nextServiceDate, old);
});

test('partial typed completion records actual work but leaves the job and scheduled work open', async () => {
  const f = fixture({ [j + '/tasks/later']: { status: 'Draft', type: 'Basic' } });
  await f.finish({ finishJob: false });
  assert.equal(f.histories().length, 1);
  assert.equal(f.db.records.get(j).operationStatus, 'In Progress');
  assert.equal(f.db.records.get(e + '/scheduledWork/visit').status, 'Scheduled');
});

test('canonical and scheduled task copies produce a single attributed history event', async () => {
  const s = `${c}/serviceStops/stop`;
  const f = fixture({
    [s]: { jobId: 'job', techId: 'admin', tech: 'Alex', operationStatus: 'Not Finished' },
    [s + '/tasks/copy']: { type: 'Maintenance', equipmentId: 'filter', jobTaskId: 'task', status: 'Scheduled' },
  });
  await f.finish({ serviceStopIds: ['stop'], serviceStopTaskIds: { stop: ['copy'] } });
  await f.completion.onStopTask(f.event({ status: 'Finished' }, { stopId: 'stop', taskId: 'copy' }));
  assert.equal(f.histories().length, 1);
  assert.equal(f.histories()[0].serviceStopTaskId, 'copy');
  assert.equal(f.histories()[0].techName, 'Alex');
});

test('already-finished tasks missing history are repaired by closeout', async () => {
  const f = fixture({ [j + '/tasks/task']: { type: 'Maintenance', equipmentId: 'filter', status: 'Finished', completedAt: old, workerId: 'original' } });
  await f.finish({ taskIds: [] });
  assert.equal(f.histories()[0].techId, 'original');
  assert.deepEqual(f.histories()[0].date, old);
});

test('task trigger recovers an interrupted native client and failed server attempt', async () => {
  const f = fixture({ [j + '/tasks/task']: { type: 'Maintenance', equipmentId: 'filter', status: 'Finished', completedAt: at } });
  f.db.commitError = new Error('temporary failure');
  await assert.rejects(f.completion.onTask(f.event({ status: 'Finished' })), /temporary failure/);
  assert.equal(f.histories().length, 0);
  delete f.db.commitError;
  await f.completion.onTask(f.event({ status: 'Finished' }));
  assert.equal(f.histories().length, 1);
  assert.equal(f.db.records.get(e).status, 'Operational');
  assert.equal(f.db.records.get(j).operationStatus, 'In Progress');
});

test('standalone maintenance stop task gets history without finishing the visit or a job', async () => {
  const s = `${c}/serviceStops/standalone`;
  const f = fixture({ [s]: { techId: 'tech', tech: 'Taylor', operationStatus: 'Not Finished' }, [s + '/tasks/work']: { type: 'Maintenance', equipmentId: 'filter', status: 'Finished', completedAt: at } });
  await f.completion.onStopTask(f.event({ status: 'Finished' }, { stopId: 'standalone', taskId: 'work' }));
  assert.equal(f.histories()[0].jobId, '');
  assert.equal(f.histories()[0].techName, 'Taylor');
  assert.equal(f.db.records.get(s).operationStatus, 'Not Finished');
});

test('contracted stop task writes history in the equipment owning company', async () => {
  const s = 'companies/contractor/serviceStops/contracted';
  const f = fixture({
    [s]: { otherCompany: true, mainCompanyId: 'company', jobId: 'job', laborContractId: 'contract' },
    [s + '/tasks/work']: { type: 'Repair', equipmentId: 'filter', status: 'Finished', completedAt: at, jobTaskId: 'task' },
    [j + '/tasks/task']: { type: 'Repair', equipmentId: 'filter', laborContractId: 'contract', status: 'Scheduled' },
    'laborContracts/contract': { senderId: 'company', receiverId: 'contractor', senderJobId: { id: 'job' }, senderAcceptance: true, receiverAcceptance: true },
  });
  await f.completion.onStopTask(f.event({ status: 'Finished' }, { companyId: 'contractor', stopId: 'contracted', taskId: 'work' }));
  assert.equal(f.histories().length, 1);
  assert.equal([...f.db.records.keys()].some(path => path.startsWith('companies/contractor/equipment/')), false);
});

test('an older completion preserves newer manual service dates and current equipment status', async () => {
  const newer = new Date('2026-11-03T18:00:00Z');
  const f = fixture({
    [e]: { status: 'Needs Repair', lastServiceDate: newer, nextServiceDate: newer },
    [e + '/serviceHistory/manual']: { id: 'manual', type: 'Maintenance', date: newer, addedBy: 'Manual' },
    [j + '/tasks/task']: { type: 'Maintenance', equipmentId: 'filter', status: 'Finished', completedAt: old },
  });
  await f.finish({ taskIds: [] });
  assert.equal(f.histories().length, 2);
  assert.equal(f.db.records.get(e).status, 'Needs Repair');
  assert.deepEqual(f.db.records.get(e).lastServiceDate, newer);
  assert.deepEqual(f.db.records.get(e).nextServiceDate, newer);
});

test('existing client history retains its original date, attribution and notes', async () => {
  const original = { id: 'auto_equ_sh_task', type: 'Maintenance', jobId: 'job', date: old, techId: 'original', description: 'Original notes', addedBy: 'Auto' };
  const f = fixture({ [e + '/serviceHistory/auto_equ_sh_task']: original });
  await f.finish();
  assert.equal(f.histories().length, 1);
  assert.equal(f.histories()[0].description, original.description);
  assert.equal(f.histories()[0].techId, 'original');
  assert.deepEqual(f.histories()[0].date, old);
});

test('a preexisting job fallback does not become a second event when task triggers arrive later', async () => {
  const f = fixture({ [e + '/serviceHistory/auto_equ_sh_job_equipment_job_maintenance']: { id: 'auto_equ_sh_job_equipment_job_maintenance', type: 'Maintenance', jobId: 'job', date: old, addedBy: 'Auto' } });
  await f.finish();
  await f.completion.onTask(f.event({ status: 'Finished' }));
  assert.equal(f.histories().length, 1);
});

test('stale task/job events re-read current state and cannot complete reopened work', async () => {
  const f = fixture();
  await f.completion.onTask(f.event({ status: 'Finished' }));
  await f.completion.onJob(f.event({ operationStatus: 'Finished' }));
  assert.equal(f.histories().length, 0);
});

test('raw finished-job edits cannot invent completion of unfinished maintenance tasks', async () => {
  const f = fixture({ [j]: { operationStatus: 'Finished', type: 'Maintenance', equipmentId: 'filter' } });
  await f.completion.onJob(f.event({ operationStatus: 'Finished' }));
  assert.equal(f.histories().length, 0);
  assert.equal(f.db.records.get(e + '/scheduledWork/visit').status, 'Scheduled');
});

test('customer-resolved jobs and cancelled tasks do not fabricate maintenance', async () => {
  const f = fixture({ [j]: { operationStatus: 'Finished', billingStatus: 'Customer Resolved', type: 'Maintenance', equipmentId: 'filter' }, [j + '/tasks/task']: { type: 'Maintenance', equipmentId: 'filter', status: 'Cancelled' } });
  await f.completion.onJob(f.event({ operationStatus: 'Finished' }));
  assert.equal(f.histories().length, 0);
  assert.equal(f.db.records.get(e + '/scheduledWork/visit').status, 'Scheduled');
});

test('deleted or replaced equipment cannot be resurrected by delayed completion', async () => {
  const f = fixture({ [e]: { status: 'Replaced', isActive: false } });
  await f.finish();
  assert.equal(f.db.records.get(e).status, 'Replaced');
  f.db.records.delete(e);
  await f.completion.onTask(f.event({ status: 'Finished' }));
  assert.equal(f.db.records.has(e), false);
});

test('service date calculation handles native/web spellings and calendar boundaries', () => {
  const end = new Date('2024-01-31T18:00:00Z');
  assert.deepEqual(nextServiceDate(end, 1, 'Monthly'), new Date('2024-02-29T18:00:00Z'));
  assert.deepEqual(nextServiceDate(end, 1, 'Daily'), new Date('2024-02-01T18:00:00Z'));
  assert.deepEqual(nextServiceDate(end, 1, 'Week'), new Date('2024-02-07T18:00:00Z'));
  assert.deepEqual(nextServiceDate(new Date('2024-02-29T18:00:00Z'), 1, 'Yearly'), new Date('2025-02-28T18:00:00Z'));
  assert.equal(nextServiceDate(end, 0, 'Month'), null);
  assert.equal(nextServiceDate(end, 2, 'unknown'), null);
});

test('maintenance dates are recorded even when a later repair is the newest task', async () => {
  const maintenanceAt = new Date('2026-10-01T18:00:00Z');
  const f = fixture({
    [j + '/tasks/task']: { type: 'Maintenance', equipmentId: 'filter', status: 'Finished', completedAt: maintenanceAt },
    [j + '/tasks/later']: { type: 'Repair', equipmentId: 'filter', status: 'Finished', completedAt: at },
  });
  await f.finish({ taskIds: [] });
  assert.equal(f.histories().length, 2);
  assert.deepEqual(f.db.records.get(e).lastServiceDate, maintenanceAt);
  assert.deepEqual(f.db.records.get(e).lastEquipmentCompletionAt, at);
});

test('replacement work is not fabricated as a maintenance/repair fallback', async () => {
  const f = fixture({ [j + '/tasks/task']: { type: 'Replace', equipmentId: 'filter', status: 'Finished' } });
  await f.finish({ taskIds: [] });
  assert.equal(f.histories().length, 0);
});

test('legacy timestamp-free writes use the event time rather than a delayed retry time', async () => {
  const f = fixture({ [j + '/tasks/task']: { type: 'Maintenance', equipmentId: 'filter', status: 'Finished' } });
  await f.completion.onTask({ ...f.event({ status: 'Finished' }), time: old.toISOString() });
  assert.deepEqual(f.histories()[0].date, old);
});

test('replayed completion cannot clear a new issue flagged after the original work', async () => {
  const f = fixture();
  await f.finish();
  f.db.set(e, { status: 'Needs Repair' }, { merge: true });
  await f.completion.onTask(f.event({ status: 'Finished' }));
  await f.completion.onJob(f.event({ operationStatus: 'Finished' }));
  assert.equal(f.db.records.get(e).status, 'Needs Repair');
  assert.equal(f.histories().length, 1);
});

test('forged external stop references cannot write equipment in another company', async () => {
  const s = 'companies/contractor/serviceStops/forged';
  const f = fixture({ [s]: { otherCompany: true, mainCompanyId: 'company', jobId: 'job', laborContractId: 'not-a-contract' }, [s + '/tasks/work']: { type: 'Repair', equipmentId: 'filter', status: 'Finished', completedAt: at, jobTaskId: 'task' } });
  await f.completion.onStopTask(f.event({ status: 'Finished' }, { companyId: 'contractor', stopId: 'forged', taskId: 'work' }));
  assert.equal(f.histories().length, 0);
  assert.equal(f.db.records.get(e).status, 'Needs Maintenance');
});

test('generic ad hoc stop tasks retain equipment scope for a whole-job fallback', async () => {
  const s = `${c}/serviceStops/ad-hoc`;
  const f = fixture({
    [j]: { type: 'Maintenance', operationStatus: 'In Progress' },
    [s]: { jobId: 'job', operationStatus: 'Finished', completedAt: at, equipmentId: 'filter' },
    [s + '/tasks/work']: { type: 'Basic', status: 'Finished', equipmentId: 'filter' },
  });
  f.db.records.delete(j + '/tasks/task');
  f.db.records.delete(e + '/scheduledWork/visit');
  await f.finish({ taskIds: [] });
  assert.equal(f.histories().length, 1);
  assert.equal(f.histories()[0].type, 'Maintenance');
});

test('cancelling an unused visit copy cannot strand scheduled work for an already-completed task', async () => {
  const s = `${c}/serviceStops/unused`;
  const f = fixture({
    [j + '/tasks/task']: { type: 'Maintenance', equipmentId: 'filter', status: 'Finished', completedAt: at },
    [s]: { jobId: 'job', operationStatus: 'Not Finished' },
    [s + '/tasks/copy']: { type: 'Maintenance', equipmentId: 'filter', jobTaskId: 'task', status: 'Scheduled' },
  });
  await f.finish({ taskIds: [], cancelRemainingVisits: true });
  assert.equal(f.db.records.get(s).operationStatus, 'Skipped');
  assert.equal(f.db.records.get(e + '/scheduledWork/visit').status, 'Completed');
  assert.equal(f.histories().length, 1);
});
