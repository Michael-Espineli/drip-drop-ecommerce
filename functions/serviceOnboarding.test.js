const {test} = require('node:test');
const {Timestamp} = require('firebase-admin/firestore');
const assert = require('node:assert/strict');
const {MemoryFirestore} = require('./testSupport/memoryFirestore');
const {hash} = require('./billingMath');
const {parts, addInterval} = require('./billingCalendar');
const {onboardingSchedule, onboardingChecklist} = require('./onboardingPolicy');
const {createServiceOnboarding, authorizationHash, linkExistingLeadCustomer} = require('./serviceOnboarding');
const {createManualRecurringBilling} = require('./manualRecurringBilling');
const {createSavedCustomerPayments} = require('./savedCustomerPayments');
const {assertServiceOnboardingReady} = require('./serviceOnboardingGate');

const at = new Date('2027-01-31T20:00:00Z');
const contact = {name: 'Home Owner', email: 'home@example.test', address: {streetAddress: '123 Test Street', city: 'Test City', state: 'CA', zip: '90000'}};
const company = {ownerId: 'owner', name: 'Pool Company', stripeConnectedAccountId: 'acct_pool', customerBillingEnabled: true, billingTimeZone: 'America/Los_Angeles'};
const agreement = {id: 'agreement', companyId: 'company', customerId: 'customer', customerName: 'Home Owner', customerUserId: 'home', email: contact.email,
  onboardingWorkflowVersion: 1, sourceType: 'lead', status: 'accepted', acceptedAt: at, terms: 'Monthly pool service', rateType: 'perMonth', serviceCadence: 'weekly',
  serviceLocationIds: ['site'], totalAmountCents: 10000, lineItems: [{id: 'service', name: 'Service', quantity: 1, unitAmountCents: 10000, totalAmountCents: 10000}],
  emailDelivery: {reviewAccessToken: 'private-token'}};
const request = (action, extra = {}, uid = 'owner') => ({auth: uid ? {uid} : undefined, data: {action, companyId: 'company', agreementId: 'agreement', ...extra}});
function fixture(date = at) {
  const db = new MemoryFirestore({'companies/company': company, 'salesAgreements/agreement': agreement,
    'companies/company/customers/customer': {onboardingRequired: true, lifecycleStatus: 'prospect'},
    'companies/company/serviceLocations/site': {customerId: 'customer', address: contact.address},
    'companies/company/recurringServiceStop/route': {customerId: 'customer', serviceLocationId: 'site', techId: 'tech', day: 'Tuesday'}});
  return {db, workflow: createServiceOnboarding(db, () => date)};
}
const config = extra => ({collectionMethod: 'autopay', scheduleMode: 'signup', contact, surveyWaived: true, reason: 'Office knows this property', ...extra});

