const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Local Firestore emulator required.');
admin.initializeApp({projectId: 'demo-new-pool-onboarding'});
const db = admin.firestore();
const {convertHomeownerServiceRequestToCompanyCustomer: convert} = require('./callableFunctions/general');
test('concurrent lead conversions create one prospect and one location and preserve the winning links on retry', async () => {
  const companyId = 'conversion-company', leadId = 'conversion-lead';
  await db.doc(`companies/${companyId}`).set({ownerId: 'conversion-owner', name: 'Test Pool Company'});
  await db.doc(`homeownerServiceRequests/${leadId}`).set({companyId, homeownerName: 'New Pool Owner', homeownerEmail: 'pool@example.test', serviceLocationAddress: {streetAddress: '123 Test Street', city: 'Test City', state: 'CA', zip: '90000'}});
  const payload = {companyId, leadId, formData: {firstName: 'New', lastName: 'Pool Owner', email: 'pool@example.test'}, addServiceLocation: true};
  const context = {auth: {uid: 'conversion-owner', token: {}}, rawRequest: {headers: {}}};
  const results = await Promise.all([convert.run(payload, context), convert.run(payload, context)]);
  for (const result of results) assert.equal(result.status, 200, result.error);
  assert.equal(results[0].customerId, results[1].customerId);
  assert.equal(results[0].serviceLocationId, results[1].serviceLocationId);
  assert.equal((await db.collection(`companies/${companyId}/customers`).get()).size, 1);
  assert.equal((await db.collection(`companies/${companyId}/serviceLocations`).get()).size, 1);
  const customer = (await db.doc(`companies/${companyId}/customers/${results[0].customerId}`).get()).data();
  assert.equal(customer.onboardingRequired, true); assert.equal(customer.lifecycleStatus, 'prospect');
  assert.equal((await convert.run(payload, context)).customerId, results[0].customerId);
});
after(() => admin.app().delete());

test('conversion cannot overwrite an existing customer supplied in the form payload', async () => {
  const companyId = 'conversion-guard', leadId = 'guard-lead', original = {firstName: 'Existing', billingNotes: 'Preserve history'};
  await db.doc(`companies/${companyId}`).set({ownerId: 'conversion-owner'});
  await db.doc(`homeownerServiceRequests/${leadId}`).set({companyId, homeownerName: 'Lead Owner'});
  await db.doc(`companies/${companyId}/customers/existing`).set(original);
  const result = await convert.run({companyId, leadId, customerId: 'existing', formData: {firstName: 'Replacement'}}, {auth: {uid: 'conversion-owner', token: {}}, rawRequest: {headers: {}}});
  assert.notEqual(result.status, 200);
  assert.deepEqual((await db.doc(`companies/${companyId}/customers/existing`).get()).data(), original);
  assert.equal((await db.doc(`homeownerServiceRequests/${leadId}`).get()).data().customerId, undefined);
});

test('office invoice approval remains ready after real Firestore Timestamp serialization', async () => {
  const {createServiceOnboarding} = require('./serviceOnboarding');
  await db.doc('companies/invoice-company').set({ownerId: 'conversion-owner', billingTimeZone: 'America/Los_Angeles'});
  await db.doc('salesAgreements/invoice-agreement').set({companyId: 'invoice-company', customerId: 'invoice-customer', status: 'accepted',
    onboardingWorkflowVersion: 1, rateType: 'perMonth', serviceCadence: 'weekly', totalAmountCents: 10000, serviceLocationIds: []});
  const workflow = createServiceOnboarding(db, () => new Date('2027-01-31T20:00:00Z'));
  const request = {auth: {uid: 'conversion-owner'}, data: {companyId: 'invoice-company', agreementId: 'invoice-agreement', config: {
    collectionMethod: 'invoice', scheduleMode: 'signup', invoiceSendDay: 31, reason: 'Approved invoice customer',
    contact: {name: 'Test Owner', email: 'test@example.test', address: {streetAddress: '123 Test Street', city: 'Test City', state: 'CA', zip: '90000'}}}}};
  await workflow.configure(request);
  assert.equal((await workflow.status(request)).billingReady, true);
});
