const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Run this test with the Auth and Firestore emulators; it must never access production.');
}
const projectId = 'demo-customer-company-link';
admin.initializeApp({ projectId });
const db = admin.firestore();
const accountAuth = admin.auth();
const messages = [];
require('@sendgrid/mail').send = async message => { messages.push(message); return [{}]; };
const { ensureCustomerAccountInvite, getCustomerAccountInvitePreview, listMyCustomerAccountInvites } = require('./customerAccountInvites');
const { acceptLinkedInvite, createHomeOwnerCustomerBasedOnCompany } = require('./callableFunctions/general');
const { sendServiceReportOnFinishCore } = require('./sendGrid/general');
const { syncCustomerPortalEmail } = require('./customerPortalDiscovery');
const company = 'companies/company';
const email = 'alex@example.test';
const req = (data = {}, uid = 'homeowner', authEmail = email) => ({ auth: { uid, token: { email: authEmail, email_verified: true } }, rawRequest: {}, data });
const claim = (inviteId, extra = {}, uid = 'homeowner', authEmail = email) => acceptLinkedInvite.run(req({ inviteId, ...extra }, uid, authEmail));
async function data(path) { return (await db.doc(path).get()).data(); }
async function fixture() {
  await accountAuth.createUser({ uid: 'homeowner', email, emailVerified: false });
  const batch = db.batch();
  const records = {
    [company]: { name: 'Pool Company', ownerId: 'owner' },
    [`${company}/customers/customer`]: { firstName: 'Alex', lastName: 'Homeowner', email },
    [`${company}/settings/emailConfiguration`]: { emailIsOn: true },
    [`${company}/serviceLocations/site`]: { customerId: 'customer', nickName: 'Home', address: { streetAddress: 'Example Street' } },
    [`${company}/bodiesOfWater/pool`]: { customerId: 'customer', serviceLocationId: 'site', name: 'Backyard Pool' },
    [`${company}/equipment/pump`]: { customerId: 'customer', serviceLocationId: 'site', bodyOfWaterId: 'pool', name: 'Pump' },
    [`${company}/serviceStops/stop`]: { customerId: 'customer', customerName: 'Alex', serviceLocationId: 'site', bodyOfWaterId: 'pool', serviceDate: new Date(), operationStatus: 'Finished', category: 'Route', notes: 'Pool cleaned', internalNotes: 'Private', payrollAmount: 90000 },
    [`${company}/stopData/readings`]: { customerId: 'customer', serviceStopId: 'stop', serviceLocationId: 'site', bodyOfWaterId: 'pool', date: new Date(), readings: [{ name: 'pH', amount: '7.4', cost: 999 }] },
    'users/homeowner': { accountType: 'Client', email },
    'featureFlags/feature_flag_012': { enabled: false },
    'salesInvoices/invoice': { companyId: 'company', customerId: 'customer', email, amountDueCents: 10000 },
    'salesInvoices/other-customer': { companyId: 'company', customerId: 'different-customer', email },
    'salesInvoices/other-account': { companyId: 'company', customerId: 'customer', email, customerUserId: 'someone-else' },
  };
  Object.entries(records).forEach(([path, record]) => batch.set(db.doc(path), record));
  await batch.commit();
  await syncCustomerPortalEmail(await db.doc(`${company}/customers/customer`).get());
}
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });
  messages.length = 0;
  await fixture();
});
after(async () => admin.app().delete());

