const admin = require('firebase-admin');
const {onCall} = require('firebase-functions/v2/https');
const {onDocumentWritten} = require('firebase-functions/v2/firestore');
const {billingActor, companyBillingMembership} = require('./billingAccess');
const {documentId, fail} = require('./companyActor');
const {key, millis, hash} = require('./billingMath');
const policy = require('./onboardingPolicy');
const canonical = value => value instanceof Date || typeof value?.toMillis === 'function' ? millis(value) :
  Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(field => [field, canonical(value[field])])) : value;
const authorizationHash = agreement => hash(canonical({id: agreement.id, revision: Number(agreement.revisionNumber || 0),
  amount: agreement.totalAmountCents, currency: agreement.currency || 'usd', lineItems: agreement.lineItems || [],
  tax: agreement.taxAmountCents || 0, discount: agreement.discountAmountCents || 0,
  locations: agreement.serviceLocationIds || [], cadence: agreement.serviceCadence || '', cadenceCount: agreement.serviceCadenceCount || 1,
  terms: agreement.terms || '', termsList: agreement.termsList || [], config: agreement.onboardingBilling || {}}));
const prorationReviewExpired = (agreement, company, stamp) => agreement.onboardingBilling?.prorationEnabled === true &&
  millis(agreement.onboardingBilling.reviewedStartAt) !== require('./billingCalendar').dayStart(stamp, agreement.onboardingBilling.timeZone || company.billingTimeZone || company.timeZone || 'UTC').getTime();

async function agreementAccess(db, reader, request, agreement, {office = false} = {}) {
  const uid = request.auth?.uid, data = request.data || {};
  if (!office && uid && (agreement.customerUserId === uid || !agreement.customerUserId && agreement.email && request.auth.token?.email_verified === true &&
    String(request.auth.token.email || '').trim().toLowerCase() === String(agreement.email || '').trim().toLowerCase())) return {uid};
  const delivery = agreement.emailDelivery || {};
  if (!office && data.accessToken && String(data.accessToken) === delivery.reviewAccessToken &&
    ['sent', 'revised', 'accepted'].includes(key(agreement.status)) &&
    String(data.email || '').trim().toLowerCase() === String(agreement.email || '').trim().toLowerCase()) return {uid: '', emailLink: true};
  if (office) return billingActor(db, reader, agreement.companyId, uid);
  const actor = await companyBillingMembership(db, reader, agreement.companyId, uid);
  if (!actor.administrator && !actor.permissions.some(permission => ['400', '404', '430', '434', '612'].includes(permission))) fail('permission-denied', 'Service agreement access is required.');
  return actor;
}

