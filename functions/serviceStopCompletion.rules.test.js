const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { initializeApp, deleteApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp, terminate } = require('firebase/firestore');

if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Local Firestore emulator required.');
const projectId = 'demo-stop-completion';
admin.initializeApp({ projectId });
const db = admin.firestore(), clients = [];
function client(uid) {
  const app = initializeApp({ projectId, apiKey: 'local-test' }, uid);
  const store = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(store, host, Number(port), { mockUserToken: { sub: uid, user_id: uid } });
  clients.push({ app, store });
  return store;
}
const tech = client('tech'), editor = client('editor'), owner = client('owner'), revoked = client('revoked'), outsider = client('outsider');
const prefix = 'companies/company/';
const date = new Date(1793811600000);
const seeded = (async () => {
  const batch = db.batch();
  const records = {
    'companies/company': { ownerId: 'owner' },
    'users/tech/userAccess/company': { roleId: 'tech', status: 'Active' },
    'users/editor/userAccess/company': { roleId: 'editor', status: 'Active' },
    'users/revoked/userAccess/company': { roleId: 'editor', active: false },
    [prefix + 'roles/tech']: { name: 'Technician', permissionIdList: [] },
    [prefix + 'roles/editor']: { name: 'Custom', permissionIdList: ['244'] },
  };
  Object.entries(records).forEach(([path, value]) => batch.set(db.doc(path), value));
  await batch.commit();
})();
let counter = 0;
async function stop(techId = 'tech') {
  await seeded;
  const id = `stop-${++counter}`;
  await db.doc(prefix + 'serviceStops/' + id).set({ techId, tech: 'Technician', serviceDate: date, operationStatus: 'Not Finished', payrollAgreement: { rateCents: 5000 } });
  return id;
}
function completion(store, id, uid, { stopPatch = {}, workPatch = {}, queueOnly = false, stopOnly = false, merge = true } = {}) {
  const requestId = `comp_ss_completion_${id}_${++counter}`;
  const batch = writeBatch(store);
  if (!queueOnly) batch.update(doc(store, prefix + 'serviceStops/' + id), {
    operationStatus: 'Finished', endTime: date, duration: 30,
    completionWorkStatus: 'queued', completionWorkRequestId: requestId,
    completionWorkQueuedAt: serverTimestamp(), completionWorkQueuedByUserId: uid,
    completionWorkSendServiceReport: false, ...stopPatch,
  });
  if (!stopOnly) batch.set(doc(store, prefix + 'serviceStopCompletionWork/' + id), {
    id, requestId, companyId: 'company', serviceStopId: id, status: 'queued',
    queuedAt: serverTimestamp(), queuedByUserId: uid, sendServiceReport: false,
    operationStatus: 'Finished', serviceDate: date, techId: 'tech', techName: 'Technician', attempts: 0,
    ...workPatch,
  }, { merge });
  return batch.commit();
}
const denied = promise => assert.rejects(promise, error => error.code === 'permission-denied');

