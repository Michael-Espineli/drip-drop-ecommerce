const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCatalogMerge, createCatalogProductDeletion } = require('./catalogMerge');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');

const company = 'companies/pool';
const products = `${company}/settings/genericItems/genericItems`;
const vendors = `${company}/settings/dataBase/dataBase`;
const dosages = `${company}/settings/dosages/dosages`;
const when = new Date('2026-11-18T12:00:00Z');
const fixture = (records = {}) => new MemoryFirestore({
  [company]: { ownerId: 'owner' },
  'users/editor/userAccess/pool': { roleId: 'editor' },
  'users/reader/userAccess/pool': { roleId: 'reader' },
  [`${company}/roles/editor`]: { permissionIdList: ['850', '854'] },
  [`${company}/roles/reader`]: { permissionIdList: ['850'] },
  'users/deleter/userAccess/pool': { roleId: 'deleter' },
  [`${company}/roles/deleter`]: { permissionIdList: ['856'] },
  ...records,
});
const request = (db, kind, keepId, sourceId, uid = 'editor') => {
  const call = createCatalogMerge(db, () => when);
  return (action = 'preview', reviewToken) => call({
    auth: uid ? { uid } : undefined,
    data: { companyId: 'pool', kind, keepId, sourceId, action, reviewToken },
  });
};
const get = async (db, path) => (await db.doc(path).get()).data();

test('product merge joins live supplier links and keeps the prior cost and historical snapshots', async () => {
  const receipt = { itemId: 'a-supplier', genericItemId: 'source', price: 2000 };
  const db = fixture({
    [`${products}/keep`]: { commonName: 'Pump motor', sellPrice: 9000 },
    [`${products}/source`]: { commonName: 'Pool pump motor', sellPrice: 7500, vendorItemIds: ['legacy', 'unrelated'], availableForJobs: true },
    [`${products}/other`]: { name: 'Other' },
    [`${vendors}/z-supplier`]: { name: 'Existing supplier', productId: 'keep', genericItemId: 'keep', rate: 3000 },
    [`${vendors}/a-supplier`]: { name: 'Second supplier', genericItemId: 'source', rate: 2000 },
    [`${vendors}/legacy`]: { name: 'Legacy supplier', rate: 2200 },
    [`${vendors}/unrelated`]: { name: 'Unrelated supplier', productId: 'other', genericItemId: 'source' },
    [`${company}/purchasedItems/receipt`]: receipt,
    [`${company}/workOrders/job`]: { products: [{ productId: 'source', sellPrice: 7500 }] },
  });
  const merge = request(db, 'product', 'keep', 'source');
  const preview = await merge();
  assert.deepEqual(preview.summary, { vendorItemsToMove: 2, preferredVendorItem: 'Existing supplier' });
  assert.equal((await get(db, `${products}/source`)).active, undefined);
  assert.deepEqual(await merge('merge', preview.reviewToken), { status: 'merged', keepId: 'keep' });
  const keeper = await get(db, `${products}/keep`);
  assert.equal(keeper.sellPrice, 9000);
  assert.equal(keeper.preferredVendorItemId, 'z-supplier');
  assert.deepEqual(keeper.vendorItemIds, ['a-supplier', 'legacy', 'z-supplier']);
  assert.deepEqual(keeper.mergedSourceIds, ['source']);
  const source = await get(db, `${products}/source`);
  assert.equal(source.sellPrice, 7500);
  assert.equal(source.defaultCostCents, 2000);
  assert.equal(source.archived, true);
  assert.equal(source.availableForJobs, false);
  assert.equal(source.mergedIntoProductId, 'keep');
  assert.equal(source.mergedBy, 'editor');
  for (const id of ['legacy', 'a-supplier']) {
    const vendor = await get(db, `${vendors}/${id}`);
    assert.equal(vendor.productId, 'keep');
    assert.equal(vendor.genericItemId, 'keep');
    assert.equal(vendor.productName, 'Pump motor');
  }
  assert.equal((await get(db, `${vendors}/unrelated`)).productId, 'other');
  assert.deepEqual(await get(db, `${company}/purchasedItems/receipt`), receipt);
  assert.deepEqual(await get(db, `${company}/workOrders/job`), { products: [{ productId: 'source', sellPrice: 7500 }] });
  assert.deepEqual(await merge('merge', preview.reviewToken), { status: 'merged', keepId: 'keep' });
});

