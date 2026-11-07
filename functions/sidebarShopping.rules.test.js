const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { initializeApp, deleteApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, terminate } = require('firebase/firestore');

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('This test requires the local Firestore emulator.');
const projectId = 'demo-sidebar-error-fixes';
const adminApp = admin.initializeApp({ projectId }, 'sidebar-shopping-rules');
const db = adminApp.firestore();
const clients = [];
const collections = ['shoppingList', 'shoppingListItems'];

function client(uid) {
  const app = initializeApp({ projectId, apiKey: 'local-test' }, `shopping-${uid || 'anonymous'}`);
  const firestore = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(firestore, host, Number(port), uid ? { mockUserToken: { sub: uid, user_id: uid } } : {});
  clients.push({ app, firestore });
  return firestore;
}

const owner = client('owner');
const reader = client('reader');
const creator = client('creator');
const editor = client('editor');
const deleter = client('deleter');
const restricted = [client('no-permissions'), client('revoked'), client('outsider'), client()];
const seeded = (async () => {
  const batch = db.batch();
  const seed = (path, data) => batch.set(db.doc(path), data);
  seed('companies/company', { ownerId: 'owner' });
  seed('companies/other-company', { ownerId: 'other-owner' });
  for (const [uid, permissions] of [['reader', ['100']], ['creator', ['102']], ['editor', ['104']], ['deleter', ['106']], ['no-permissions', []], ['revoked', ['100', '102', '104', '106']]]) {
    seed(`users/${uid}/userAccess/company`, { roleId: uid, roleName: uid, active: uid !== 'revoked' });
    seed(`companies/company/roles/${uid}`, { name: uid, permissionIdList: permissions });
  }
  for (const name of collections) {
    seed(`companies/company/${name}/item`, { status: 'Need to Purchase', name: 'Pump' });
    seed(`companies/other-company/${name}/item`, { status: 'Need to Purchase' });
  }
  await batch.commit();
})();
const denied = (operation) => assert.rejects(operation, (error) => error.code === 'permission-denied');
const path = (name, id = 'item') => `companies/company/${name}/${id}`;

test('owners and shopping readers can query current and legacy purchase-ready badges', async () => {
  await seeded;
  for (const firestore of [owner, reader]) {
    for (const name of collections) {
      const result = await getDocs(query(collection(firestore, `companies/company/${name}`), where('status', 'in', ['Need to Purchase', 'Approved'])));
      assert.equal(result.size, 1);
    }
  }
});

test('shopping read permission does not grant writes or access to another company', async () => {
  await seeded;
  for (const name of collections) {
    await denied(() => setDoc(doc(reader, path(name, 'forged')), { status: 'Approved' }));
    await denied(() => updateDoc(doc(reader, path(name)), { status: 'Purchased' }));
    await denied(() => deleteDoc(doc(reader, path(name))));
    await denied(() => getDoc(doc(reader, `companies/other-company/${name}/item`)));
  }
});

test('legacy and current mutations each require their existing create, update, and delete permission', async () => {
  await seeded;
  for (const name of collections) {
    await setDoc(doc(creator, path(name, 'new')), { status: 'Need to Purchase' });
    await denied(() => updateDoc(doc(creator, path(name, 'new')), { status: 'Purchased' }));
    await updateDoc(doc(editor, path(name, 'new')), { status: 'Purchased' });
    await denied(() => deleteDoc(doc(editor, path(name, 'new'))));
    await deleteDoc(doc(deleter, path(name, 'new')));
    await denied(() => setDoc(doc(deleter, path(name, 'new')), { status: 'Approved' }));
  }
});

test('unprivileged, revoked, outside, and anonymous users cannot read or write either shopping collection', async () => {
  await seeded;
  for (const firestore of restricted) {
    for (const name of collections) {
      await denied(() => getDocs(collection(firestore, `companies/company/${name}`)));
      await denied(() => setDoc(doc(firestore, path(name, 'forged')), { status: 'Approved' }));
      await denied(() => updateDoc(doc(firestore, path(name)), { status: 'Purchased' }));
      await denied(() => deleteDoc(doc(firestore, path(name))));
    }
  }
});

after(async () => {
  for (const { app, firestore } of clients) {
    await terminate(firestore);
    await deleteApp(app);
  }
  await adminApp.delete();
});