test('iOS atomic Finish batch succeeds for assigned technician, editor, and owner', async () => {
  for (const [store, uid] of [[tech, 'tech'], [editor, 'editor'], [owner, 'owner']]) {
    const id = await stop();
    await completion(store, id, uid);
    assert.equal((await db.doc(prefix + 'serviceStops/' + id).get()).data().operationStatus, 'Finished');
    assert.equal((await db.doc(prefix + 'serviceStopCompletionWork/' + id).get()).data().status, 'queued');
  }
});
test('failed Finish is atomic and cannot cross worker, company, or revoked membership', async () => {
  for (const [store, uid, assigned] of [[tech, 'tech', 'other'], [revoked, 'revoked', 'tech'], [outsider, 'outsider', 'tech']]) {
    const id = await stop(assigned);
    await denied(completion(store, id, uid, { workPatch: { techId: assigned } }));
    assert.equal((await db.doc(prefix + 'serviceStops/' + id).get()).data().operationStatus, 'Not Finished');
    assert.equal((await db.doc(prefix + 'serviceStopCompletionWork/' + id).get()).exists, false);
  }
  const id = await stop();
  await denied(completion(tech, id, 'tech', { workPatch: { companyId: 'foreign' } }));
});
test('Finish requires a matching atomic queue and authentic attribution', async () => {
  for (const options of [
    { queueOnly: true }, { stopOnly: true },
    { workPatch: { requestId: 'unmatched' } }, { workPatch: { queuedByUserId: 'owner' } },
    { stopPatch: { completionWorkQueuedByUserId: 'owner' } },
    { stopPatch: { completionWorkQueuedByUserId: 'owner' }, workPatch: { queuedByUserId: 'owner' } },
    { workPatch: { serviceStopId: 'other' } }, { workPatch: { techId: 'other' } },
    { workPatch: { sendServiceReport: true } }, { workPatch: { queuedAt: date } },
    { stopPatch: { completionWorkQueuedAt: date }, workPatch: { queuedAt: date } },
    { workPatch: { serviceDate: Timestamp.fromMillis(0) } },
    { stopPatch: { completionWorkRequestId: '' }, workPatch: { requestId: '' } },
  ]) await denied(completion(tech, await stop(), 'tech', options));
});
test('Finish cannot forge payroll, assignments, queue results, destinations, or processed state', async () => {
  for (const options of [
    { stopPatch: { payrollAgreement: { rateCents: 999999 } } }, { stopPatch: { techId: 'other' } },
    { workPatch: { status: 'completed' } }, { workPatch: { attempts: 99 } },
    { workPatch: { result: { payroll: 'fabricated' } } },
    { workPatch: { serviceReportBaseUrl: 'https://attacker.invalid' } },
    { stopPatch: { completionWorkProcessedAt: date } },
  ]) await denied(completion(tech, await stop(), 'tech', options));
});
test('queue retries preserve server results and require a fresh paired request', async () => {
  const id = await stop();
  await completion(tech, id, 'tech');
  const ref = db.doc(prefix + 'serviceStopCompletionWork/' + id);
  await ref.set({ status: 'completedWithErrors', result: { payroll: { ok: true } }, attempts: 1 }, { merge: true });
  await completion(tech, id, 'tech');
  assert.deepEqual((await ref.get()).data().result, { payroll: { ok: true } });
  await denied(updateDoc(doc(tech, prefix + 'serviceStopCompletionWork/' + id), { status: 'completed' }));
  await denied(completion(tech, id, 'tech', { merge: false }));
  const work = (await getDoc(doc(tech, prefix + 'serviceStopCompletionWork/' + id))).data();
  await denied(setDoc(doc(tech, prefix + 'serviceStopCompletionWork/' + id), { ...work, queuedAt: serverTimestamp() }));
});
test('queue reads follow stop access and deletes and forged backend fields are denied', async () => {
  const id = await stop();
  await completion(tech, id, 'tech');
  await getDoc(doc(tech, prefix + 'serviceStopCompletionWork/' + id));
  await getDoc(doc(editor, prefix + 'serviceStopCompletionWork/' + id));
  await denied(getDoc(doc(outsider, prefix + 'serviceStopCompletionWork/' + id)));
  await denied(deleteDoc(doc(tech, prefix + 'serviceStopCompletionWork/' + id)));
  await denied(updateDoc(doc(editor, prefix + 'serviceStopCompletionWork/' + id), { result: 'forged' }));
  await denied(updateDoc(doc(tech, prefix + 'serviceStops/' + id), { completionWorkStatus: 'completed' }));
  await updateDoc(doc(tech, prefix + 'serviceStops/' + id), { notes: 'Ordinary execution still works' });
});
after(async () => {
  for (const { app, store } of clients) { await terminate(store); await deleteApp(app); }
  await admin.app().delete();
});
