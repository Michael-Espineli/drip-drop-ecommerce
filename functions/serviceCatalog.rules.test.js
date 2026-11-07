const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { initializeApp, deleteApp } = require('firebase/app');
const {
  getFirestore, connectFirestoreEmulator, collection, doc, getDoc, getDocs,
  onSnapshot, setDoc, updateDoc, deleteDoc, terminate,
} = require('firebase/firestore');

const projectId = 'demo-service-catalog';
if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error('This test requires the disposable demo-service-catalog Firestore emulator.');
}
const adminApp = admin.initializeApp({ projectId }, 'service-catalog-rules');
const db = adminApp.firestore();
const clients = [];
const catalogPath = 'companies/company/salesCatalogItems';
const readPermissions = ['20', '24', '28', '72', '400', '404', '430', '432', '434', '628', '920'];
const createPermissions = ['24', '28', '72', '404', '920'];

function client(uid) {
  const app = initializeApp({ projectId, apiKey: 'local-test' }, `catalog-${uid || 'anonymous'}`);
  const store = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(store, host, Number(port), uid ? {
    mockUserToken: { sub: uid, user_id: uid },
  } : {});
  clients.push({ app, store });
  return store;
}

const owner = client('owner');
const readers = new Map(readPermissions.map(permission => [permission, client(`grant-${permission}`)]));
const restricted = ['no-permissions', 'unrelated', 'revoked', 'pending', 'outsider', 'forged-admin', ''].map(client);
const seeded = (async () => {
  const batch = db.batch();
  const seed = (path, value) => batch.set(db.doc(path), value);
  seed('companies/company', { ownerId: 'owner' });
  seed('companies/other-company', { ownerId: 'other-owner' });
  // Legacy items need not repeat companyId: reads are scoped by the company path.
  seed(`${catalogPath}/service`, { name: 'Filter clean', type: 'service', active: true });
  seed('companies/company/settings/genericItems/genericItems/product', { name: 'Filter cartridge', active: true });
  seed('companies/company/settings/dataBase/dataBase/vendor-item', { name: 'Supplier cartridge', active: true });
  seed('companies/company/companyPayTypes/service', { name: 'Service visit', active: true });
  seed('companies/other-company/salesCatalogItems/service', { name: 'Private service' });
  const roles = [
    ...readPermissions.map(permission => [`grant-${permission}`, [permission]]),
    ['no-permissions', []], ['unrelated', ['850']],
    ['revoked', readPermissions], ['pending', readPermissions], ['forged-admin', []],
  ];
  for (const [uid, permissions] of roles) {
    seed(`users/${uid}/userAccess/company`, {
      roleId: uid, roleName: uid === 'forged-admin' ? 'Admin' : uid,
      active: uid !== 'revoked', status: uid === 'pending' ? 'Pending' : 'Active',
    });
    seed(`companies/company/roles/${uid}`, { name: uid, permissionIdList: permissions });
  }
  await batch.commit();
})();

const denied = operation => assert.rejects(operation, error => error.code === 'permission-denied');
function firstSnapshot(store) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onSnapshot(collection(store, catalogPath), snapshot => {
      unsubscribe();
      resolve(snapshot);
    }, error => { unsubscribe(); reject(error); });
  });
}

test('company owners can load the exact unfiltered catalog listener used by both pages', async () => {
  await seeded;
  const snapshot = await firstSnapshot(owner);
  assert.equal(snapshot.size, 1);
  assert.equal(snapshot.docs[0].data().name, 'Filter clean');
});

test('the job template picker can load services, products, vendor items, and pay types together', async () => {
  await seeded;
  const snapshots = await Promise.all([
    getDocs(collection(owner, catalogPath)),
    getDocs(collection(owner, 'companies/company/settings/genericItems/genericItems')),
    getDocs(collection(owner, 'companies/company/settings/dataBase/dataBase')),
    getDocs(collection(owner, 'companies/company/companyPayTypes')),
  ]);
  assert.deepEqual(snapshots.map(snapshot => snapshot.size), [1, 1, 1, 1]);
});

test('finance, job, template, and service agreement readers can load their company catalog', async () => {
  await seeded;
  for (const store of readers.values()) {
    assert.equal((await getDocs(collection(store, catalogPath))).size, 1);
    assert.equal((await getDoc(doc(store, `${catalogPath}/service`))).exists(), true);
    await denied(() => getDocs(collection(store, 'companies/other-company/salesCatalogItems')));
  }
});

test('membership alone, unrelated roles, revoked/pending access, forged admin names, and anonymous access are denied', async () => {
  await seeded;
  for (const store of restricted) {
    await denied(() => firstSnapshot(store));
    await denied(() => setDoc(doc(store, `${catalogPath}/forged`), { companyId: 'company', name: 'Forged' }));
    await denied(() => updateDoc(doc(store, `${catalogPath}/service`), { name: 'Forged' }));
    await denied(() => deleteDoc(doc(store, `${catalogPath}/service`)));
  }
});

test('catalog readers cannot change reusable services', async () => {
  await seeded;
  for (const permission of readPermissions.filter(value => !createPermissions.includes(value))) {
    const store = readers.get(permission);
    await denied(() => setDoc(doc(store, `${catalogPath}/reader-${permission}`), { companyId: 'company' }));
    await denied(() => updateDoc(doc(store, `${catalogPath}/service`), { name: 'Changed' }));
    await denied(() => deleteDoc(doc(store, `${catalogPath}/service`)));
  }
});

test('job planners and template editors can create a new reusable service without changing existing services', async () => {
  await seeded;
  for (const permission of createPermissions.filter(value => value !== '404')) {
    const store = readers.get(permission);
    const ref = doc(store, `${catalogPath}/planner-${permission}`);
    await setDoc(ref, { companyId: 'company', name: 'New planned service', active: true });
    await denied(() => updateDoc(ref, { name: 'Changed existing service' }));
    await denied(() => deleteDoc(ref));
  }
});

test('billing managers and company owners can create, edit, archive, and delete catalog services', async () => {
  await seeded;
  for (const [uid, store] of [['owner', owner], ['billing', readers.get('404')]]) {
    const ref = doc(store, `${catalogPath}/managed-${uid}`);
    await setDoc(ref, { companyId: 'company', name: 'Managed service', active: true });
    await updateDoc(ref, { name: 'Updated service' });
    await updateDoc(ref, { active: false });
    await deleteDoc(ref);
  }
});

test('catalog writes cannot name another company or move a service between companies', async () => {
  await seeded;
  for (const store of [owner, ...createPermissions.map(permission => readers.get(permission))]) {
    await denied(() => setDoc(doc(store, `${catalogPath}/wrong-company`), { companyId: 'other-company' }));
    await denied(() => setDoc(doc(store, `${catalogPath}/missing-company`), { name: 'Missing company' }));
    await denied(() => setDoc(doc(store, 'companies/other-company/salesCatalogItems/forged'), { companyId: 'other-company' }));
  }
  for (const store of [owner, readers.get('404')]) {
    await denied(() => updateDoc(doc(store, `${catalogPath}/service`), { companyId: 'other-company' }));
  }
});

after(async () => {
  for (const { app, store } of clients) { await terminate(store); await deleteApp(app); }
  await adminApp.delete();
});