test('vendor merge transfers product preference and legacy dosage links while keeping the chosen cost', async () => {
  const db = fixture({
    [`${vendors}/keep`]: { name: 'Chlorine', storeName: 'Supplier', sku: 'CHL', rate: 7400 },
    [`${vendors}/source`]: { name: 'Chlorine, legacy', venderId: 'supplier-1', storeName: 'Supplier', sku: 'CHL', rate: 6000, genericItemId: 'product' },
    [`${products}/product`]: { name: 'Chlorine', sellPrice: 10000, storeItemsIds: ['source'], preferredVendorItemId: 'source' },
    [`${dosages}/pools`]: { linkedItem: 'source, other', linkedItemId: 'source' },
    [`${dosages}/spas`]: { linkedItemIds: ['keep', 'source'] },
  });
  const merge = request(db, 'vendorItem', 'keep', 'source');
  const preview = await merge();
  assert.equal(preview.summary.dosageTemplates, 2);
  assert.equal(preview.summary.connectedProduct, 'Chlorine');
  await merge('merge', preview.reviewToken);
  const keeper = await get(db, `${vendors}/keep`);
  assert.equal(keeper.rate, 7400);
  assert.equal(keeper.vendorId, 'supplier-1');
  assert.equal(keeper.productId, 'product');
  const source = await get(db, `${vendors}/source`);
  assert.equal(source.rate, 6000);
  assert.equal(source.genericItemId, '');
  assert.equal(source.mergedIntoVendorItemId, 'keep');
  const product = await get(db, `${products}/product`);
  assert.equal(product.preferredVendorItemId, 'keep');
  assert.deepEqual(product.vendorItemIds, ['keep']);
  assert.equal(product.sellPrice, 10000);
  assert.deepEqual((await get(db, `${dosages}/pools`)).linkedItemIds, ['keep', 'other']);
  assert.deepEqual((await get(db, `${dosages}/spas`)).linkedItemIds, ['keep']);
});

test('vendor merge rejects different suppliers and different connected products', async () => {
  const db = fixture({
    [`${vendors}/keep`]: { name: 'Valve', venderId: 'a', productId: 'product-a' },
    [`${vendors}/source`]: { name: 'Valve', vendorId: 'b' },
    [`${products}/product-a`]: { name: 'Valve' },
    [`${products}/product-b`]: { name: 'Other valve', vendorItemIds: ['source'] },
  });
  const merge = request(db, 'vendorItem', 'keep', 'source');
  await assert.rejects(merge(), { code: 'failed-precondition', message: /same supplier/ });
  await db.doc(`${vendors}/source`).set({ vendorId: 'a' }, { merge: true });
  await assert.rejects(merge(), { code: 'failed-precondition', message: /different products/ });
  assert.equal((await get(db, `${vendors}/source`)).mergedIntoVendorItemId, undefined);
});

test('merge requires catalog edit permission, a fresh preview, and company-scoped record IDs', async () => {
  const db = fixture({
    [`${products}/keep`]: { name: 'Screws' },
    [`${products}/source`]: { name: 'Screws', sellPrice: 500 },
    'companies/other/settings/genericItems/genericItems/outside': { name: 'Screws' },
  });
  await assert.rejects(request(db, 'product', 'keep', 'source', 'reader')(), { code: 'permission-denied' });
  await assert.rejects(request(db, 'product', 'keep', 'source', 'outsider')(), { code: 'permission-denied' });
  await assert.rejects(request(db, 'product', 'keep', 'outside')(), { code: 'not-found' });
  const merge = request(db, 'product', 'keep', 'source');
  await assert.rejects(merge('merge'), { code: 'aborted' });
  const preview = await merge();
  db.beforeCommit = () => db.set(`${products}/source`, { sellPrice: 700 }, { merge: true });
  await assert.rejects(merge('merge', preview.reviewToken), { code: 'aborted' });
  assert.equal((await get(db, `${products}/source`)).archived, undefined);
  await merge('merge', (await merge()).reviewToken);
  assert.equal((await get(db, `${products}/source`)).sellPrice, 700);
});

test('product and selected vendor deletions clear live links and preserve receipts', async () => {
  const receipt = { itemId: 'delete', genericItemId: 'product', price: 2000 };
  const db = fixture({
    [`${products}/product`]: { name: 'Valve', storeItemsIds: ['delete', 'keep'] },
    [`${vendors}/delete`]: { name: 'Delete this vendor entry', rate: 2000 },
    [`${vendors}/keep`]: { name: 'Keep this vendor entry', rate: 3300, productId: 'product', genericItemId: 'product' },
    [`${company}/purchasedItems/receipt`]: receipt,
    [`${dosages}/usage`]: { linkedItem: 'delete, keep', linkedItemIds: ['delete'] },
  });
  const remove = createCatalogProductDeletion(db, () => when);
  const data = { companyId: 'pool', productId: 'product', vendorItemIds: ['delete'] };
  await assert.rejects(remove({ data, auth: { uid: 'editor' } }), { code: 'permission-denied' });
  await remove({ data, auth: { uid: 'deleter' } });
  assert.equal(await get(db, `${products}/product`), undefined);
  assert.equal(await get(db, `${vendors}/delete`), undefined);
  const keeper = await get(db, `${vendors}/keep`);
  assert.equal(keeper.productId, '');
  assert.equal(keeper.genericItemId, '');
  assert.equal(keeper.rate, 3300);
  assert.deepEqual((await get(db, `${dosages}/usage`)).linkedItemIds, ['keep']);
  assert.deepEqual(await get(db, `${company}/purchasedItems/receipt`), receipt);
});