test('real email builder creates an invitation, signup links preserve it, verification gates linking, and repeat acceptance is safe', async () => {
  const sent = await sendServiceReportOnFinishCore({ companyId: 'company', serviceStopId: 'stop' });
  assert.equal(sent.status, 200);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'mespineli@dripdrop-poolapp.com');
  const template = messages[0].dynamicTemplateData;
  const invitePath = new URL(template.claimAccountUrl).pathname;
  const inviteId = invitePath.split('/').pop();
  assert.match(invitePath, /^\/client\/customer-account-invite\/hoci_/);
  for (const link of [template.homeownerSignUpUrl, template.homeownerSignInUrl]) {
    assert.equal(new URL(link).searchParams.get('redirect'), invitePath);
    assert.equal(new URL(link).searchParams.get('email'), email);
  }
  assert.equal(template.primaryCustomerUrl, template.claimAccountUrl);
  const preview = await getCustomerAccountInvitePreview({ inviteId });
  assert.equal(preview.company.name, 'Pool Company');
  assert.equal(preview.customer.email, email);
  assert.equal((await claim(inviteId)).status, 403);
  assert.equal((await db.collection('customerCompanyRelationships').get()).size, 0);
  await assert.rejects(listMyCustomerAccountInvites.run(req()), { code: 'failed-precondition' });
  await accountAuth.updateUser('homeowner', { emailVerified: true });
  assert.deepEqual((await listMyCustomerAccountInvites.run(req({ email: 'victim@example.test' }))).invitations.map(i => i.inviteId), [inviteId]);
  const result = await claim(inviteId);
  assert.equal(result.status, 200);
  assert.deepEqual((await data(`${company}/customers/customer`)).linkedCustomerIds, ['homeowner']);
  const relationship = await data(`customerCompanyRelationships/${result.relationshipId}`);
  assert.equal(relationship.homeownerUserId, 'homeowner');
  assert.equal(relationship.companyCustomerId, 'customer');
  assert.equal((await data('salesInvoices/invoice')).customerUserId, 'homeowner');
  assert.equal((await data('salesInvoices/other-customer')).customerUserId, undefined);
  assert.equal((await data('salesInvoices/other-account')).customerUserId, 'someone-else');
  for (const collection of ['homeownerServiceLocations', 'homeownerBodiesOfWater', 'homeownerEquipment', 'homeownerServiceStops']) {
    const snapshot = await db.collection(collection).get();
    assert.equal(snapshot.size, 1, collection);
    assert.equal(snapshot.docs[0].data().userId, 'homeowner');
    assert.equal(snapshot.docs[0].data().companyCustomerId, 'customer');
    assert.equal(snapshot.docs[0].data().internalNotes, undefined);
    assert.equal(snapshot.docs[0].data().payrollAmount, undefined);
  }
  assert.equal((await data(`linkedInvite/${inviteId}`)).acceptedByUserId, 'homeowner');
  assert.deepEqual((await listMyCustomerAccountInvites.run(req())).invitations, []);
  assert.equal((await claim(inviteId)).status, 200);
  assert.equal((await db.collection('customerCompanyRelationships').get()).size, 1);
  assert.equal((await db.collection('homeownerServiceLocations').get()).size, 1);
  assert.equal((await sendServiceReportOnFinishCore({ companyId: 'company', serviceStopId: 'stop' })).status, 200);
  const linkedTemplate = messages.at(-1).dynamicTemplateData;
  assert.equal(linkedTemplate.shouldShowClaimAccountLink, false);
  assert.equal(new URL(linkedTemplate.primaryCustomerUrl).pathname, '/serviceStop/detail/hoss_company_stop');
  assert.ok(await data('homeownerServiceStops/hoss_company_stop'));
});

test('wrong email, wrong homeowner id, company accounts and existing foreign links never connect', async () => {
  const { inviteId } = await ensureCustomerAccountInvite({ companyId: 'company', customerId: 'customer' });
  await accountAuth.createUser({ uid: 'other', email: 'other@example.test', emailVerified: true });
  await db.doc('users/other').set({ accountType: 'Client' });
  assert.equal((await claim(inviteId, {}, 'other', 'other@example.test')).status, 403);
  assert.equal((await claim(inviteId, { homeownerId: 'other' })).status, 403);
  await accountAuth.updateUser('homeowner', { emailVerified: true });
  await db.doc('users/homeowner').set({ accountType: 'Company' }, { merge: true });
  assert.equal((await claim(inviteId)).status, 403);
  await db.doc('users/homeowner').set({ accountType: 'Client' }, { merge: true });
  await db.doc(`${company}/customers/customer`).set({ linkedHomeownerUserId: 'other' }, { merge: true });
  assert.equal((await claim(inviteId)).status, 409);
  assert.equal((await db.collection('customerCompanyRelationships').get()).size, 0);
  assert.equal((await data(`linkedInvite/${inviteId}`)).accepted, false);
});

