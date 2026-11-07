const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { initializeApp, deleteApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, terminate } = require('firebase/firestore');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Local emulator required.');
const projectId = 'demo-task-group-storage';
admin.initializeApp({ projectId });
const clients = [];
function client(uid) {
  const app = initializeApp({ projectId, apiKey: 'local-test' }, uid), store = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(store, host, Number(port), { mockUserToken: { sub: uid, user_id: uid } });
  clients.push({ app, store }); return store;
}
const creator = client('creator'), editor = client('editor'), remover = client('remover'), reader = client('reader'), outsider = client('outsider');
const p = 'companies/company/settings/taskGroup/taskGroup';
const seeded = (async () => {
  const db = admin.firestore(), batch = db.batch();
  const records = {
    'companies/company': { ownerId: 'owner' },
    [`${p}/existing`]: { name: 'Weekly Service' },
    [`${p}/existing/taskItems/task`]: { name: 'Brush' },
    [`${p}/removable`]: { name: 'Removable' },
  };
  for (const [uid, ids] of Object.entries({ creator: ['822'], editor: ['824'], remover: ['826'], reader: [] })) {
    records[`users/${uid}/userAccess/company`] = { roleId: uid, roleName: 'Custom', status: 'Active' };
    records[`companies/company/roles/${uid}`] = { name: 'Custom', permissionIdList: ids };
  }
  for (const [path, value] of Object.entries(records)) batch.set(db.doc(path), value);
  await batch.commit();
})();
const denied = fn => assert.rejects(fn, error => error.code === 'permission-denied');

test('822 creates canonical groups and their initial taskItems without permission 900', async () => {
  await seeded; await setDoc(doc(creator, `${p}/created`), { name: 'New' });
  await setDoc(doc(creator, `${p}/created/taskItems/task`), { name: 'Brush' });
  await denied(() => updateDoc(doc(creator, `${p}/existing`), { name: 'Changed' }));
  await denied(() => deleteDoc(doc(creator, `${p}/existing`)));
});
test('824 edits group items but cannot create or delete the parent group', async () => {
  await seeded; await updateDoc(doc(editor, `${p}/existing`), { description: 'Updated' });
  const item = doc(editor, `${p}/existing/taskItems/editor-task`);
  await setDoc(item, { name: 'Skim' }); await updateDoc(item, { name: 'Skim pool' }); await deleteDoc(item);
  await denied(() => setDoc(doc(editor, `${p}/editor-group`), { name: 'Forbidden' }));
  await denied(() => deleteDoc(doc(editor, `${p}/existing`)));
});
test('826 deletes groups but cannot change their contents', async () => {
  await seeded; await deleteDoc(doc(remover, `${p}/removable`));
  await denied(() => updateDoc(doc(remover, `${p}/existing`), { name: 'Forbidden' }));
  await denied(() => setDoc(doc(remover, `${p}/existing/taskItems/forged`), { name: 'Forbidden' }));
});
test('active readers can read groups while ordinary and cross-company writes stay denied', async () => {
  await seeded; await getDoc(doc(reader, `${p}/existing`));
  await denied(() => setDoc(doc(reader, `${p}/forged`), { name: 'Forbidden' }));
  await denied(() => setDoc(doc(outsider, `${p}/forged`), { name: 'Forbidden' }));
  await denied(() => setDoc(doc(creator, 'companies/foreign/settings/taskGroup/taskGroup/forged'), { name: 'Forbidden' }));
});
test('older plural writers keep their existing grant mapping during rollout', async () => {
  await seeded; await setDoc(doc(creator, 'companies/company/settings/taskGroups/taskGroups/old-client'), { name: 'Old client' });
});
after(async () => {
  await Promise.all(clients.map(async ({ app, store }) => { await terminate(store); await deleteApp(app); }));
  await admin.app().delete();
});
