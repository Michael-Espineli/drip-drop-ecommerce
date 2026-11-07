const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { initializeApp, deleteApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, query, where, terminate } = require('firebase/firestore');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Local Firestore emulator required.');
const projectId = 'demo-agreement-visibility';
admin.initializeApp({ projectId });
const db = admin.firestore(), clients = [];
const statuses = ['sent', 'revised', 'accepted', 'superseded', 'canceled', 'rejected', 'expired'];
function client(uid, verified = true) {
  const app = initializeApp({ projectId, apiKey: 'local-test' }, `${uid}-${verified}`);
  const store = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(store, host, Number(port), { mockUserToken: { sub: uid, user_id: uid, email: 'homeowner@example.test', email_verified: verified } });
  clients.push({ app, store });
  return store;
}
const homeowner = client('homeowner'), other = client('other'), unverified = client('unverified', false), owner = client('owner');
const agreement = { companyId: 'company', customerUserId: 'homeowner', email: 'homeowner@example.test' };
const seeded = (async () => {
  const records = {
    'companies/company': { ownerId: 'owner' },
    'salesAgreements/draft-linked': { ...agreement, status: 'draft' },
    'salesAgreements/draft-unclaimed': { ...agreement, customerUserId: '', status: 'draft' },
    'salesAgreements/missing-status': agreement,
    'salesAgreements/unclaimed-sent': { ...agreement, customerUserId: '', status: 'sent' },
    'salesAgreements/foreign-sent': { ...agreement, customerUserId: 'someone-else', status: 'sent' },
    ...Object.fromEntries(statuses.map(status => [`salesAgreements/${status}`, { ...agreement, status }])),
  };
  const batch = db.batch();
  Object.entries(records).forEach(([path, value]) => batch.set(db.doc(path), value));
  await batch.commit();
})();
const denied = callback => assert.rejects(callback, error => error.code === 'permission-denied');

test('linked and email-matched homeowners cannot read drafts or records without a published status', async () => {
  await seeded;
  for (const store of [homeowner, other]) for (const id of ['draft-linked', 'draft-unclaimed', 'missing-status']) {
    await denied(() => getDoc(doc(store, `salesAgreements/${id}`)));
  }
});
test('linked homeowners can query every published lifecycle status, while a query including drafts is denied', async () => {
  await seeded;
  const result = await getDocs(query(collection(homeowner, 'salesAgreements'), where('customerUserId', '==', 'homeowner'), where('status', 'in', statuses)));
  assert.deepEqual(result.docs.map(row => row.id).sort(), [...statuses].sort());
  await denied(() => getDocs(query(collection(homeowner, 'salesAgreements'), where('customerUserId', '==', 'homeowner'))));
  await denied(() => getDoc(doc(other, 'salesAgreements/sent')));
});
test('verified email discovery returns only published unclaimed agreements', async () => {
  await seeded;
  const result = await getDocs(query(collection(homeowner, 'salesAgreements'), where('email', '==', 'homeowner@example.test'), where('customerUserId', 'in', ['', null]), where('status', 'in', statuses)));
  assert.deepEqual(result.docs.map(row => row.id), ['unclaimed-sent']);
  await denied(() => getDoc(doc(unverified, 'salesAgreements/unclaimed-sent')));
  await denied(() => getDoc(doc(homeowner, 'salesAgreements/foreign-sent')));
});
test('the company owner retains access to drafts and unrestricted company agreement queries', async () => {
  await seeded;
  assert.equal((await getDoc(doc(owner, 'salesAgreements/draft-linked'))).exists(), true);
  const result = await getDocs(query(collection(owner, 'salesAgreements'), where('companyId', '==', 'company')));
  assert.ok(result.docs.some(row => row.id === 'draft-linked'));
});
after(async () => {
  for (const { app, store } of clients) { await terminate(store); await deleteApp(app); }
  await admin.app().delete();
});