function subscriptionFromAgreement(agreement, company, startsAt, method = null) {
  const config = agreement.onboardingBilling || {}, invoice = config.collectionMethod === 'invoice';
  const schedule = policy.onboardingSchedule(agreement, company, startsAt);
  return {
    id: agreement.billingSubscriptionId || `sbs_${agreement.id}`, companyId: agreement.companyId, companyName: agreement.companyName || company.name || '',
    customerId: agreement.customerId, customerUserId: agreement.customerUserId || null, customerName: agreement.customerName || '',
    email: config.contact?.email || agreement.email || '', relationshipId: agreement.relationshipId || '',
    customerCompanyRelationshipId: agreement.customerCompanyRelationshipId || agreement.relationshipId || '',
    agreementId: agreement.id, serviceLocationIds: agreement.serviceLocationIds || [], serviceLocationSnapshots: agreement.serviceLocationSnapshots || [],
    onboardingWorkflowVersion: 1, onboardingBilling: config,
    onboardingAuthorizationHash: authorizationHash(agreement),
    onboardingCollectionMethod: invoice ? 'invoice' : 'savedMethod',
    onboardingPaymentProfileId: method?.profileId || '', onboardingPaymentMethodId: method?.id || '',
    onboardingPaymentAuthorizedAt: method?.authorizedAt || null,
    stripeConnectedAccountId: company.stripeConnectedAccountId || '', stripeCustomerId: method?.stripeCustomerId || '',
    stripeSubscriptionId: '', status: 'active', autopayEnabled: false, autopayStatus: invoice ? 'invoiceApproved' : 'active',
    billingCollectionMethod: invoice ? 'manualInvoices' : 'authorizedSavedMethod',
    amountCents: Number(agreement.totalAmountCents ?? agreement.rateAmountCents ?? 0),
    taxAmountCents: Number(agreement.taxAmountCents || 0), discountAmountCents: Number(agreement.discountAmountCents || 0),
    lineItems: agreement.lineItems || [], currency: agreement.currency || 'usd', interval: 'month', intervalCount: 1,
    billingFrequency: 'monthly', billingFrequencyCount: 1, billingTimeZone: schedule.timeZone,
    billingAnchorDay: schedule.anchorDay, billingSendAnchorDay: schedule.sendDay,
    currentPeriodStart: schedule.start, currentPeriodEnd: schedule.periodEnd,
    manualBillingNextPeriodStart: schedule.start, manualBillingNextPeriodEnd: schedule.periodEnd,
    manualBillingNextInvoiceAt: schedule.firstInvoiceAt, firstInvoiceSendAt: schedule.firstInvoiceAt,
    manualBillingEnabled: true, manualBillingAutoSendEnabled: invoice && config.autoSend !== false,
    invoiceDeliveryMethod: config.invoiceDeliveryMethod || agreement.invoiceDeliveryMethod || 'email',
    paymentTerms: config.paymentTerms || agreement.paymentTerms || 'dueOnReceipt',
    onboardingInitialPeriodStart: schedule.start, onboardingInitialPeriodEnd: schedule.periodEnd,
    onboardingInitialAmountCents: schedule.initialAmountCents, onboardingInitialLineItems: schedule.prorated ? schedule.initialLineItems : null,
    onboardingInitialTaxAmountCents: schedule.initialTaxAmountCents, onboardingInitialDiscountAmountCents: schedule.initialDiscountAmountCents,
    onboardingProrationApplied: schedule.prorated,
    chemicalBillingMode: agreement.chemicalBillingMode || 'includedAll', chemicalBillingNotes: agreement.chemicalBillingNotes || '',
    ...Object.fromEntries(['includedChemicalIds', 'includedChemicalKeywords', 'separatelyBilledChemicalIds', 'separatelyBilledChemicalKeywords',
      'customerPurchasedChemicalIds', 'customerPurchasedChemicalKeywords'].map(field => [field, agreement[field] || []])),
    agreementSnapshot: {...agreement.acceptedSnapshot, agreementId: agreement.id, title: agreement.title || 'Pool service',
      startDate: schedule.start, acceptedAt: agreement.acceptedAt || startsAt, endDate: agreement.endDate || null, atWill: agreement.atWill !== false},
    createdAt: startsAt, updatedAt: startsAt, nextAction: invoice ? 'sendScheduledInvoice' : 'collectScheduledInvoice',
  };
}

