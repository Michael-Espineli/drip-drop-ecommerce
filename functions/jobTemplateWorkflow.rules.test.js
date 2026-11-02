const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { initializeApp, deleteApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, Timestamp, terminate } = require('firebase/firestore');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Run against the local Firestore emulator only.');
const projectId = 'demo-dripdrop-workflow';
admin.initializeApp({ projectId });
const store = admin.firestore(), companyId = 'template-workflow', p = `companies/${companyId}/`;
const users = {};
function client(uid) {
  const app = initializeApp({ projectId, apiKey: 'local-test' }, `templates-${uid}`);
  const db = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port), { mockUserToken: { sub: uid, user_id: uid } });
  users[uid] = { app, db };
  return db;
}
const permissions = { full: ['22'], self: ['23'], others: ['29'], custom: ['27'], customOthers: ['31'], stopOnly: ['252'], editor: ['820'], none: [], owner: [], 'someone-else': [] };
Object.keys(permissions).forEach(client);
const seeded = (async () => {
  const batch = store.batch();
  batch.set(store.doc(`companies/${companyId}`), { ownerId: 'owner' });
  Object.entries(permissions).forEach(([uid, permissionIdList]) => {
    batch.set(store.doc(`users/${uid}/userAccess/${companyId}`), { roleId: uid, roleName: 'Team Member' });
    batch.set(store.doc(p + `roles/${uid}`), { permissionIdList });
  });
  for (const [id, values] of Object.entries({ field: { isActive: true, technicianCanAdd: true }, office: { isActive: true, technicianCanAdd: false }, inactive: { isActive: false, technicianCanAdd: true }, legacyInactive: { active: false, technicianCanAdd: true } })) {
    batch.set(store.doc(p + `jobTemplates/${id}`), { id, ...values });
    batch.set(store.doc(p + `jobTemplates/${id}/tasks/source`), { name: 'Approved task', contractedRate: 2000, payTypeId: 'repair', payrollMode: 'automatic' });
    batch.set(store.doc(p + `jobTemplates/${id}/tasks/zero`), { name: 'Approved zero override', contractedRate: 0, manualPayOverrideCents: 0, payrollMode: 'custom' });
    for (let index = 0; index < 6; index++) batch.set(store.doc(p + `jobTemplates/${id}/tasks/source-${index}`), { name: `Task ${index}`, contractedRate: 2000, payTypeId: 'repair', payrollMode: 'automatic' });
  }
  await batch.commit();
})();
let sequence = 0;
async function create(uid, { template = 'field', worker = uid, visit = true, task = false, taskCount = 1, rate = 2000, taskSource = 'source', taskPay = {}, extraWorker, jobId = `new-${++sequence}` } = {}) {
  await seeded;
  const db = users[uid].db, batch = writeBatch(db), stopId = `visit-${jobId}`;
  const job = { id: jobId, sourceTemplateId: template, customerId: 'customer', serviceLocationId: 'site', createdByUserId: uid, operationStatus: 'Scheduled', billingStatus: 'Draft', serviceStopIds: visit ? [stopId] : [], ...(visit ? { scheduledServiceStopId: stopId } : {}) };
  batch.set(doc(db, p + `workOrders/${jobId}`), job);
  const stop = { jobId, techId: worker, customerId: 'customer', serviceLocationId: 'site', serviceDate: Timestamp.fromDate(new Date()), operationStatus: 'Not Finished' };
  if (visit) batch.set(doc(db, p + `serviceStops/${stopId}`), stop);
  if (extraWorker) batch.set(doc(db, p + `serviceStops/extra-${jobId}`), { ...stop, techId: extraWorker });
  if (task) {
    for (let index = 0; index < taskCount; index++) {
      const taskId = taskCount === 1 ? 'copied' : `copied-${index}`;
      const sourceId = taskCount === 1 ? taskSource : `${taskSource}-${index}`;
      const row = { name: 'Approved task', sourceTemplateTaskId: sourceId, sourceTemplateId: template, status: 'Scheduled', actualTime: 0, workerId: worker, contractedRate: rate, payTypeId: 'repair', payrollMode: 'automatic', serviceStopId: { id: stopId }, ...taskPay };
      batch.set(doc(db, p + `workOrders/${jobId}/tasks/${taskId}`), row);
      batch.set(doc(db, p + `serviceStops/${stopId}/tasks/${taskId}`), { ...row, jobTaskId: taskId, jobId: { id: jobId } });
    }
  }
  await batch.commit();
  return jobId;
}
const denied = (fn) => assert.rejects(fn, (error) => error.code === 'permission-denied');

