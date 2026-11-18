const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { initializeApp, deleteApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, collection, getDocs, query, where, doc, writeBatch, terminate } = require('firebase/firestore');

if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Local Firestore emulator required.');
const projectId = 'demo-payroll-finish';
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
const owner = client('owner'), roleOwner = client('role-owner'), roleAdmin = client('role-admin'), manager = client('manager'), editor = client('editor'), payroll = client('payroll'),
  tech = client('tech'), revoked = client('revoked'), outsider = client('outsider');
const prefix = 'companies/company/';
const serviceDate = new Date('2026-11-10T12:00:00Z');
const completedAt = new Date('2026-11-10T17:00:00Z');
const seeded = (async () => {
  const records = {
    'companies/company': { ownerId: 'owner' },
    'users/role-owner/userAccess/company': { roleId: 'owner', roleName: 'Owner', status: 'Active' },
    'users/role-admin/userAccess/company': { roleId: 'admin', roleName: 'Admin', status: 'Active' },
    'users/manager/userAccess/company': { roleId: 'manager', roleName: 'Manager', status: 'Active' },
    'users/editor/userAccess/company': { roleId: 'editor', roleName: 'Custom', status: 'Active' },
    'users/payroll/userAccess/company': { roleId: 'payroll', roleName: 'Payroll', status: 'Active' },
    'users/tech/userAccess/company': { roleId: 'tech', roleName: 'Tech', status: 'Active' },
    'users/revoked/userAccess/company': { roleId: 'editor', roleName: 'Custom', active: false },
    [prefix + 'roles/manager']: { name: 'Manager', permissionIdList: [] },
    [prefix + 'roles/owner']: { name: 'Owner', permissionIdList: [] },
    [prefix + 'roles/admin']: { name: 'Admin', permissionIdList: [] },
    [prefix + 'roles/editor']: { name: 'Custom', permissionIdList: ['240', '244', '420'] },
    [prefix + 'roles/payroll']: { name: 'Payroll', permissionIdList: ['420', '424'] },
    [prefix + 'roles/tech']: { name: 'Tech', permissionIdList: [] },
  };
  const batch = db.batch();
  Object.entries(records).forEach(([path, value]) => batch.set(db.doc(path), value));
  await batch.commit();
})();
let counter = 0;
async function stop(taskCount = 1) {
  await seeded;
  const id = `stop-${++counter}`, path = prefix + 'serviceStops/' + id;
  const batch = db.batch();
  batch.set(db.doc(path), { techId: 'tech', tech: 'Alex', serviceDate, operationStatus: 'Scheduled', payrollAgreement: { rateCents: 5000 } });
  for (let i = 0; i < taskCount; i++) batch.set(db.doc(`${path}/tasks/task-${i}`), {
    status: 'Scheduled', ...(i % 2 ? { workerId: 'other-tech', workerName: 'Sam' } : {}), contractedRate: 25,
  });
  await batch.commit();
  return id;
}
async function finish(store, id, { legacyWorkerWrites = false, taskPatch = {}, stopPatch = {} } = {}) {
  const path = prefix + 'serviceStops/' + id;
  const tasks = await getDocs(collection(store, path, 'tasks'));
  const batch = writeBatch(store);
  batch.update(doc(store, path), {
    operationStatus: 'Finished', startTime: new Date(completedAt.getTime() - 30 * 60000), endTime: completedAt,
    finishedAt: completedAt, completedAt, completedDate: completedAt, duration: 30, manuallyFinished: true,
    manualFinishSource: 'payroll_setup_bulk_finish', completedWithoutCustomerEmail: true, updatedAt: completedAt, ...stopPatch,
  });
  tasks.docs.forEach(task => batch.update(task.ref, {
    status: 'Finished', manualFinishSource: 'payroll_setup_bulk_finish', completedAt, updatedAt: completedAt,
    ...(legacyWorkerWrites ? { workerId: task.data().workerId || 'tech', workerName: task.data().workerName || 'Alex' } : {}),
    ...taskPatch,
  }));
  return batch.commit();
}
const denied = promise => assert.rejects(promise, error => error.code === 'permission-denied');

test('legacy payroll bulk Finish fails atomically when a stop editor fills protected worker fields', async () => {
  const id = await stop();
  await denied(finish(editor, id, { legacyWorkerWrites: true }));
  assert.equal((await db.doc(prefix + 'serviceStops/' + id).get()).data().operationStatus, 'Scheduled');
  assert.equal((await db.doc(prefix + 'serviceStops/' + id + '/tasks/task-0').get()).data().status, 'Scheduled');
});

test('legacy payroll worker writes exceed rule evaluation limits for role-based owners and admins', async () => {
  for (const store of [roleOwner, roleAdmin, manager]) {
    const id = await stop();
    await denied(finish(store, id, { legacyWorkerWrites: true }));
    assert.equal((await db.doc(prefix + 'serviceStops/' + id).get()).data().operationStatus, 'Scheduled');
  }
});

test('payroll bulk Finish succeeds for owners, admins, managers and stop editors without changing assignment or pay', async () => {
  for (const store of [owner, roleOwner, roleAdmin, manager, editor]) {
    const id = await stop(25);
    const path = prefix + 'serviceStops/' + id;
    const matches = await getDocs(query(collection(store, prefix + 'serviceStops'),
      where('serviceDate', '>=', new Date('2026-11-10T00:00:00Z')), where('serviceDate', '<=', new Date('2026-11-10T23:59:59Z'))));
    assert.ok(matches.docs.some(value => value.id === id));
    await finish(store, id);
    const result = (await db.doc(path).get()).data();
    assert.equal(result.operationStatus, 'Finished');
    assert.equal(result.completedWithoutCustomerEmail, true);
    assert.deepEqual(result.payrollAgreement, { rateCents: 5000 });
    const tasks = await db.collection(path + '/tasks').get();
    for (const task of tasks.docs) {
      assert.equal(task.data().status, 'Finished');
      assert.equal(task.data().contractedRate, 25);
      assert.equal(task.data().workerId, Number(task.id.split('-')[1]) % 2 ? 'other-tech' : undefined);
    }
  }
});

test('stop editors still cannot change payroll or assignment through bulk Finish', async () => {
  for (const options of [
    { taskPatch: { workerId: 'editor' } }, { taskPatch: { contractedRate: 9999 } },
    { stopPatch: { techId: 'editor' } }, { stopPatch: { payrollAgreement: { rateCents: 999999 } } },
  ]) {
    const id = await stop();
    await denied(finish(editor, id, options));
    assert.equal((await db.doc(prefix + 'serviceStops/' + id).get()).data().operationStatus, 'Scheduled');
  }
});

test('payroll-only, ordinary tech, revoked and outside users cannot bulk finish company stops', async () => {
  const id = await stop();
  for (const store of [payroll, tech, revoked, outsider]) {
    await denied(getDocs(query(collection(store, prefix + 'serviceStops'), where('serviceDate', '>=', serviceDate))));
    await denied(finish(store, id));
  }
});

after(async () => {
  for (const { app, store } of clients) { await terminate(store); await deleteApp(app); }
  await admin.app().delete();
});