test('product deletion leaves all records intact if the selected vendor item is shared or merge-protected', async () => {
  const db = fixture({
    [`${products}/product`]: { name: 'Valve' },
    [`${products}/other`]: { name: 'Other valve', preferredVendorItemId: 'vendor' },
    [`${vendors}/vendor`]: { name: 'Valve', productId: 'product', rate: 2000 },
  });
  const remove = createCatalogProductDeletion(db, () => when);
  const request = { auth: { uid: 'deleter' }, data: { companyId: 'pool', productId: 'product', vendorItemIds: ['vendor'] } };
  await assert.rejects(remove(request), { code: 'failed-precondition', message: /linked to another product/ });
  await db.doc(`${products}/other`).set({ preferredVendorItemId: '' }, { merge: true });
  await db.doc(`${vendors}/vendor`).set({ mergedSourceIds: ['old-vendor'] }, { merge: true });
  await assert.rejects(remove(request), { code: 'failed-precondition', message: /kept for catalog history/ });
  assert.equal((await get(db, `${vendors}/vendor`)).productId, 'product');
  assert.equal((await get(db, `${products}/product`)).name, 'Valve');
});

test('Firestore executes catalog merges and optional deletions while protecting merge history', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  const admin = require('firebase-admin');
  const { initializeApp, deleteApp } = require('firebase/app');
  const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, terminate } = require('firebase/firestore');
  const projectId = 'demo-dripdrop-workflow';
  const app = admin.initializeApp({ projectId }, 'catalog-merge-test');
  const db = app.firestore();
  const clientApp = initializeApp({ projectId, apiKey: 'emulator' }, 'catalog-merge-client');
  const client = getFirestore(clientApp);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(client, host, Number(port), { mockUserToken: { sub: 'owner', user_id: 'owner' } });
  try {
    const batch = db.batch();
    batch.set(db.doc(company), { ownerId: 'owner' });
    batch.set(db.doc(`${vendors}/keep`), { name: 'Valve', rate: 1500, vendorId: 'supplier' });
    batch.set(db.doc(`${vendors}/source`), { name: 'Valve', rate: 1700, vendorId: 'supplier', genericItemId: 'product' });
    batch.set(db.doc(`${products}/product`), { name: 'Valve', storeItemsIds: ['source'] });
    batch.set(db.doc(`${dosages}/test`), { linkedItem: 'source' });
    await batch.commit();
    const merge = request(db, 'vendorItem', 'keep', 'source', 'owner');
    const preview = await merge();
    await merge('merge', preview.reviewToken);
    const keeper = doc(client, `${vendors}/keep`);
    const source = doc(client, `${vendors}/source`);
    assert.equal((await getDoc(source)).data().mergedIntoVendorItemId, 'keep');
    assert.equal((await get(db, `${dosages}/test`)).linkedItemId, 'keep');
    await updateDoc(keeper, { name: 'Valve, updated' });
    await assert.rejects(updateDoc(source, { rate: 20 }), { code: 'permission-denied' });
    await assert.rejects(deleteDoc(source), { code: 'permission-denied' });
    await assert.rejects(deleteDoc(keeper), { code: 'permission-denied' });
    await assert.rejects(updateDoc(keeper, { mergedSourceIds: [] }), { code: 'permission-denied' });
    await assert.rejects(setDoc(doc(client, `${vendors}/forged`), { mergedIntoVendorItemId: 'keep' }), { code: 'permission-denied' });

    await db.doc(`${products}/deletable`).set({ name: 'Filter' });
    await db.doc(`${vendors}/filter`).set({ name: 'Filter', productId: 'deletable' });
    const remove = createCatalogProductDeletion(db);
    await remove({ auth: { uid: 'owner' }, data: { companyId: 'pool', productId: 'deletable', vendorItemIds: ['filter'] } });
    assert.equal((await db.doc(`${products}/deletable`).get()).exists, false);
    assert.equal((await db.doc(`${vendors}/filter`).get()).exists, false);
  } finally {
    await terminate(client);
    await deleteApp(clientApp);
    await app.delete();
  }
});