test('company membership and standalone stop permissions cannot grant job creation', async () => {
  await denied(() => create('none', { template: '' }));
  await denied(() => create('stopOnly', { template: '' }));
});
test('technicians can atomically copy approved template pay and self-schedule', async () => {
  const id = await create('self', { task: true });
  const snapshot = await getDoc(doc(users.self.db, p + `workOrders/${id}`));
  assert.equal(snapshot.data().scheduledServiceStopId, `visit-${id}`);
  await denied(() => updateDoc(doc(users.self.db, p + `workOrders/${id}/tasks/copied`), { contractedRate: 9000 }));
  await denied(() => create('self', { task: true, rate: 9000 }));
});
test('template availability and activity are enforced independently of picker UI', async () => {
  for (const template of ['office', 'inactive', 'legacyInactive', 'missing']) await denied(() => create('self', { template }));
});
test('template self/others permissions apply to every initial visit', async () => {
  await denied(() => create('self', { worker: 'someone-else' }));
  await denied(() => create('self', { extraWorker: 'someone-else' }));
  await create('others', { worker: 'someone-else', task: true });
  await denied(() => create('others', { worker: 'outside-company' }));
});
test('approved template overrides including zero survive copying without allowing forged pay', async () => {
  await create('self', { task: true, taskSource: 'zero', rate: 0, taskPay: { payTypeId: '', payrollMode: 'custom', manualPayOverrideCents: 0 } });
  await denied(() => create('self', { task: true, taskSource: 'zero', rate: 0, taskPay: { payTypeId: '', payrollMode: 'custom', manualPayOverrideCents: 5000 } }));
  await denied(() => create('self', { task: true, taskPay: { payrollAgreement: { offerId: 'forged' } } }));
});
test('custom self/others permissions work without granting template creation', async () => {
  await create('custom', { template: '', task: true, rate: 0 });
  await denied(() => create('custom', { template: '', worker: 'someone-else' }));
  await create('customOthers', { template: '', worker: 'someone-else' });
  await denied(() => create('custom', { template: 'field' }));
  await denied(() => create('self', { template: '' }));
});
test('limited creation cannot leave an unscheduled job or reuse an existing visit', async () => {
  const id = 'unscheduled-attempt';
  await denied(() => create('self', { visit: false, jobId: id }));
  assert.equal((await store.doc(p + `workOrders/${id}`).get()).exists, false);
  await store.doc(p + 'serviceStops/old-stop').set({ jobId: 'reused', techId: 'self', serviceDate: new Date(), customerId: 'customer', serviceLocationId: 'site' });
  await denied(() => setDoc(doc(users.self.db, p + 'workOrders/reused'), { sourceTemplateId: 'field', createdByUserId: 'self', operationStatus: 'Scheduled', billingStatus: 'Draft', customerId: 'customer', serviceLocationId: 'site', serviceStopIds: ['old-stop'], scheduledServiceStopId: 'old-stop' }));
});
test('full creators can use active office templates and create without scheduling', async () => {
  await create('full', { template: 'office', visit: false });
  await create('owner', { template: 'office', visit: false });
  await denied(() => create('full', { template: 'inactive', visit: false }));
  await denied(() => create('owner', { template: 'legacyInactive', visit: false }));
});
test('template metadata and all scope collections require template management', async () => {
  await seeded;
  await denied(() => updateDoc(doc(users.self.db, p + 'jobTemplates/office'), { technicianCanAdd: true }));
  await denied(() => setDoc(doc(users.self.db, p + 'jobTemplates/field/tasks/forged'), { contractedRate: 999999 }));
  await denied(() => deleteDoc(doc(users.self.db, p + 'jobTemplates/field')));
  const batch = writeBatch(users.editor.db);
  batch.set(doc(users.editor.db, p + 'jobTemplates/new-template'), { name: 'Complete template', isActive: true });
  for (const type of ['tasks', 'plannedServiceStops', 'laborLineItems', 'shoppingItems']) batch.set(doc(users.editor.db, p + `jobTemplates/new-template/${type}/item`), { name: type });
  await batch.commit();
});
test('limited creators cannot relabel the template or reassign a created job directly', async () => {
  const id = await create('self');
  await denied(() => updateDoc(doc(users.self.db, p + `workOrders/${id}`), { sourceTemplateId: 'office' }));
  await denied(() => updateDoc(doc(users.self.db, p + `workOrders/${id}`), { assignedTechId: 'someone-else' }));
  await updateDoc(doc(users.self.db, p + `workOrders/${id}`), { operationStatus: 'In Progress' });
});
test('a template with several distinct paid tasks stays within the rule evaluation budget', async () => {
  await create('others', { worker: 'someone-else', task: true, taskCount: 6 });
});
test('template managers can reactivate a legacy template by updating both availability fields', async () => {
  await seeded;
  await updateDoc(doc(users.editor.db, p + 'jobTemplates/legacyInactive'), { isActive: true, active: true });
  await create('self', { template: 'legacyInactive' });
});
after(async () => {
  for (const { app, db } of Object.values(users)) { await terminate(db); await deleteApp(app); }
  await admin.app().delete();
});