function createServiceOnboarding(db, now = () => new Date()) {
  async function context(request, reader = {get: ref => ref.get()}, office = false) {
    const agreementId = documentId(request.data?.agreementId, 'Agreement');
    const ref = db.collection('salesAgreements').doc(agreementId), snapshot = await reader.get(ref);
    if (!snapshot.exists) fail('not-found', 'Service agreement was not found.');
    const agreement = {...snapshot.data(), id: snapshot.id};
    if (!policy.isNewOnboarding(agreement) || !policy.isRecurringAgreement(agreement)) fail('failed-precondition', 'Use this workflow for a new recurring service agreement.');
    if (request.data.companyId && request.data.companyId !== agreement.companyId) fail('permission-denied', 'Select the company that owns this agreement.');
    const actor = await agreementAccess(db, reader, request, agreement, {office});
    const company = (await reader.get(db.collection('companies').doc(agreement.companyId))).data();
    if (!company) fail('failed-precondition', 'Company is unavailable.');
    return {agreement, ref, actor, company};
  }
  async function sources(reader, agreement) {
    const subscriptionId = agreement.billingSubscriptionId || `sbs_${agreement.id}`;
    const [sub, locations, stops] = await Promise.all([
      reader.get(db.collection('salesBillingSubscriptions').doc(subscriptionId)),
      Promise.all((agreement.serviceLocationIds || []).map(id => reader.get(db.collection('companies').doc(agreement.companyId).collection('serviceLocations').doc(documentId(id, 'Service location'))))),
      reader.get(db.collection('companies').doc(agreement.companyId).collection('recurringServiceStop').where('customerId', '==', agreement.customerId)),
    ]);
    const subscription = sub.data() || {};
    if (sub.exists && (subscription.companyId !== agreement.companyId || subscription.customerId !== agreement.customerId || subscription.agreementId !== agreement.id)) fail('permission-denied', 'Billing setup does not match this agreement.');
    subscription.onboardingAgreementCurrent = !sub.exists || subscription.onboardingAuthorizationHash === authorizationHash(agreement);
    const ownedLocations = locations.filter(s => s.exists && s.data().customerId === agreement.customerId).map(s => ({...s.data(), id: s.id}));
    const surveyId = agreement.inspectionServiceStopId || agreement.serviceAgreementEstimateServiceStopId;
    const survey = surveyId ? await reader.get(db.collection('companies').doc(agreement.companyId).collection('serviceStops').doc(documentId(surveyId, 'Survey'))) : null;
    const surveyData = survey?.data();
    const surveyComplete = surveyData?.customerId === agreement.customerId && (Boolean(surveyData.endTime) || ['finished', 'completed', 'complete'].includes(key(surveyData.operationStatus)));
    return {subscription, locations: ownedLocations, recurringStops: stops.docs.map(s => ({...s.data(), id: s.id})), surveyComplete};
  }
  async function status(request) {
    const {agreement, company} = await context(request);
    const source = await sources({get: ref => ref.get()}, agreement);
    const connected = company.stripeConnectedAccountId || '';
    const attempts = connected ? await db.collection('salesPaymentProfiles').doc(hash(`${agreement.companyId}:${agreement.customerId}:${connected}`)).collection('setupAttempts').where('onboardingAgreementId', '==', agreement.id).get() : {docs: []};
    const verification = attempts.docs.map(snapshot => snapshot.data()).find(attempt => attempt.status === 'requires_action' && attempt.verificationUrl);
    return {agreementId: agreement.id, config: agreement.onboardingBilling || {},
      ...policy.onboardingChecklist(agreement, source.subscription, source.locations, source.recurringStops, source.surveyComplete),
      released: Boolean(agreement.onboardingReleasedAt),
      paymentSetupPending: !source.subscription.onboardingPaymentMethodId && agreement.onboardingBilling?.collectionMethod !== 'invoice',
      prorationReviewRequired: !source.subscription.onboardingCollectionMethod && prorationReviewExpired(agreement, company, now()),
      verificationUrl: verification?.verificationUrl || '',
      preview: policy.onboardingSchedule(agreement, company, source.subscription.currentPeriodStart || now())};
  }
  async function configure(request) {
    return db.runTransaction(async tx => {
      const {agreement, ref, actor, company} = await context(request, tx, true);
      const subRef = db.collection('salesBillingSubscriptions').doc(agreement.billingSubscriptionId || `sbs_${agreement.id}`);
      const sub = await tx.get(subRef), saved = sub.data() || {};
      if (agreement.onboardingReleasedAt || saved.checkoutHold || saved.stripeSubscriptionId || saved.onboardingPaymentMethodId || saved.manualBillingLastInvoiceId) fail('failed-precondition', 'Billing has started or payment setup is open. Use a reviewed billing change instead.');
      const data = request.data.config || {}, invoice = data.collectionMethod === 'invoice';
      if (!['invoice', 'autopay'].includes(data.collectionMethod)) fail('invalid-argument', 'Choose payment setup or office-approved invoices.');
      if (!['signup', 'companyOverride'].includes(data.scheduleMode)) fail('invalid-argument', 'Choose signup-date billing or a company override.');
      const reason = String(data.reason || '').trim();
      if ((invoice || data.scheduleMode === 'companyOverride' || data.surveyWaived === true) && reason.length < 3) fail('invalid-argument', 'Record why the office is approving this override.');
      const config = {collectionMethod: data.collectionMethod, scheduleMode: data.scheduleMode,
        billingDay: data.scheduleMode === 'companyOverride' ? Number(data.billingDay) : null,
        prorationEnabled: data.scheduleMode === 'companyOverride' && data.prorationEnabled === true,
        invoiceSendDay: invoice ? Number(data.invoiceSendDay) : null,
        paymentTerms: ['dueOnReceipt', 'net7', 'net15', 'net30'].includes(data.paymentTerms) ? data.paymentTerms : 'dueOnReceipt',
        invoiceDeliveryMethod: 'email', autoSend: data.autoSend !== false, contact: data.contact || {}, reason, surveyWaived: data.surveyWaived === true,
        approvedByUserId: actor.uid, approvedAt: now(), timeZone: company.billingTimeZone || company.timeZone || 'UTC'};
      if (!policy.billingContactComplete(config)) fail('invalid-argument', 'Add the billing name, valid email, and complete billing address.');
      const next = {...agreement, onboardingBilling: config}, preview = policy.onboardingSchedule(next, company, now());
      if (config.prorationEnabled && request.data.confirmedInitialAmountCents !== preview.initialAmountCents) fail('failed-precondition', 'Review the current initial charge and confirm its amount before enabling proration.');
      config.reviewedStartAt = preview.start;
      tx.set(ref, {onboardingBilling: config, updatedAt: now()}, {merge: true});
      if (key(agreement.status) === 'accepted' && invoice) {
        const subscription = subscriptionFromAgreement(next, company, now());
        tx.set(subRef, subscription, {merge: true});
        tx.set(ref, {billingSubscriptionId: subRef.id, billingFlowStatus: 'active', billingFlowNextAction: 'sendScheduledInvoice', billingCollectionMethod: 'manualInvoices'}, {merge: true});
      }
      return {config, preview};
    });
  }
  async function sync(agreementId) {
    const ref = db.collection('salesAgreements').doc(agreementId), snap = await ref.get();
    if (!snap.exists || !policy.isNewOnboarding(snap.data())) return null;
    let agreement = {...snap.data(), id: snap.id};
    const company = (await db.collection('companies').doc(agreement.companyId).get()).data() || {};
    if (key(agreement.status) === 'accepted' && agreement.onboardingBilling?.collectionMethod === 'invoice' && agreement.onboardingBilling.approvedByUserId) {
      await db.runTransaction(async tx => {
        const fresh = await tx.get(ref), value = {...fresh.data(), id: fresh.id};
        const subRef = db.collection('salesBillingSubscriptions').doc(value.billingSubscriptionId || `sbs_${value.id}`), sub = await tx.get(subRef);
        if (key(value.status) !== 'accepted' || value.onboardingBilling?.collectionMethod !== 'invoice' || !value.onboardingBilling.approvedByUserId || sub.data()?.manualBillingLastInvoiceId) return;
        if (prorationReviewExpired(value, company, now())) return;
        if (!sub.data()?.onboardingCollectionMethod) {
          tx.set(subRef, subscriptionFromAgreement(value, company, now()), {merge: true});
          tx.set(ref, {billingSubscriptionId: subRef.id}, {merge: true});
        }
      });
      agreement = {...(await ref.get()).data(), id: snap.id};
    }
    return db.runTransaction(async tx => {
      const fresh = await tx.get(ref);
      if (!fresh.exists) return null;
      const value = {...fresh.data(), id: fresh.id};
      const source = await sources(tx, value);
      const customer = await tx.get(db.collection('companies').doc(value.companyId).collection('customers').doc(value.customerId));
      const checklist = policy.onboardingChecklist(value, source.subscription, source.locations, source.recurringStops, source.surveyComplete);
      const summary = {...checklist, released: Boolean(value.onboardingReleasedAt && checklist.ready)};
      if (JSON.stringify(value.onboardingReadiness || {}) !== JSON.stringify(summary)) tx.set(ref, {onboardingReadiness: summary}, {merge: true});
      for (const location of customer.data()?.onboardingRequired && !customer.data().firstServiceCompletedAt ? source.locations : []) {
        const gate = location.serviceOnboarding || {};
        // A draft or delayed trigger must not replace another agreement's release.
        if (location.firstServiceCompletedAt || gate.status === 'active' || gate.agreementId && gate.agreementId !== agreementId) continue;
        const next = {required: true, agreementId, status: summary.released ? 'ready' : 'pending', billingReady: checklist.billingReady};
        if (Object.entries(next).some(([field, content]) => gate[field] !== content)) tx.set(db.collection('companies').doc(value.companyId).collection('serviceLocations').doc(location.id), {
          serviceOnboarding: {...next, updatedAt: now()},
        }, {merge: true});
      }
      return summary;
    });
  }
  async function release(request) {
    const result = await db.runTransaction(async tx => {
      const {agreement, ref, actor} = await context(request, tx, true);
      const source = await sources(tx, agreement), checklist = policy.onboardingChecklist(agreement, source.subscription, source.locations, source.recurringStops, source.surveyComplete);
      if (!checklist.ready) fail('failed-precondition', checklist.checks.filter(check => !check.complete).map(check => check.label).join('; '));
      const customerRef = db.collection('companies').doc(agreement.companyId).collection('customers').doc(agreement.customerId);
      const customer = await tx.get(customerRef);
      if (!customer.exists) fail('failed-precondition', 'The customer is unavailable.');
      const stamp = now();
      tx.set(ref, {onboardingReleasedAt: agreement.onboardingReleasedAt || stamp, onboardingReleasedByUserId: actor.uid,
        onboardingReadiness: {...checklist, released: true}}, {merge: true});
      for (const location of customer.data().onboardingRequired && !customer.data().firstServiceCompletedAt ? source.locations : []) tx.set(db.collection('companies').doc(agreement.companyId).collection('serviceLocations').doc(location.id), {
        serviceOnboarding: {required: true, agreementId: agreement.id, status: 'ready', billingReady: true, updatedAt: stamp},
      }, {merge: true});
      if (customer.data().onboardingRequired && !customer.data().firstServiceCompletedAt) tx.set(customerRef, {lifecycleStatus: 'readyForService', serviceOnboarding: {agreementId: agreement.id, status: 'ready', releasedAt: stamp}}, {merge: true});
      return {released: true};
    });
    return result;
  }
  async function activatePayment({agreementId, profileId, methodId, authorizedAt, contact, authorizationHash: expectedAuthorizationHash}) {
    await db.runTransaction(async tx => {
      const ref = db.collection('salesAgreements').doc(agreementId), snap = await tx.get(ref);
      if (!snap.exists) fail('not-found', 'Agreement was not found.');
      const agreement = {...snap.data(), id: snap.id};
      const company = (await tx.get(db.collection('companies').doc(agreement.companyId))).data() || {};
      const profileRef = db.collection('salesPaymentProfiles').doc(profileId), profile = await tx.get(profileRef), method = await tx.get(profileRef.collection('methods').doc(methodId));
      const subRef = db.collection('salesBillingSubscriptions').doc(agreement.billingSubscriptionId || `sbs_${agreement.id}`), sub = await tx.get(subRef);
      if (!policy.isNewOnboarding(agreement) || key(agreement.status) !== 'accepted' || agreement.onboardingBilling?.collectionMethod === 'invoice') fail('failed-precondition', 'This agreement is not awaiting online payment setup.');
      if (profile.data()?.companyId !== agreement.companyId || profile.data()?.customerId !== agreement.customerId || profile.data()?.stripeConnectedAccountId !== company.stripeConnectedAccountId || method.data()?.status !== 'ready') fail('permission-denied', 'Payment authorization does not match this customer.');
      if (sub.data()?.onboardingPaymentMethodId) {
        if (sub.data().onboardingAuthorizationHash !== authorizationHash(agreement)) fail('failed-precondition', 'Review the changed agreement and active billing arrangement with the office.');
        return; // Duplicate webhooks never restart the calendar.
      }
      if (expectedAuthorizationHash !== authorizationHash(agreement)) fail('failed-precondition', 'The agreement or billing arrangement changed. Review the current agreement before authorizing payment.');
      if (sub.data()?.stripeSubscriptionId || sub.data()?.manualBillingLastInvoiceId) fail('failed-precondition', 'Review existing billing before starting a new schedule.');
      const billing = {...agreement.onboardingBilling, collectionMethod: 'autopay', scheduleMode: agreement.onboardingBilling?.scheduleMode || 'signup', contact};
      if (!policy.billingContactComplete(billing)) fail('failed-precondition', 'Complete the billing address in secure payment setup.');
      if (billing.prorationEnabled && millis(billing.reviewedStartAt) !== require('./billingCalendar').dayStart(now(), billing.timeZone || company.billingTimeZone || company.timeZone || 'UTC').getTime()) fail('failed-precondition', 'The office needs to refresh the prorated first-period preview for today.');
      const value = {...agreement, onboardingBilling: billing};
      tx.set(subRef, subscriptionFromAgreement(value, company, now(), {id: methodId, profileId, authorizedAt, stripeCustomerId: profile.data().stripeCustomerId}), {merge: true});
      tx.set(ref, {onboardingBilling: billing, billingSubscriptionId: subRef.id, billingFlowStatus: 'active', billingFlowNextAction: 'collectScheduledInvoice',
        billingCollectionMethod: 'authorizedSavedMethod', autopayStatus: 'active', updatedAt: now()}, {merge: true});
    });
    await sync(agreementId);
    return {billingSubscriptionId: `sbs_${agreementId}`};
  }
  return {context, status, configure, release, sync, activatePayment};
}

