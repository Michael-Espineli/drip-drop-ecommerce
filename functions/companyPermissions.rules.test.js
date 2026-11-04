const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { initializeApp, deleteApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, terminate } = require('firebase/firestore');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Local emulator required.');
const projectId = 'demo-company-permissions';
admin.initializeApp({ projectId }); const db = admin.firestore(), clients = [];
function client(uid, token = {}) {
  const app = initializeApp({ projectId, apiKey: 'local-test' }, uid), store = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(store, host, Number(port), { mockUserToken: { sub: uid, user_id: uid, email: `${uid}@example.test`, email_verified: true, ...token } });
  clients.push({ app, store }); return store;
}
const empty = client('empty'), tech = client('tech'), crud = client('crud'), creator = client('creator'), editor = client('editor'), owner = client('owner'), platform = client('platform', { admin: true }), revoked = client('revoked'), outsider = client('outsider'), reader = client('reader'), author = client('author');
const p = 'companies/company/';
const seeded = (async () => {
  const records = {
    'companies/company': { ownerId: 'owner' },
    'companies/foreign': { ownerId: 'foreign-owner' },
    'featureFlags/feature_flag_001': { enabled: false },
    'users/empty': { id: 'empty', accountType: 'Company' }, 'users/outsider': { id: 'outsider', accountType: 'Client' },
    [p + 'customers/customer']: { firstName: 'Private' },
    [p + 'serviceLocations/site']: { customerId: 'customer' },
    [p + 'serviceStops/own']: { techId: 'tech', operationStatus: 'Not Finished' },
    [p + 'serviceStops/other']: { techId: 'other', operationStatus: 'Not Finished' },
    [p + 'serviceStops/own/tasks/task']: { workerId: 'tech', status: 'Scheduled' },
    [p + 'technicianRates/other']: { technicianId: 'other', amountCents: 1000 },
    [p + 'technicianPayLineItems/own']: { technicianId: 'tech', totalAmountCents: 5000 },
    [p + 'technicianPayLineItems/other']: { technicianId: 'other', totalAmountCents: 1000 },
    [p + 'companyUsers/empty']: { userId: 'empty', roleId: 'empty', roleName: 'Custom', status: 'Active' },
    [p + 'settings/emailConfiguration']: { emailIsOn: false },
    [p + 'roles/existing']: { name: 'Ordinary', permissionIdList: [] },
    [p + 'roles/1']: { name: 'Owner', permissionIdList: [] },
    [p + 'todoItems/own']: { assignedToUserId: 'tech', name: 'Own task' },
    [p + 'todoItems/other']: { assignedToUserId: 'other', name: 'Other task' },
    'chats/private': { companyId: 'company', senderCompanyId: 'company', receiverCompanyId: 'foreign', participantIds: ['author', 'tech'] },
    'messages/private': { chatId: 'private', senderId: 'author', senderCompanyId: 'company', receiverId: 'tech', text: 'Original' },
  };
  const roles = { empty: [], tech: require('./companyRoleSeeds').seedPermissions('Tech'), crud: ['10','12','14','16','40','44','260','264','830','834'], creator: ['860','862'], editor: ['860','864'], reader: ['300'], author: [] };
  for (const [uid, ids] of Object.entries(roles)) {
    records[`users/${uid}/userAccess/company`] = { roleId: uid, roleName: 'Custom', status: 'Active' };
    records[p + 'roles/' + uid] = { name: 'Custom', permissionIdList: ids };
  }
  records['users/revoked/userAccess/company'] = { roleId: 'crud', roleName: 'Manager', active: false, status: 'Active', accessStatus: 'Revoked' };
  const batch = db.batch(); Object.entries(records).forEach(([key, value]) => batch.set(db.doc(key), value)); await batch.commit();
})();
const denied = fn => assert.rejects(fn, error => error.code === 'permission-denied');
test('profile create/update cannot grant platform authority; trusted claims can administer flags', async () => {
  await seeded;
  await denied(() => updateDoc(doc(outsider, 'users/outsider'), { accountType: 'Admin' }));
  await denied(() => setDoc(doc(client('new-profile'), 'users/new-profile'), { id: 'new-profile', accountType: 'Admin' }));
  await updateDoc(doc(outsider, 'users/outsider'), { firstName: 'Updated' });
  await denied(() => updateDoc(doc(outsider, 'featureFlags/feature_flag_001'), { enabled: true }));
  await updateDoc(doc(platform, 'featureFlags/feature_flag_001'), { enabled: true });
});
test('customer CRUD requires its action grants and remains company scoped', async () => {
  await seeded;
  for (const store of [empty, revoked, outsider]) {
    await denied(() => getDoc(doc(store, p + 'customers/customer')));
    await denied(() => updateDoc(doc(store, p + 'customers/customer'), { firstName: 'Forbidden' }));
    await denied(() => setDoc(doc(store, p + 'customers/forged'), { firstName: 'Forbidden' }));
    await denied(() => deleteDoc(doc(store, p + 'customers/customer')));
  }
  await getDoc(doc(crud, p + 'customers/customer')); await setDoc(doc(crud, p + 'customers/created'), { firstName: 'Created' });
  await updateDoc(doc(crud, p + 'customers/created'), { firstName: 'Updated' }); await deleteDoc(doc(crud, p + 'customers/created'));
  await denied(() => setDoc(doc(crud, 'companies/foreign/customers/forged'), { firstName: 'Forbidden' }));
});
test('assigned technician completes own stop/task but not another stop, assignment or pay', async () => {
  await seeded; await updateDoc(doc(tech, p + 'serviceStops/own'), { operationStatus: 'Finished' });
  await updateDoc(doc(tech, p + 'serviceStops/own/tasks/task'), { status: 'Finished' });
  await denied(() => updateDoc(doc(tech, p + 'serviceStops/other'), { operationStatus: 'Finished' }));
});
test('assignment and payroll fields stay protected from ordinary workers', async () => {
  await seeded;
  await denied(() => updateDoc(doc(tech, p + 'serviceStops/own'), { techId: 'other' }));
  await denied(() => updateDoc(doc(tech, p + 'serviceStops/own'), { manualPayOverrideCents: 999999 }));
  await denied(() => updateDoc(doc(tech, p + 'technicianRates/other'), { amountCents: 999999 }));
});
test('direct invitation and membership privilege writes are server-only', async () => {
  await seeded;
  await denied(() => setDoc(doc(empty, 'invites/forged'), { companyId: 'company', roleId: '1', roleName: 'Manager' }));
  await denied(() => updateDoc(doc(empty, p + 'companyUsers/empty'), { roleName: 'Manager' }));
  await denied(() => updateDoc(doc(crud, p + 'companyUsers/empty'), { roleId: '1' }));
  await denied(() => updateDoc(doc(empty, 'users/empty/userAccess/company'), { roleName: 'Manager' }));
});
test('role creation, editing and deletion are distinct and cannot increase authority', async () => {
  await seeded;
  await setDoc(doc(creator, p + 'roles/new'), { name: 'Ordinary', permissionIdList: [] });
  await denied(() => updateDoc(doc(creator, p + 'roles/new'), { name: 'Changed' }));
  await denied(() => deleteDoc(doc(creator, p + 'roles/new')));
  await updateDoc(doc(editor, p + 'roles/existing'), { name: 'Changed' });
  await denied(() => setDoc(doc(editor, p + 'roles/by-editor'), { name: 'Ordinary', permissionIdList: [] }));
  await denied(() => updateDoc(doc(editor, p + 'roles/existing'), { permissionIdList: ['424'] }));
  await denied(() => updateDoc(doc(editor, p + 'roles/editor'), { permissionIdList: [] }));
  await denied(() => updateDoc(doc(editor, p + 'roles/1'), { name: 'Changed' }));
  await setDoc(doc(owner, p + 'roles/owner-created'), { name: 'Payroll', permissionIdList: ['420','424'] });
});
test('seeded technician has no role administration, payroll management or invitation grants', async () => {
  await seeded; const ids = require('./companyRoleSeeds').seedPermissions('Tech');
  for (const id of ['262','264','266','862','864','866','420','424','890']) assert.ok(!ids.includes(id));
  await denied(() => updateDoc(doc(tech, p + 'roles/tech'), { permissionIdList: ['424'] }));
});
test('chat participants and 300 readers cannot alter other senders or rewrite chat identity', async () => {
  await seeded; await denied(() => getDoc(doc(empty, 'chats/private'))); await denied(() => getDoc(doc(empty, 'messages/private')));
  for (const store of [tech, reader]) {
    await getDoc(doc(store, 'chats/private')); await getDoc(doc(store, 'messages/private'));
    await denied(() => updateDoc(doc(store, 'messages/private'), { text: 'Forged' }));
    await denied(() => deleteDoc(doc(store, 'messages/private')));
    await denied(() => updateDoc(doc(store, 'chats/private'), { participantIds: ['empty'] }));
    await updateDoc(doc(store, 'messages/private'), { read: true });
  }
  await updateDoc(doc(author, 'messages/private'), { text: 'Author edit' });
});
test('todo and own-pay access do not grant company-wide data', async () => {
  await seeded; await getDoc(doc(tech, p + 'todoItems/own')); await denied(() => getDoc(doc(tech, p + 'todoItems/other')));
  await getDocs(query(collection(tech, p + 'technicianPayLineItems'), where('technicianId', '==', 'tech')));
  await denied(() => getDoc(doc(tech, p + 'technicianPayLineItems/other')));
});
test('settings edits require action permission, not merely membership or area viewing', async () => {
  await seeded; await denied(() => updateDoc(doc(empty, p + 'settings/emailConfiguration'), { emailIsOn: true }));
  await updateDoc(doc(crud, p + 'settings/emailConfiguration'), { emailIsOn: true });
});
after(async () => { for (const { app, store } of clients) { await terminate(store); await deleteApp(app); } await admin.app().delete(); });