test('all billing days 1–31 retain their original anchor through ordinary/leap February, month-end and DST', () => {
  for (const year of [2027, 2028]) for (let day = 1; day <= 31; day++) {
    let start = new Date(`${year}-01-${String(day).padStart(2, '0')}T20:00:00Z`);
    for (let month = 1; month <= 24; month++) {
      start = addInterval(start, 'month', 1, 'America/Los_Angeles', day);
      const p = parts(start, 'America/Los_Angeles');
      assert.equal(p.day, Math.min(day, new Date(Date.UTC(p.year, p.month, 0)).getUTCDate()));
    }
  }
});
test('signup billing is full-price monthly advance billing with no automatic first-period proration', () => {
  const plan = onboardingSchedule(agreement, company, at);
  assert.equal(plan.initialAmountCents, 10000); assert.equal(plan.prorated, false); assert.equal(plan.anchorDay, 31);
  assert.deepEqual(plan.renewals.map(date => parts(date, company.billingTimeZone).day), [28, 31, 30]);
});
test('payment authorization stays stable when Firestore stores dates and reorders contact fields', () => {
  const original = {...agreement, onboardingBilling: {...config(), approvedAt: at, reviewedStartAt: at}};
  const stored = {...original, onboardingBilling: {reviewedStartAt: Timestamp.fromDate(at), approvedAt: Timestamp.fromDate(at),
    ...config({contact: {address: contact.address, email: contact.email, name: contact.name}})}};
  assert.equal(authorizationHash(original), authorizationHash(stored));
});
test('office proration uses actual calendar days and preserves the selected day after February', () => {
  const value = {...agreement, onboardingBilling: config({scheduleMode: 'companyOverride', billingDay: 31, prorationEnabled: true})};
  const plan = onboardingSchedule(value, company, new Date('2027-01-16T20:00:00Z'));
  assert.equal(plan.initialDays, 15); assert.equal(plan.periodDays, 31); assert.equal(plan.initialAmountCents, 4839);
  const dst = onboardingSchedule(value, company, new Date('2027-03-15T20:00:00Z'));
  assert.equal(dst.initialDays, 16); assert.equal(dst.periodDays, 31);
  assert.equal(onboardingSchedule({...value, onboardingBilling: {...value.onboardingBilling, prorationEnabled: false}}, company, new Date('2027-01-16T20:00:00Z')).initialAmountCents, 10000);
});
test('an invoice override requires a billing manager, complete contact, valid send day and an audit reason', async () => {
  const {db, workflow} = fixture();
  db.set('users/sales/userAccess/company', {roleId: 'sales'}); db.set('companies/company/roles/sales', {permissionIdList: ['430', '434']});
  await assert.rejects(workflow.configure(request('configure', {config: config({collectionMethod: 'invoice', invoiceSendDay: 31})}, 'sales')), {code: 'permission-denied'});
  for (const patch of [{reason: ''}, {invoiceSendDay: 32}, {contact: {...contact, email: 'invalid'}}])
    await assert.rejects(workflow.configure(request('configure', {config: config({collectionMethod: 'invoice', invoiceSendDay: 31, ...patch})})));
  const result = await workflow.configure(request('configure', {config: config({collectionMethod: 'invoice', invoiceSendDay: 31, paymentTerms: 'net15'})}));
  assert.equal(result.config.approvedByUserId, 'owner'); assert.equal(result.config.prorationEnabled, false);
  const sub = db.records.get('salesBillingSubscriptions/sbs_agreement');
  assert.equal(sub.onboardingCollectionMethod, 'invoice'); assert.equal(sub.billingSendAnchorDay, 31); assert.equal(sub.paymentTerms, 'net15');
});
test('proration cannot be approved without confirming the current preview amount', async () => {
  const {workflow} = fixture(new Date('2027-01-16T20:00:00Z'));
  const value = config({scheduleMode: 'companyOverride', billingDay: 31, prorationEnabled: true});
  await assert.rejects(workflow.configure(request('configure', {config: value, confirmedInitialAmountCents: 5000})), /Review the current/);
  assert.equal((await workflow.configure(request('configure', {config: value, confirmedInitialAmountCents: 4839}))).preview.initialAmountCents, 4839);
});
test('a prorated invoice arrangement accepted on a later day waits for a refreshed office preview', async () => {
  const startsAt = new Date('2027-01-16T20:00:00Z'), {db, workflow} = fixture(startsAt);
  db.set('salesAgreements/agreement', {status: 'draft'}, {merge: true});
  const value = config({collectionMethod: 'invoice', invoiceSendDay: 31, scheduleMode: 'companyOverride', billingDay: 31, prorationEnabled: true});
  await workflow.configure(request('configure', {config: value, confirmedInitialAmountCents: 4839}));
  db.set('salesAgreements/agreement', {status: 'accepted'}, {merge: true});
  const nextDay = createServiceOnboarding(db, () => new Date('2027-01-17T20:00:00Z'));
  await nextDay.sync('agreement');
  assert.equal(db.records.has('salesBillingSubscriptions/sbs_agreement'), false);
  const status = await nextDay.status(request('status'));
  assert.equal(status.billingReady, false); assert.equal(status.prorationReviewRequired, true);
  await nextDay.configure(request('configure', {config: value, confirmedInitialAmountCents: 4516}));
  assert.equal((await nextDay.status(request('status'))).billingReady, true);
});
test('first-service release needs acceptance, survey/waiver, billing contact/approval, and routing for every property', async () => {
  const {db, workflow} = fixture();
  await assert.rejects(workflow.release(request('release')), /Initial survey|Billing contact/);
  await workflow.configure(request('configure', {config: config({collectionMethod: 'invoice', invoiceSendDay: 31})}));
  db.set('companies/company/recurringServiceStop/route', {techId: '', tech: ''}, {merge: true});
  await assert.rejects(workflow.release(request('release')), /Technician and service day/);
  db.set('companies/company/recurringServiceStop/route', {techId: 'tech'}, {merge: true});
  await workflow.release(request('release'));
  assert.equal(db.records.get('companies/company/serviceLocations/site').serviceOnboarding.status, 'ready');
  db.set('salesAgreements/agreement', {serviceLocationIds: ['site', 'missing']}, {merge: true});
  await assert.rejects(workflow.release(request('release')), /Service location|Technician/);
});
test('signed-link status is recipient-scoped and unlinked/unverified accounts cannot borrow it', async () => {
  const {workflow} = fixture();
  assert.equal((await workflow.status(request('status', {email: contact.email, accessToken: 'private-token'}, null))).agreementId, 'agreement');
  await assert.rejects(workflow.status(request('status', {email: 'other@example.test', accessToken: 'private-token'}, null)), {code: 'unauthenticated'});
  await assert.rejects(workflow.status(request('status', {}, 'other')), {code: 'permission-denied'});
});
test('browser status changes and pending bank setup cannot satisfy billing readiness', () => {
  const fake = {...agreement, onboardingBilling: config()};
  assert.equal(onboardingChecklist(fake, {status: 'active', autopayEnabled: true}, [{id: 'site', address: contact.address}], [{serviceLocationId: 'site', techId: 'tech', day: 'Monday'}], true).billingReady, false);
});
test('setup activates one calendar, collects one initial invoice, and restores the 31st after February', async () => {
  const {db, workflow} = fixture();
  await workflow.configure(request('configure', {config: config()}));
  const profileId = hash('company:customer:acct_pool'), profilePath = `salesPaymentProfiles/${profileId}`;
  db.set(profilePath, {companyId: 'company', customerId: 'customer', stripeConnectedAccountId: 'acct_pool', stripeCustomerId: 'cus_customer'});
  db.set(`${profilePath}/methods/pm_card`, {status: 'ready', type: 'card'});
  const current = {...db.records.get('salesAgreements/agreement'), id: 'agreement'};
  const activation = {agreementId: 'agreement', profileId, methodId: 'pm_card', authorizedAt: at, contact, authorizationHash: authorizationHash(current)};
  await workflow.activatePayment(activation);
  const first = db.records.get('salesBillingSubscriptions/sbs_agreement').currentPeriodStart;
  await workflow.activatePayment(activation);
  assert.equal(db.records.get('salesBillingSubscriptions/sbs_agreement').currentPeriodStart.getTime(), first.getTime());
  const billing = createManualRecurringBilling(db, () => at);
  const invoice = await billing.generate({subscriptionId: 'sbs_agreement', scheduled: true});
  assert.equal(db.records.get(`salesInvoices/${invoice.invoiceId}`).totalAmountCents, 10000);
  let intent, charges = 0;
  const stripe = {paymentMethods: {retrieve: async () => ({id: 'pm_card', customer: 'cus_customer', type: 'card'})},
    paymentIntents: {create: async params => {charges++; intent = {...params, id: 'pi_initial', status: 'succeeded', created: at.getTime() / 1000, latest_charge: null}; return intent;}, retrieve: async () => intent}};
  const collector = createSavedCustomerPayments(db, stripe, () => at);
  await collector.collectRecurringInvoice({subscriptionId: 'sbs_agreement', invoiceId: invoice.invoiceId});
  await collector.collectRecurringInvoice({subscriptionId: 'sbs_agreement', invoiceId: invoice.invoiceId});
  assert.equal(charges, 1); assert.equal(db.records.get(`salesInvoices/${invoice.invoiceId}`).amountDueCents, 0);
  const feb = new Date('2027-02-28T20:00:00Z');
  const second = await createManualRecurringBilling(db, () => feb).generate({subscriptionId: 'sbs_agreement', scheduled: true});
  assert.equal(db.records.get(`salesInvoices/${second.invoiceId}`).totalAmountCents, 10000);
  assert.equal(parts(db.records.get('salesBillingSubscriptions/sbs_agreement').manualBillingNextInvoiceAt, company.billingTimeZone).day, 31);
});
test('a stale authorization cannot activate changed agreement pricing', async () => {
  const {db, workflow} = fixture(); await workflow.configure(request('configure', {config: config()}));
  const value = {...db.records.get('salesAgreements/agreement'), id: 'agreement'}, proof = authorizationHash(value);
  const profileId = hash('company:customer:acct_pool');
  db.set(`salesPaymentProfiles/${profileId}`, {companyId: 'company', customerId: 'customer', stripeConnectedAccountId: 'acct_pool', stripeCustomerId: 'cus_customer'});
  db.set(`salesPaymentProfiles/${profileId}/methods/pm_card`, {status: 'ready'});
  db.set('salesAgreements/agreement', {totalAmountCents: 20000}, {merge: true});
  await assert.rejects(workflow.activatePayment({agreementId: 'agreement', profileId, methodId: 'pm_card', authorizedAt: at, contact, authorizationHash: proof}), /agreement or billing arrangement changed/);
});
test('an explicitly prorated signup renews on the next anchor even when it is in the signup month', async () => {
  const startsAt = new Date('2027-01-16T20:00:00Z'), {db, workflow} = fixture(startsAt);
  await workflow.configure(request('configure', {config: config({scheduleMode: 'companyOverride', billingDay: 31, prorationEnabled: true}), confirmedInitialAmountCents: 4839}));
  const profileId = hash('company:customer:acct_pool');
  db.set(`salesPaymentProfiles/${profileId}`, {companyId: 'company', customerId: 'customer', stripeConnectedAccountId: 'acct_pool', stripeCustomerId: 'cus_customer'});
  db.set(`salesPaymentProfiles/${profileId}/methods/pm_card`, {status: 'ready'});
  await workflow.activatePayment({agreementId: 'agreement', profileId, methodId: 'pm_card', authorizedAt: startsAt, contact,
    authorizationHash: authorizationHash({...db.records.get('salesAgreements/agreement'), id: 'agreement'})});
  const first = await createManualRecurringBilling(db, () => startsAt).generate({subscriptionId: 'sbs_agreement', scheduled: true});
  assert.equal(db.records.get(`salesInvoices/${first.invoiceId}`).totalAmountCents, 4839);
  const next = db.records.get('salesBillingSubscriptions/sbs_agreement').manualBillingNextInvoiceAt;
  assert.equal(parts(next, company.billingTimeZone).month, 1); assert.equal(parts(next, company.billingTimeZone).day, 31);
  const renewal = await createManualRecurringBilling(db, () => at).generate({subscriptionId: 'sbs_agreement', scheduled: true});
  assert.equal(db.records.get(`salesInvoices/${renewal.invoiceId}`).totalAmountCents, 10000);
  assert.equal(parts(db.records.get('salesBillingSubscriptions/sbs_agreement').manualBillingNextInvoiceAt, company.billingTimeZone).day, 28);
});
test('a signed email customer completes secure billing setup and receives only one initial charge across callbacks', async () => {
  const {db, workflow} = fixture(); await workflow.configure(request('configure', {config: config()}));
  let setupParams, intent, setupIntent, charges = 0;
  const stripe = {
    customers: {create: async () => ({id: 'cus_guest'}), retrieve: async () => ({id: 'cus_guest', name: contact.name, email: contact.email,
      address: {line1: contact.address.streetAddress, city: contact.address.city, state: contact.address.state, postal_code: contact.address.zip}})},
    checkout: {sessions: {create: async params => {setupParams = params; return {id: 'cs_guest', status: 'open', url: 'https://checkout.stripe.com/test-setup'};}}},
    setupIntents: {retrieve: async () => setupIntent},
    paymentMethods: {retrieve: async () => ({id: 'pm_guest', customer: 'cus_guest', type: 'card', card: {last4: '4242', brand: 'visa'}})},
    paymentIntents: {create: async params => {charges++; intent = {...params, id: 'pi_guest', status: 'succeeded', created: at.getTime() / 1000, latest_charge: null}; return intent;}, retrieve: async () => intent},
  };
  const payments = createSavedCustomerPayments(db, stripe, () => at);
  const result = await payments.setup(request('setup', {email: contact.email, accessToken: 'private-token', requestId: 'guest-setup', paymentMethodType: 'card', returnUrl: 'https://dripdrop-poolapp.com/customer/service-agreements/agreement'}, null));
  assert.equal(result.url, 'https://checkout.stripe.com/test-setup'); assert.equal(setupParams.mode, 'setup'); assert.equal(charges, 0);
  assert.equal(setupParams.billing_address_collection, 'required'); assert.match(setupParams.success_url, /customer\/service-agreements\/agreement/);
  setupIntent = {id: 'seti_guest', status: 'succeeded', customer: 'cus_guest', payment_method: 'pm_guest', usage: 'off_session', created: at.getTime() / 1000,
    metadata: setupParams.setup_intent_data.metadata};
  await payments.syncSetup('seti_guest', 'acct_pool');
  await payments.syncSetup('seti_guest', 'acct_pool');
  assert.equal(charges, 1); assert.equal((await workflow.status(request('status', {email: contact.email, accessToken: 'private-token'}, null))).billingReady, true);
  db.set('salesAgreements/agreement', {revisionNumber: 2, totalAmountCents: 20000}, {merge: true});
  assert.equal((await workflow.status(request('status'))).billingReady, false);
  await assert.rejects(payments.syncSetup('seti_guest', 'acct_pool'), /changed agreement and active billing/);
  const nextPeriod = await createManualRecurringBilling(db, () => new Date('2027-02-28T20:00:00Z')).generate({subscriptionId: 'sbs_agreement', scheduled: true});
  assert.equal(nextPeriod.skipped, 'agreementNeedsAcceptance'); assert.equal(charges, 1);
});
test('shared first-service gate permits estimates and existing customers but holds a new routine visit', async () => {
  const {db} = fixture(), stop = {customerId: 'customer', serviceLocationId: 'site', type: 'Weekly Service'};
  const reader = {get: ref => ref.get()};
  await assert.rejects(assertServiceOnboardingReady(reader, db, 'company', stop), /office must complete/);
  await assertServiceOnboardingReady(reader, db, 'company', {...stop, serviceStopTypeUseCaseRawValue: 'serviceAgreementEstimate'});
  db.set('companies/company/customers/customer', {onboardingRequired: false});
  await assertServiceOnboardingReady(reader, db, 'company', stop);
});