exports.createServiceOnboarding = createServiceOnboarding;
exports.agreementAccess = agreementAccess;
exports.subscriptionFromAgreement = subscriptionFromAgreement;
exports.authorizationHash = authorizationHash;
async function linkExistingLeadCustomer(db, request) {
  const data = request.data || {}, companyId = documentId(data.companyId, 'Company'), leadId = documentId(data.leadId, 'Lead');
  const customerId = documentId(data.customerId, 'Customer'), locationId = data.serviceLocationId ? documentId(data.serviceLocationId, 'Service location') : '';
  return db.runTransaction(async tx => {
    const {companyActor, can} = require('./companyActor');
    const actor = await companyActor(db, tx, companyId, request.auth?.uid);
    if (!can(actor, '612') || !can(actor, '10')) fail('permission-denied', 'Lead conversion and customer viewing permissions are required.');
    const root = db.collection('companies').doc(companyId), leadRef = db.collection('homeownerServiceRequests').doc(leadId);
    const [lead, customer, location] = await Promise.all([tx.get(leadRef), tx.get(root.collection('customers').doc(customerId)), locationId ? tx.get(root.collection('serviceLocations').doc(locationId)) : null]);
    if (!lead.exists || lead.data().companyId !== companyId || !customer.exists || location && (!location.exists || location.data().customerId !== customerId)) fail('permission-denied', 'Choose the customer and location belonging to this lead’s company.');
    if (customer.data().active === false || customer.data().isActive === false) fail('failed-precondition', 'Review this inactive customer before linking a new lead.');
    const previousId = lead.data().customerId || lead.data().companyCustomerId;
    if (previousId && previousId !== customerId) fail('failed-precondition', 'This lead is already linked to another customer.');
    if (['cancelled', 'canceled'].includes(key(lead.data().status))) fail('failed-precondition', 'Reopen the lead before linking a customer.');
    const value = customer.data(), name = value.displayAsCompany ? value.company || value.companyName : [value.firstName, value.lastName].filter(Boolean).join(' ');
    const updates = {customerId, companyCustomerId: customerId, customerName: name || value.customerName || value.email || 'Customer',
      serviceLocationId: locationId, companyServiceLocationId: locationId, linkedExistingCustomerAt: new Date(), linkedExistingCustomerByUserId: actor.uid};
    if (previousId) return updates;
    tx.set(leadRef, {...updates, status: 'In Progress', leadStatus: 'In Progress'}, {merge: true});
    tx.set(root.collection('customerPipeline').doc(`lead_${leadId}`), {id: `lead_${leadId}`, companyId, leadId, ...updates, pipelineStatus: 'active', leadStatus: 'In Progress', updatedAt: new Date()}, {merge: true});
    return updates;
  });
}
exports.linkExistingLeadCustomer = linkExistingLeadCustomer;
exports.linkLeadToExistingCustomer = onCall({cors: true}, request => linkExistingLeadCustomer(admin.firestore(), request));
exports.manageServiceOnboarding = onCall({cors: true}, async request => {
  const workflow = createServiceOnboarding(admin.firestore());
  const action = request.data?.action || 'status';
  if (!['status', 'configure', 'release'].includes(action)) fail('invalid-argument', 'Choose a valid onboarding action.');
  return workflow[action](request);
});
exports.onServiceOnboardingAgreementWritten = onDocumentWritten('salesAgreements/{agreementId}', event =>
  createServiceOnboarding(admin.firestore()).sync(event.params.agreementId));
