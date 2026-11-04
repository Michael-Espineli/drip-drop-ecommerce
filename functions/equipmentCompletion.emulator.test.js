const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { createJobCloseout } = require('./jobCloseout');
const { createEquipmentCompletion } = require('./equipmentCompletion');
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const app = enabled ? admin.initializeApp({ projectId: 'demo-dripdrop-equipment-completion' }, 'equipment-completion-test') : null;
const db = app?.firestore();
after(async () => { if (app) await app.delete(); });
const at = new Date('2026-11-02T18:00:00Z');

test('real Firestore closeout and concurrent task retries create one history and complete scheduled work', { skip: !enabled, timeout: 45000 }, async () => {
  const companyId = 'equipment-' + Date.now(), c = db.collection('companies').doc(companyId);
  const job = c.collection('workOrders').doc('job'), equipment = c.collection('equipment').doc('filter'), stop = c.collection('serviceStops').doc('stop');
  const batch = db.batch();
  batch.set(c, { ownerId: 'admin' });
  batch.set(job, { type: 'Maintenance', operationStatus: 'In Progress', equipmentId: 'filter' });
  batch.set(job.collection('tasks').doc('task'), { type: 'Maintenance', equipmentId: 'filter', status: 'Scheduled', workerId: 'admin', workerName: 'Alex' });
  batch.set(equipment, { status: 'Needs Maintenance', serviceFrequency: 6, serviceFrequencyEvery: 'Month' });
  batch.set(equipment.collection('scheduledWork').doc('visit'), { jobId: 'job', status: 'Scheduled' });
  batch.set(stop, { jobId: { id: 'job' }, operationStatus: 'Not Finished', techId: 'admin', tech: 'Alex' });
  batch.set(stop.collection('tasks').doc('copy'), { type: 'Maintenance', equipmentId: 'filter', jobTaskId: 'task', status: 'Scheduled' });
  await batch.commit();
  const closeout = createJobCloseout(db, () => at);
  await closeout({ auth: { uid: 'admin' }, data: { companyId, jobId: 'job', requestId: 'finish', finishJob: true, taskIds: ['task'], serviceStopIds: ['stop'], serviceStopTaskIds: { stop: ['copy'] } } });
  const completion = createEquipmentCompletion(db, () => new Date('2026-11-05T18:00:00Z'));
  const taskSnapshot = await job.collection('tasks').doc('task').get(), copySnapshot = await stop.collection('tasks').doc('copy').get();
  await Promise.all([
    completion.onTask({ params: { companyId, jobId: 'job', taskId: 'task' }, data: { after: taskSnapshot } }),
    completion.onStopTask({ params: { companyId, stopId: 'stop', taskId: 'copy' }, data: { after: copySnapshot } }),
    completion.onJob({ params: { companyId, jobId: 'job' }, data: { after: await job.get() } }),
  ]);
  const histories = await equipment.collection('serviceHistory').get(), parent = (await equipment.get()).data();
  assert.equal(histories.size, 1);
  assert.equal(histories.docs[0].data().date.toDate().getTime(), at.getTime());
  assert.equal(histories.docs[0].data().techName, 'Alex');
  assert.equal(parent.status, 'Operational');
  assert.equal(parent.nextServiceDate.toDate().toISOString(), '2027-05-02T18:00:00.000Z');
  assert.equal((await equipment.collection('scheduledWork').doc('visit').get()).data().status, 'Completed');
});

test('real collection-group query recovers a legacy native equipment-only scheduling link', { skip: !enabled, timeout: 45000 }, async () => {
  const companyId = 'legacy-' + Date.now(), c = db.collection('companies').doc(companyId), equipment = c.collection('equipment').doc('pump');
  await c.set({ ownerId: 'admin' });
  await c.collection('workOrders').doc('job').set({ type: 'Repair', operationStatus: 'In Progress' });
  await equipment.set({ status: 'Needs Repair' });
  await equipment.collection('scheduledWork').doc('visit').set({ jobId: 'job', status: 'Scheduled' });
  await createJobCloseout(db, () => at)({ auth: { uid: 'admin' }, data: { companyId, jobId: 'job', requestId: 'finish', finishJob: true, taskIds: [] } });
  const history = await equipment.collection('serviceHistory').get();
  assert.equal(history.size, 1);
  assert.equal(history.docs[0].data().type, 'Repair');
  assert.equal((await equipment.get()).data().status, 'Operational');
});