test('delayed draft updates cannot replace another agreement release or regress a completed customer', async () => {
  const {db, workflow} = fixture();
  await workflow.configure(request('configure', {config: config({collectionMethod: 'invoice', invoiceSendDay: 31})}));
  await workflow.release(request('release'));
  db.set('salesAgreements/old-draft', {...agreement, id: 'old-draft', status: 'draft'});
  await workflow.sync('old-draft');
  assert.equal(db.records.get('companies/company/serviceLocations/site').serviceOnboarding.agreementId, 'agreement');
  assert.equal(db.records.get('companies/company/serviceLocations/site').serviceOnboarding.status, 'ready');
  db.set('companies/company/customers/customer', {lifecycleStatus: 'active', firstServiceCompletedAt: at}, {merge: true});
  db.set('salesAgreements/agreement', {status: 'canceled'}, {merge: true});
  await workflow.sync('agreement');
  assert.equal(db.records.get('companies/company/serviceLocations/site').serviceOnboarding.status, 'ready');
  assert.equal(db.records.get('companies/company/customers/customer').lifecycleStatus, 'active');
});

test('an outdated proration review is rejected before opening secure payment setup', async () => {
  const yesterday = new Date('2027-01-30T20:00:00Z'), {db, workflow} = fixture(yesterday);
  const value = config({scheduleMode: 'companyOverride', billingDay: 31, prorationEnabled: true});
  await workflow.configure(request('configure', {config: value, confirmedInitialAmountCents: 323}));
  const payments = createSavedCustomerPayments(db, {}, () => at);
  await assert.rejects(payments.setup(request('setup', {email: contact.email, accessToken: 'private-token', requestId: 'stale', paymentMethodType: 'card', returnUrl: 'https://dripdrop-poolapp.com/'}, null)), /refresh the prorated first-period preview/);
});

test('linking an existing customer preserves identity and financial history and rejects foreign locations', async () => {
  const {db} = fixture();
  db.set('homeownerServiceRequests/lead', {companyId: 'company', status: 'New'});
  const customer = {firstName: 'Existing', active: true, billingNotes: 'Existing invoice terms', linkedCustomerUserId: 'existing-home'};
  db.set('companies/company/customers/existing', customer);
  db.set('companies/company/serviceLocations/existing-site', {customerId: 'existing'});
  const req = {auth: {uid: 'owner'}, data: {companyId: 'company', leadId: 'lead', customerId: 'existing', serviceLocationId: 'site'}};
  await assert.rejects(linkExistingLeadCustomer(db, req), {code: 'permission-denied'});
  req.data.serviceLocationId = 'existing-site';
  await linkExistingLeadCustomer(db, req);
  await linkExistingLeadCustomer(db, req);
  assert.deepEqual(db.records.get('companies/company/customers/existing'), customer);
  assert.equal(db.records.get('homeownerServiceRequests/lead').customerId, 'existing');
  assert.equal([...db.records.keys()].filter(path => path.startsWith('salesBillingSubscriptions/')).length, 0);
});