exports.onServiceOnboardingSubscriptionWritten = onDocumentWritten('salesBillingSubscriptions/{subscriptionId}', event => {
  const record = event.data?.after?.data();
  return record?.onboardingWorkflowVersion === 1 && record.agreementId ? createServiceOnboarding(admin.firestore()).sync(record.agreementId) : null;
});
exports.onServiceOnboardingRouteWritten = onDocumentWritten('companies/{companyId}/recurringServiceStop/{stopId}', async event => {
  const record = event.data?.after?.data() || event.data?.before?.data();
  if (!record?.customerId) return null;
  const db = admin.firestore(), agreements = await db.collection('salesAgreements').where('companyId', '==', event.params.companyId).where('customerId', '==', record.customerId).get();
  for (const agreement of agreements.docs) if (policy.isNewOnboarding(agreement.data())) await createServiceOnboarding(db).sync(agreement.id);
  return null;
});
exports.onServiceOnboardingStopWritten = onDocumentWritten('companies/{companyId}/serviceStops/{stopId}', async event => {
  const after = event.data?.after?.data(), before = event.data?.before?.data();
  if (!after || !after.customerId || !after.endTime && !['finished', 'completed', 'complete'].includes(key(after.operationStatus))) return null;
  if (before?.endTime || ['finished', 'completed', 'complete'].includes(key(before?.operationStatus))) return null;
  const db = admin.firestore();
  if (require('./serviceOnboardingGate').estimateOrJob(after)) {
    const agreements = await db.collection('salesAgreements').where('companyId', '==', event.params.companyId).where('customerId', '==', after.customerId).get();
    for (const agreement of agreements.docs) if (policy.isNewOnboarding(agreement.data())) await createServiceOnboarding(db).sync(agreement.id);
  } else {
    const ref = db.collection('companies').doc(event.params.companyId).collection('customers').doc(after.customerId);
    await db.runTransaction(async tx => {
      const customer = await tx.get(ref);
      if (!customer.data()?.onboardingRequired || customer.data().firstServiceCompletedAt) return;
      await require('./serviceOnboardingGate').assertServiceOnboardingReady(tx, db, event.params.companyId, after);
      tx.set(ref, {lifecycleStatus: 'active', firstServiceCompletedAt: new Date()}, {merge: true});
    });
  }
  return null;
});