test('revoked and expired invitations cannot be previewed, recovered, reused or accepted', async () => {
  await accountAuth.updateUser('homeowner', { emailVerified: true });
  for (const patch of [{ status: 'revoked' }, { expiresAt: new Date(Date.now() - 1000) }]) {
    const { inviteId } = await ensureCustomerAccountInvite({ companyId: 'company', customerId: 'customer', forceNew: true });
    await db.doc(`linkedInvite/${inviteId}`).set(patch, { merge: true });
    assert.equal((await getCustomerAccountInvitePreview({ inviteId })).status, 410);
    assert.equal((await claim(inviteId)).status, 410);
    assert.deepEqual((await listMyCustomerAccountInvites.run(req())).invitations, []);
    const replacement = await ensureCustomerAccountInvite({ companyId: 'company', customerId: 'customer' });
    assert.notEqual(replacement.inviteId, inviteId);
    await db.doc(`linkedInvite/${replacement.inviteId}`).set({ status: 'revoked' }, { merge: true });
  }
});

test('direct company link supports the same billing email used in an invitation', async () => {
  await accountAuth.updateUser('homeowner', { emailVerified: true });
  await db.doc(`${company}/customers/customer`).set({ firstName: 'Alex', billingEmail: email });
  const result = await createHomeOwnerCustomerBasedOnCompany.run({ companyId: 'company', customerId: 'customer' }, { auth: { uid: 'homeowner', token: { email } } });
  assert.equal(result.status, 200);
});

test('independent signup discovers a matching company by verified email without any existing email invitation', async () => {
  await accountAuth.updateUser('homeowner', { emailVerified: true });
  await db.doc(`${company}/customers/customer`).set({ email: '  ALEX@EXAMPLE.TEST  ' }, { merge: true });
  await syncCustomerPortalEmail(await db.doc(`${company}/customers/customer`).get());
  assert.equal((await data(`${company}/customers/customer`)).portalEmailNormalized, email);
  assert.equal((await db.collection('linkedInvite').get()).size, 0);
  const first = await listMyCustomerAccountInvites.run(req({ email: 'somebody-else@example.test' }));
  assert.equal(first.invitations.length, 1);
  assert.equal(first.invitations[0].companyName, 'Pool Company');
  assert.equal((await db.collection('customerCompanyRelationships').get()).size, 0);
  const second = await listMyCustomerAccountInvites.run(req());
  assert.equal(second.invitations[0].inviteId, first.invitations[0].inviteId);
  assert.equal((await db.collection('linkedInvite').get()).size, 1);
  assert.equal((await claim(first.invitations[0].inviteId)).status, 200);
});

test('email discovery rechecks the current company email, ignores inactive customers, and normalizes changes without looping', async () => {
  await accountAuth.updateUser('homeowner', { emailVerified: true });
  await db.doc(`${company}/customers/customer`).set({ email: 'changed@example.test' }, { merge: true });
  assert.deepEqual((await listMyCustomerAccountInvites.run(req())).invitations, []);
  await syncCustomerPortalEmail(await db.doc(`${company}/customers/customer`).get());
  assert.equal((await data(`${company}/customers/customer`)).portalEmailNormalized, 'changed@example.test');
  await db.doc(`${company}/customers/customer`).set({ email, active: false }, { merge: true });
  await syncCustomerPortalEmail(await db.doc(`${company}/customers/customer`).get());
  const snapshot = await db.doc(`${company}/customers/customer`).get();
  await syncCustomerPortalEmail(snapshot);
  assert.equal((await db.doc(`${company}/customers/customer`).get()).updateTime.toMillis(), snapshot.updateTime.toMillis());
  assert.deepEqual((await listMyCustomerAccountInvites.run(req())).invitations, []);
});
