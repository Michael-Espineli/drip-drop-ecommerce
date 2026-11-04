const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');
const { authority, delegatedRole, requirePermission } = require('./companyAuthorization');
const { isPlatformAdmin } = require('./platformAccess');
const { createTechnicianWorkWorkflow } = require('./technicianWorkWorkflow');
const { createTechnicianTime } = require('./technicianTime');
const base = () => ({
  'companies/company': { ownerId: 'owner' },
  'users/tech/userAccess/company': { roleId: 'tech', roleName: 'Technician', active: true },
  'companies/company/roles/tech': { name: 'Technician', permissionIdList: ['10','262'] },
  'companies/company/roles/viewer': { name: 'Viewer', permissionIdList: ['10'] },
  'companies/company/roles/admin': { name: 'Manager', permissionIdList: ['10'] },
  'companies/company/roles/payroll': { name: 'Payroll', permissionIdList: ['424'] },
  'companies/company/roles/delegator': { name: 'Delegator', permissionIdList: ['262'] },
  'companies/company/companyUsers/tech': { userId: 'tech', workerType: 'Employee', status: 'Active' },
  'users/profile-admin': { accountType: 'Admin' },
});
test('platform authority uses trusted claims and never user profile accountType', async () => {
  assert.equal(isPlatformAdmin('profile-admin', {}), false);
  assert.equal(isPlatformAdmin('trusted', { admin: true }), true);
  await assert.rejects(authority(new MemoryFirestore(base()), 'profile-admin', 'company'), { code: 'permission-denied' });
});
test('delegation allows a valid subset and rejects administrative names, additional and recursive authority', async () => {
  const db = new MemoryFirestore(base()), actor = await requirePermission(db, 'tech', 'company', '262');
  assert.equal((await delegatedRole(db, actor, 'viewer')).name, 'Viewer');
  for (const role of ['admin','payroll','delegator','missing']) await assert.rejects(delegatedRole(db, actor, role), { code: 'permission-denied' });
  const owner = await requirePermission(db, 'owner', 'company', '262');
  assert.equal((await delegatedRole(db, owner, 'payroll')).name, 'Payroll');
});
test('every inactive alias blocks authorization, offered work and clocks before any write', async () => {
  for (const status of [{active:false},{isActive:false},{accessActive:false},{revoked:true},{status:'Revoked'},{userStatus:'Inactive'},{companyUserStatus:'Pending'},{accessStatus:'Expired'},{userAccessStatus:'Past'}]) {
    const records = base(); Object.assign(records['users/tech/userAccess/company'], status);
    const db = new MemoryFirestore(records), work = createTechnicianWorkWorkflow(db), clock = createTechnicianTime(db);
    await assert.rejects(work.command({ auth: {uid:'tech'}, data: {companyId:'company',action:'list'} }), {code:'permission-denied'});
    await assert.rejects(clock.command({ auth: {uid:'tech'}, data: {companyId:'company',action:'clockIn',requestId:'one'} }), {code:'permission-denied'});
    assert.deepEqual(Object.fromEntries(db.records), records);
  }
});
test('inactive company-user rows also block commands; owners retain access without a membership', async () => {
  const records = base(); records['companies/company/companyUsers/tech'].status = 'Inactive';
  await assert.rejects(authority(new MemoryFirestore(records), 'tech', 'company'), { code: 'permission-denied' });
  assert.equal((await authority(new MemoryFirestore(records), 'owner', 'company')).admin, true);
});

// Exercise the actual exported callable handlers with local Firebase doubles.
admin.initializeApp({ projectId: 'demo-company-authorization' });
const store = new MemoryFirestore(base()), firestore = admin.firestore();
firestore.collection = (...args) => store.collection(...args);
firestore.collectionGroup = (...args) => store.collectionGroup(...args);
firestore.runTransaction = (...args) => store.runTransaction(...args);
firestore.batch = () => {
  const writes = [];
  return { set: (ref, value, options) => writes.push(() => store.set(ref.path, value, options)),
    update: (ref, value) => writes.push(() => store.set(ref.path, value, {merge:true})),
    commit: async () => writes.forEach(run => run()) };
};
const callables = require('./callableFunctions/general');
const auth = uid => ({uid,token:{email:`${uid}@example.test`,email_verified:true}});
const invite = (uid, extra = {}) => callables.createCompanyUserInvite.run({auth:auth(uid),data:{companyId:'company',roleId:'viewer',roleName:'Forged Manager',email:'new@example.test',sendEmail:false,...extra}});
test('actual invitation handler rejects unauthorized callers and derives role labels from the saved role', async () => {
  store.records = new Map(Object.entries(base()));
  store.set('users/empty/userAccess/company',{roleId:'empty',roleName:'Custom'});
  store.set('companies/company/roles/empty',{name:'Custom',permissionIdList:[]});
  assert.equal((await invite('empty')).status,403);
  for (const roleId of ['admin','payroll','delegator']) assert.equal((await invite('tech',{roleId})).status,403);
  const created = await invite('tech'); assert.equal(created.status,200); assert.equal(created.invite.roleName,'Viewer');
  assert.equal(store.records.get('invites/'+created.inviteId).roleName,'Viewer');
});
test('actual acceptance ignores privileged profile fields and requires verified email and a still-authorized inviter', async () => {
  store.records = new Map(Object.entries(base()));
  const created = await invite('owner'); assert.equal(created.status,200);
  const payload = {inviteId:created.inviteId,profile:{accountType:'Admin',email:'new@example.test'}};
  const unverified = auth('new');unverified.token.email_verified=false;
  assert.equal((await callables.acceptTechInvite.run(payload,{auth:unverified})).status,403);
  const accepted = await callables.acceptTechInvite.run(payload,{auth:auth('new')});
  assert.equal(accepted.status,200); assert.equal(store.records.get('users/new').accountType,'Company');
  assert.equal(store.records.get('users/new/userAccess/company').roleName,'Viewer');
  const second = await invite('tech',{email:'other@example.test'}); assert.equal(second.status,200);
  store.set('users/tech/userAccess/company',{active:false},{merge:true});
  assert.equal((await callables.acceptTechInvite.run({inviteId:second.inviteId},{auth:auth('other')})).status,403);
});
test('anonymous admin note writes are rejected before storage', async () => {
  const before = store.records.size;
  const result = await callables.createCompanyAdminNotes.run({data:{companyId:'company',updaterId:'forged'}},{});
  assert.notEqual(result.status,200); assert.equal(store.records.size,before);
});
after(async () => admin.app().delete());
