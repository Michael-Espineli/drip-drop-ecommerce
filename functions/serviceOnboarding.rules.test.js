const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const {initializeApp, deleteApp} = require('firebase/app');
const {getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc, setDoc, terminate} = require('firebase/firestore');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Local Firestore emulator required.');
const projectId = 'demo-new-pool-onboarding';
admin.initializeApp({projectId});
const db = admin.firestore(), clients = [];
function client(uid) {
  const app = initializeApp({projectId, apiKey: 'local-test'}, uid), store = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(store, host, Number(port), {mockUserToken: {sub: uid, user_id: uid}});
  clients.push({app, store}); return store;
}
const owner = client('owner'), tech = client('tech'), home = client('home');
const prefix = 'companies/company/';
const seeded = (async () => {
  const rows = {'companies/company': {ownerId: 'owner'}, 'users/tech/userAccess/company': {roleId: 'tech', status: 'Active'},
    [prefix + 'roles/tech']: {name: 'Technician', permissionIdList: []},
    [prefix + 'customers/new']: {onboardingRequired: true}, [prefix + 'customers/existing']: {},
    [prefix + 'serviceLocations/pending']: {customerId: 'new', serviceOnboarding: {required: true, status: 'pending', agreementId: 'agreement'}},
    [prefix + 'serviceLocations/ready']: {customerId: 'new', serviceOnboarding: {required: true, status: 'ready', agreementId: 'agreement'}},
    'salesAgreements/agreement': {companyId: 'company', customerId: 'new', onboardingWorkflowVersion: 1, status: 'accepted'},
    'salesBillingSubscriptions/sub': {companyId: 'company', customerId: 'new', onboardingWorkflowVersion: 1, agreementId: 'agreement'}};
  for (const [name, customerId, locationId, type] of [['pending', 'new', 'pending', 'Weekly Service'], ['ready', 'new', 'ready', 'Weekly Service'],
    ['estimate', 'new', 'pending', 'Initial Estimate'], ['existing', 'existing', '', 'Weekly Service']]) rows[prefix + 'serviceStops/' + name] = {
    companyId: 'company', customerId, serviceLocationId: locationId, type, techId: 'tech', operationStatus: 'Not Finished', startTime: null, endTime: null};
  const batch = db.batch(); for (const [path, data] of Object.entries(rows)) batch.set(db.doc(path), data); await batch.commit();
})();
const denied = promise => assert.rejects(promise, e => e.code === 'permission-denied');
test('assigned technicians and the office cannot start a pending new routine service', async () => {
  await seeded;
  for (const client of [tech, owner]) await denied(updateDoc(doc(client, prefix + 'serviceStops/pending'), {startTime: new Date()}));
  await denied(updateDoc(doc(owner, prefix + 'serviceStops/pending'), {operationStatus: 'Finished', endTime: new Date()}));
});
test('estimates, released service and existing customers retain normal execution access', async () => {
  await seeded;
  for (const id of ['estimate', 'ready', 'existing']) await updateDoc(doc(tech, prefix + 'serviceStops/' + id), {startTime: new Date()});
});
test('office clients cannot forge release, invoice approval, proration proof or payment readiness', async () => {
  await seeded;
  await denied(updateDoc(doc(owner, prefix + 'serviceLocations/pending'), {serviceOnboarding: {status: 'ready'}}));
  await denied(updateDoc(doc(owner, prefix + 'customers/new'), {onboardingRequired: false}));
  await denied(updateDoc(doc(owner, prefix + 'customers/new'), {firstServiceCompletedAt: new Date()}));
  await denied(updateDoc(doc(owner, prefix + 'customers/new'), {lifecycleStatus: 'active'}));
  for (const patch of [{onboardingReadiness: {billingReady: true}}, {onboardingBilling: {collectionMethod: 'invoice', approvedByUserId: 'owner'}}, {onboardingReleasedAt: new Date()}, {onboardingWorkflowVersion: 0}])
    await denied(updateDoc(doc(owner, 'salesAgreements/agreement'), patch));
  await denied(updateDoc(doc(owner, 'salesBillingSubscriptions/sub'), {onboardingPaymentMethodId: 'pm_forged', onboardingPaymentAuthorizedAt: new Date()}));
  await denied(updateDoc(doc(owner, 'salesBillingSubscriptions/sub'), {onboardingAuthorizationHash: 'forged'}));
  await denied(setDoc(doc(owner, 'salesBillingSubscriptions/forged'), {companyId: 'company', onboardingWorkflowVersion: 1, stripeSubscriptionId: ''}));
  await updateDoc(doc(owner, 'salesAgreements/agreement'), {description: 'Ordinary draft editing remains available'});
});
test('sales follow-up remains private to the company', async () => {
  await seeded;
  await setDoc(doc(owner, prefix + 'leadPrivateNotes/lead'), {companyId: 'company', salesFollowUp: {ownerName: 'Office', nextAction: 'Prepare proposal'}});
  await denied(getDoc(doc(home, prefix + 'leadPrivateNotes/lead')));
});
after(async () => {
  for (const {app, store} of clients) {await terminate(store); await deleteApp(app);}
  await admin.app().delete();
});
