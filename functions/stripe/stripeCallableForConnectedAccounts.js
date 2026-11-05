
const { onCall } = require('firebase-functions/v2/https');
const { HttpsError } = require('../appErrors');
const functions = require("firebase-functions");
const functions1 = require('firebase-functions/v1');
const {getFirestore} = require("firebase-admin/firestore");
const { defineSecret } = require('firebase-functions/params');
const { v4: uuidv4 } = require('uuid');
const { Timestamp } = require('firebase-admin/firestore');
// The Firebase Admin SDK to access Firestore.
const admin = require("firebase-admin");
const { title } = require("process");

const sgMail = require("@sendgrid/mail");

const db = admin.firestore(); 
const { prepareJobPlanWorkspace } = require('../jobPlanWorkspace');
const {
  createStripeProxy,
} = require("./stripeClient");

const stripe = createStripeProxy();

const salesCollectionNames = {
  billingProfiles: 'salesBillingProfiles',
  agreements: 'salesAgreements',
  billingSubscriptions: 'salesBillingSubscriptions',
  catalogItems: 'salesCatalogItems',
};
const { hasActiveCompanyPermission } = require('../billingAccess');
const FINANCE_PERMISSION_ID = '404';
const DELETE_SERVICE_AGREEMENTS_PERMISSION_ID = '436';

const timestampFromStripeSeconds = (seconds) => (
  seconds ? admin.firestore.Timestamp.fromMillis(seconds * 1000) : null
);

const normalizeStripeInterval = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('day')) return 'day';
  if (normalized.includes('week')) return 'week';
  if (normalized.includes('year')) return 'year';
  return 'month';
};

const buildCheckoutLineItems = (subscription) => {
  const currency = String(subscription.currency || 'usd').toLowerCase();
  const interval = normalizeStripeInterval(subscription.interval || subscription.serviceCadence || subscription.rateType);
  const intervalCount = Math.max(Number(subscription.intervalCount || 1), 1);
  const rawLineItems = Array.isArray(subscription.lineItems) ? subscription.lineItems : [];
  const lineItems = rawLineItems
    .map((item, index) => {
      const quantity = Math.max(Number(item.quantity || 1), 1);
      const unitAmount = Number(item.unitAmountCents || Math.round(Number(item.totalAmountCents || 0) / quantity));
      const name = item.name || item.description || `Service ${index + 1}`;

      if (item.stripePriceId) {
        return {
          price: item.stripePriceId,
          quantity,
        };
      }

      if (!unitAmount || unitAmount < 1) return null;

      return {
        price_data: {
          currency,
          unit_amount: unitAmount,
          recurring: {
            interval,
            interval_count: intervalCount,
          },
          product_data: {
            name,
            description: item.description || undefined,
            metadata: {
              salesCatalogItemId: item.catalogItemId || '',
              salesLineItemId: item.id || '',
              sourceType: item.sourceType || 'manual',
              sourceId: item.sourceId || '',
            },
          },
        },
        quantity,
      };
    })
    .filter(Boolean);

  if (lineItems.length > 0) return lineItems;

  const amountCents = Number(subscription.amountCents || 0);
  if (!amountCents || amountCents < 1) return [];

  return [{
    price_data: {
      currency,
      unit_amount: amountCents,
      recurring: {
        interval,
        interval_count: intervalCount,
      },
      product_data: {
        name: subscription.agreementSnapshot?.title || 'Pool Service',
        description: subscription.agreementSnapshot?.customerName
          ? `Recurring service for ${subscription.agreementSnapshot.customerName}`
          : 'Recurring pool service',
      },
    },
    quantity: 1,
  }];
};

const getOrCreateConnectedStripeCustomer = async ({ subscription, connectedAccount }) => {
  if (subscription.stripeCustomerId) {
    try {
      const existingCustomer = await stripe.customers.retrieve(subscription.stripeCustomerId, {
        stripeAccount: connectedAccount,
      });

      if (!existingCustomer?.deleted) return existingCustomer;
    } catch (error) {
      console.warn('Saved connected-account Stripe customer could not be retrieved. Creating a new one.', {
        stripeCustomerId: subscription.stripeCustomerId,
        connectedAccount,
        error: error.message,
      });
    }
  }

  return stripe.customers.create({
    name: subscription.customerName || subscription.agreementSnapshot?.customerName || undefined,
    email: subscription.email || subscription.agreementSnapshot?.email || undefined,
    metadata: {
      salesCustomerId: subscription.customerId || '',
      salesBillingProfileId: subscription.billingProfileId || '',
      salesBillingSubscriptionId: subscription.id || '',
      companyId: subscription.companyId || '',
    },
  }, {
    stripeAccount: connectedAccount,
  });
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const normalizeStripeAccountId = (value) => {
  const id = typeof value === 'string' ? value.trim() : '';
  return id.startsWith('acct_') ? id : '';
};

const getCompanyConnectedAccountId = (companyData = {}) => (
  normalizeStripeAccountId(companyData.stripeConnectedAccountId) ||
  normalizeStripeAccountId(companyData.stripeConnectAccountId)
);

const normalizeApplicationFeePercent = (value) => {
  if (value === undefined || value === null || value === '') return null;

  const percent = Number(value);
  if (!Number.isFinite(percent) || percent <= 0) return null;

  return Math.min(Math.round(percent * 100) / 100, 100);
};

const salesPaymentMethodFeePolicy = {
  ach: {
    paymentMethodType: 'ach',
    stripePaymentMethodType: 'us_bank_account',
    stripePaymentMethodTypes: ['us_bank_account'],
    applicationFeePercent: 0.19,
    source: 'dripDropAchPlatformFee',
    label: 'Bank account (ACH)',
  },
  card: {
    paymentMethodType: 'card',
    stripePaymentMethodType: 'card',
    stripePaymentMethodTypes: ['card'],
    applicationFeePercent: 0.08,
    source: 'dripDropCardPlatformFee',
    label: 'Card',
  },
};

const normalizeSalesPaymentMethodType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['ach', 'bank', 'bank_account', 'us_bank_account'].includes(normalized)) return 'ach';
  if (['card', 'credit_card', 'debit_card'].includes(normalized)) return 'card';
  return 'card';
};

const resolveSalesPaymentMethodFeePolicy = (value) => {
  const paymentMethodType = normalizeSalesPaymentMethodType(value);
  return salesPaymentMethodFeePolicy[paymentMethodType] || salesPaymentMethodFeePolicy.card;
};

const resolveApplicationFee = (subscription = {}, companyData = {}, paymentMethodType = '') => {
  if (paymentMethodType) {
    const policy = resolveSalesPaymentMethodFeePolicy(paymentMethodType);
    return {
      percent: policy.applicationFeePercent,
      source: policy.source,
      paymentMethodType: policy.paymentMethodType,
      stripePaymentMethodType: policy.stripePaymentMethodType,
      stripePaymentMethodTypes: policy.stripePaymentMethodTypes,
      label: policy.label,
    };
  }

  const candidates = [
    { source: 'subscriptionApplicationFeePercent', value: subscription.applicationFeePercent },
    { source: 'subscriptionPlatformFeePercent', value: subscription.platformFeePercent },
    { source: 'companyStripeApplicationFeePercent', value: companyData.stripeApplicationFeePercent },
    { source: 'companyApplicationFeePercent', value: companyData.applicationFeePercent },
    { source: 'environmentStripeApplicationFeePercent', value: process.env.STRIPE_APPLICATION_FEE_PERCENT },
  ];

  for (const candidate of candidates) {
    const percent = normalizeApplicationFeePercent(candidate.value);
    if (percent !== null) {
      const policy = resolveSalesPaymentMethodFeePolicy(
        subscription.paymentMethodType ||
        subscription.preferredPaymentMethodType ||
        companyData.defaultSalesPaymentMethodType ||
        ''
      );

      return {
        percent,
        source: candidate.source,
        paymentMethodType: policy.paymentMethodType,
        stripePaymentMethodType: policy.stripePaymentMethodType,
        stripePaymentMethodTypes: policy.stripePaymentMethodTypes,
        label: policy.label,
      };
    }
  }

  const fallbackPolicy = resolveSalesPaymentMethodFeePolicy(subscription.paymentMethodType || subscription.preferredPaymentMethodType || companyData.defaultSalesPaymentMethodType || 'card');
  return {
    percent: null,
    source: 'none',
    paymentMethodType: fallbackPolicy.paymentMethodType,
    stripePaymentMethodType: fallbackPolicy.stripePaymentMethodType,
    stripePaymentMethodTypes: fallbackPolicy.stripePaymentMethodTypes,
    label: fallbackPolicy.label,
  };
};

const stripeWebhookSecretConfigured = () => (
  String(`${process.env.STRIPE_WEBHOOK_SECRET || ''},${process.env.STRIPE_WEBHOOK_SECRETS || ''}`)
    .split(',')
    .some((secret) => secret.trim())
);

const getCallableData = (data) => data?.data || data || {};

const getCallableAuth = async (data, context, message) => {
  if (context.auth?.uid) {
    return {
      uid: context.auth.uid,
      token: context.auth.token || {},
    };
  }

  const payload = getCallableData(data);
  const authorizationHeader =
    context.rawRequest?.headers?.authorization ||
    context.rawRequest?.headers?.Authorization ||
    '';
  const bearerToken = String(authorizationHeader).startsWith('Bearer ')
    ? String(authorizationHeader).slice('Bearer '.length).trim()
    : '';
  const idToken = [
    payload.idToken,
    payload.auth?.idToken,
    payload.data?.idToken,
    bearerToken,
  ].find((candidate) => String(candidate || '').trim());

  if (!idToken) {
    throw new HttpsError('unauthenticated', message);
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    return {
      uid: decodedToken.uid,
      token: decodedToken,
    };
  } catch (error) {
    console.error('Unable to verify callable id token', error);
    throw new HttpsError('unauthenticated', message);
  }
};

const userHasCompanyAccess = (uid, companyId) => hasActiveCompanyPermission(db, companyId, uid, ['400', '404']);

const userHasAnyCompanyPermission = (uid, companyId, permissionIds = []) => (
  hasActiveCompanyPermission(db, companyId, uid, permissionIds)
);

const userCanAccessSalesRecord = async ({ auth, record }) => {
  if (!auth || !record) return false;

  const recordCustomerUserId = String(record.customerUserId || '').trim();
  if (recordCustomerUserId && recordCustomerUserId === auth.uid) return true;

  if (await hasActiveCompanyPermission(db, record.companyId, auth.uid, ['404'])) return true;

  if (recordCustomerUserId) return false;

  const authEmail = normalizeEmail(auth.token?.email);
  const recordEmail = normalizeEmail(record.email || record.customerEmail || record.billingEmail);
  if (auth.token?.email_verified === true && authEmail && recordEmail && authEmail === recordEmail) return true;

  return false;
};

const publicAgreementLinkCanAccess = ({ agreement, accessToken, email }) => {
  const savedAccessToken = String(agreement?.emailDelivery?.reviewAccessToken || '').trim();
  const requestedAccessToken = String(accessToken || '').trim();

  if (!savedAccessToken || !requestedAccessToken || savedAccessToken !== requestedAccessToken) {
    return false;
  }

  const requestedEmail = normalizeEmail(email);
  const agreementEmail = normalizeEmail(agreement.email || agreement.customerEmail || agreement.billingEmail);

  if (requestedEmail && agreementEmail && requestedEmail !== agreementEmail) {
    return false;
  }

  return true;
};

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const companyCustomerBillingEnabled = (companyData = {}) => (
  companyData.customerBillingEnabled === true ||
  companyData.salesBillingEnabled === true ||
  companyData.salesBillingAutomationEnabled === true
);

const companyCreateBillingSubscriptionOnAcceptanceDefault = (companyData = {}) => {
  if (typeof companyData.salesCreateBillingSubscriptionOnAcceptanceDefault === 'boolean') {
    return companyData.salesCreateBillingSubscriptionOnAcceptanceDefault === true;
  }

  return companyData.salesBillingAutomationEnabled === true ||
    companyData.salesBillingEnabled === true ||
    companyData.customerBillingEnabled === true;
};

const shouldCreateBillingSubscriptionFromRequest = (receivedData = {}, companyData = {}) => {
  if (typeof receivedData.createBillingSubscriptionOnAcceptance === 'boolean') {
    return receivedData.createBillingSubscriptionOnAcceptance === true;
  }

  if (typeof receivedData.createBillingSubscription === 'boolean') {
    return receivedData.createBillingSubscription === true;
  }

  return companyCreateBillingSubscriptionOnAcceptanceDefault(companyData);
};

const normalizeCustomerBillingPreference = (value = '', fallback = 'requestInvoice') => {
  const normalized = String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  if (normalized === 'paynow' || normalized === 'payrightaway' || normalized === 'autopay') {
    return 'payNow';
  }

  if (normalized === 'chargeondelivery' || normalized === 'payoncedelivered' || normalized === 'payondelivery') {
    return 'chargeOnDelivery';
  }

  if (normalized === 'requestinvoice' || normalized === 'sendinvoice' || normalized === 'invoice') {
    return 'requestInvoice';
  }

  return fallback;
};

const agreementSupportsBillingSubscription = (agreement = {}) => {
  const serviceCadenceKey = normalizeStatus(agreement.serviceCadence);
  const rateTypeKey = normalizeStatus(agreement.rateType);
  const sourceTypeKey = normalizeStatus(agreement.sourceType);
  const lineItems = Array.isArray(agreement.lineItems) ? agreement.lineItems : [];
  const hasRecurringLineItem = lineItems.some((item) => (
    normalizeStatus(item.billingBehavior || item.metadata?.billingBehavior) === 'recurring'
  ));

  if (serviceCadenceKey === 'onetime' || rateTypeKey === 'onetime' || sourceTypeKey === 'oneoffjob') {
    return false;
  }

  return (
    sourceTypeKey === 'recurringservice' ||
    Boolean(agreement.billingSubscriptionId) ||
    hasRecurringLineItem ||
    Boolean(serviceCadenceKey || rateTypeKey)
  );
};

const valueToMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const agreementIsExpired = (agreement = {}) => {
  const expiresAtMillis = valueToMillis(
    agreement.expiresAt ||
    agreement.acceptBy ||
    agreement.lastDateToAccept
  );

  return Boolean(expiresAtMillis && expiresAtMillis < Date.now());
};

const getAgreementAcceptanceAudit = (context = {}) => {
  const headers = context.rawRequest?.headers || {};
  const forwardedFor = String(headers['x-forwarded-for'] || '').split(',')[0].trim();

  return {
    acceptedUserAgent: String(headers['user-agent'] || '').slice(0, 500),
    acceptedIpAddress: String(forwardedFor || context.rawRequest?.ip || '').slice(0, 120),
  };
};

const validateAgreementAcceptance = (receivedData = {}) => {
  const signatureName = String(receivedData.signatureName || receivedData.acceptedBySignatureName || '').trim();

  if (receivedData.acceptedTerms !== true) {
    throw new HttpsError('invalid-argument', 'Confirm that the service agreement terms were reviewed.');
  }

  if (receivedData.acceptedPricing !== true) {
    throw new HttpsError('invalid-argument', 'Confirm that the agreement pricing was reviewed.');
  }

  if (receivedData.acceptedAutopayNotice !== true) {
    throw new HttpsError('invalid-argument', 'Confirm that the recurring payment authorization was reviewed.');
  }

  if (signatureName.length < 2) {
    throw new HttpsError('invalid-argument', 'Enter the customer name as the acceptance signature.');
  }

  return {
    signatureName,
    acceptedTermsConfirmed: true,
    acceptedPricingConfirmed: true,
    acceptedAutopayNoticeConfirmed: true,
  };
};

const renewalPreviousAgreementId = (agreement = {}) => (
  agreement.supersedesAgreementId ||
  agreement.previousAgreementId ||
  agreement.renewalSourceAgreementId ||
  ''
);

const agreementHistoryGroupId = (agreement = {}) => (
  agreement.agreementHistoryGroupId ||
  renewalPreviousAgreementId(agreement) ||
  agreement.id ||
  ''
);

const activeStripeStatusKeys = new Set(['active', 'trialing', 'pastdue', 'unpaid', 'paused']);

const canDeleteBillingSubscriptionRecord = (subscription = {}) => (
  !subscription?.stripeSubscriptionId ||
  normalizeStatus(subscription.stripeStatus || subscription.status) === 'canceled'
);

const supersededSubscriptionUpdates = (subscription = {}, timestamp) => {
  const hasStripeSubscription = Boolean(subscription.stripeSubscriptionId);
  const statusKey = normalizeStatus(subscription.stripeStatus || subscription.status);
  const keepStripeManagedStatus = hasStripeSubscription && activeStripeStatusKeys.has(statusKey);

  return {
    supersededAt: timestamp,
    manualBillingEnabled: false,
    manualBillingAutoSendEnabled: false,
    manualBillingStatus: 'disabledSupersededAgreement',
    manualBillingReason: 'agreementSuperseded',
    nextAction: keepStripeManagedStatus ? 'reviewStripeSubscriptionAfterRenewal' : 'agreementSuperseded',
    ...(keepStripeManagedStatus
      ? {}
      : {
        status: 'canceled',
        autopayStatus: 'canceled',
        canceledAt: timestamp,
      }),
    updatedAt: timestamp,
  };
};

const linkedJobIdForAgreement = (agreement = {}) => {
  if (agreement.jobId) return agreement.jobId;
  if (agreement.workOrderId) return agreement.workOrderId;
  if (normalizeStatus(agreement.sourceType) === 'oneoffjob' && agreement.sourceId) return agreement.sourceId;
  return '';
};

const linkedLeadIdForAgreement = (agreement = {}) => {
  if (agreement.leadId) return agreement.leadId;
  if (agreement.homeownerServiceRequestId) return agreement.homeownerServiceRequestId;
  if (normalizeStatus(agreement.sourceType) === 'lead' && agreement.sourceId) return agreement.sourceId;
  return '';
};

const syncLinkedLeadForAgreementStatus = async ({
  agreement,
  status,
  timestamp = admin.firestore.FieldValue.serverTimestamp(),
}) => {
  const leadId = linkedLeadIdForAgreement(agreement);
  if (!leadId) return;

  const statusKey = normalizeStatus(status);
  const update = {
    serviceAgreementId: agreement.id || agreement.agreementId || '',
    serviceAgreementTitle: agreement.title || 'Service Agreement',
    serviceAgreementStatus: status,
    updatedAt: timestamp,
  };

  if (statusKey === 'accepted') {
    update.status = 'Completed';
    update.leadStatus = 'Completed';
    update.serviceAgreementAcceptedAt = timestamp;
    update.dateCompleted = timestamp;
    update.lostReason = '';
    update.cancelReason = '';
  }

  if (statusKey === 'sent') {
    update.status = 'In Progress';
    update.leadStatus = 'In Progress';
    update.dateCompleted = null;
    update.lostReason = '';
    update.cancelReason = '';
  }

  await db.collection('homeownerServiceRequests').doc(leadId).set(update, { merge: true });
};

const solutionOptionForAgreement = (agreement = {}, requestedSolutionId = '') => {
  const options = Array.isArray(agreement.planOptions) && agreement.planOptions.length
    ? agreement.planOptions
    : Array.isArray(agreement.solutionOptions)
      ? agreement.solutionOptions
      : [];
  if (!options.length) return null;

  const cleanRequestedId = String(
    requestedSolutionId ||
    agreement.selectedPlanId ||
    agreement.selectedSolutionId ||
    agreement.acceptedPlanId ||
    agreement.acceptedSolutionId ||
    agreement.defaultPlanId ||
    agreement.defaultSolutionId ||
    ''
  ).trim();

  return (
    options.find((option) => String(option.planId || option.solutionId || option.id || '').trim() === cleanRequestedId) ||
    options[0]
  );
};

const agreementWithSelectedSolution = (agreement = {}, requestedSolutionId = '') => {
  const selectedOption = solutionOptionForAgreement(agreement, requestedSolutionId);
  if (!selectedOption) return { agreement, selectedOption: null, selectedSolutionId: '' };

  const selectedSolutionId = selectedOption.planId || selectedOption.solutionId || selectedOption.id || '';
  const lineItems = Array.isArray(selectedOption.lineItems)
    ? selectedOption.lineItems
    : Array.isArray(agreement.lineItems)
      ? agreement.lineItems
      : [];
  const totalAmountCents = Number(
    selectedOption.totalAmountCents ??
    selectedOption.rateAmountCents ??
    lineItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0)
  );

  return {
    agreement: {
      ...agreement,
      selectedPlanId: selectedSolutionId,
      selectedSolutionId,
      acceptedPlanId: selectedSolutionId,
      acceptedSolutionId: selectedSolutionId,
      acceptedPlanTitle: selectedOption.title || selectedOption.name || '',
      acceptedSolutionTitle: selectedOption.title || selectedOption.name || '',
      acceptedPlanTier: selectedOption.planTier || selectedOption.solutionTier || null,
      acceptedSolutionTier: selectedOption.solutionTier || selectedOption.planTier || null,
      acceptedPlanTierLabel: selectedOption.planTierLabel || selectedOption.solutionTierLabel || '',
      acceptedSolutionTierLabel: selectedOption.solutionTierLabel || selectedOption.planTierLabel || '',
      lineItems,
      subtotalAmountCents: lineItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0),
      totalAmountCents,
      rateAmountCents: totalAmountCents,
    },
    selectedOption,
    selectedSolutionId,
  };
};

const prepareLinkedJobAcceptance = async ({
  transaction, agreement, selectedSolutionId, selectedSolutionOption,
  timestamp, actorUserId, actorUserName,
}) => {
  const companyId = agreement.companyId || '';
  const jobId = linkedJobIdForAgreement(agreement);
  if (!companyId || !jobId || !selectedSolutionId) return null;
  return prepareJobPlanWorkspace({
    db, transaction, companyId, jobId, planId: selectedSolutionId,
    selectedOption: selectedSolutionOption, accepted: true, timestamp, actorUserId, actorUserName,
    newId: (prefix) => `${prefix}_${uuidv4()}`,
    historyTitle: `Customer accepted plan: ${selectedSolutionOption?.title || selectedSolutionOption?.name || selectedSolutionId}`,
    jobUpdates: {
      salesAgreementId: agreement.id || agreement.agreementId || '', salesAgreementStatus: 'accepted',
      salesAgreementAcceptedAt: timestamp, salesAgreementStatusUpdatedAt: timestamp,
      salesAgreementStatusUpdatedByUserId: actorUserId, salesAgreementStatusUpdatedByUserName: actorUserName,
    },
  });
};

exports.applyJobPlanWorkspace = functions.https.onCall(async (data, context) => {
  const auth = await getCallableAuth(data, context, 'Sign in to update a job plan.');
  const request = getCallableData(data);
  const { companyId, jobId, planId, mode } = request;
  const validId = (value) => typeof value === 'string' && value.trim() && !value.includes('/');
  if (![companyId, jobId, planId].every(validId) || !['load', 'accept'].includes(mode) ||
      [request.agreementId, request.contractId].some((value) => value && !validId(value)) ||
      (mode !== 'accept' && (request.agreementId || request.contractId))) {
    throw new HttpsError('invalid-argument', 'Choose a company, job, plan, and load or accept action.');
  }
  const companyRef = db.collection('companies').doc(companyId);
  const [companySnap, jobSnap] = await Promise.all([companyRef.get(), companyRef.collection('workOrders').doc(jobId).get()]);
  if (!companySnap.exists || !jobSnap.exists) throw new HttpsError('not-found', 'This job is no longer available.');
  const job = jobSnap.data();
  const templateJob = Boolean(job.sourceTemplateId || job.jobTemplateId || (job.createdFromBasicWorkOrderForm && job.basicWorkOrderMode === 'template'));
  const permissions = mode === 'accept' ? ['24', '400'] : ['24', '72', '400'];
  if (templateJob) permissions.push('28');
  const allowed = companySnap.data().ownerId === auth.uid || await userHasAnyCompanyPermission(auth.uid, companyId, permissions);
  if (!allowed) throw new HttpsError('permission-denied', 'You do not have permission to update this job plan.');
  return db.runTransaction(async (transaction) => {
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const actorUserName = auth.token?.name || auth.token?.email || auth.uid;
    const agreementRef = request.agreementId ? db.collection(salesCollectionNames.agreements).doc(request.agreementId) : null;
    const contractRef = request.contractId ? db.collection('contracts').doc(request.contractId) : null;
    const [agreementSnap, contractSnap] = await Promise.all([
      agreementRef ? transaction.get(agreementRef) : null,
      contractRef ? transaction.get(contractRef) : null,
    ]);
    let selectedOption = null;
    if (agreementRef) {
      const agreement = agreementSnap?.data();
      if (!agreementSnap.exists || agreement.companyId !== companyId || linkedJobIdForAgreement(agreement) !== jobId) {
        throw new HttpsError('permission-denied', 'This estimate does not belong to the selected job.');
      }
      const selection = agreementWithSelectedSolution(agreement, planId);
      if (selection.selectedSolutionId && selection.selectedSolutionId !== planId) {
        throw new HttpsError('failed-precondition', 'This plan is not included in the selected estimate.');
      }
      selectedOption = selection.selectedOption;
    }
    if (contractRef) {
      const contract = contractSnap?.data();
      const contractJobId = typeof contract?.jobId === 'object' ? contract.jobId?.id : contract?.jobId;
      if (!contractSnap.exists || (contract.companyId || contract.senderId) !== companyId || contractJobId !== jobId) {
        throw new HttpsError('permission-denied', 'This legacy estimate does not belong to the selected job.');
      }
    }
    const prepared = await prepareJobPlanWorkspace({
      db, transaction, companyId, jobId, planId, accepted: mode === 'accept',
      timestamp, actorUserId: auth.uid, actorUserName, selectedOption,
      recordHistory: mode === 'accept' || request.recordHistory !== false, newId: (prefix) => `${prefix}_${uuidv4()}`,
      jobUpdates: agreementRef ? {
        salesAgreementId: request.agreementId, salesEstimateAgreementId: request.agreementId,
        salesAgreementStatus: 'accepted', salesAgreementAcceptedAt: timestamp,
      } : {},
    });
    prepared.apply();
    if (agreementRef) {
      const updates = {
        status: 'accepted', acceptedAt: timestamp, acceptedByUserId: auth.uid, acceptedByUserName: actorUserName,
        acceptedSource: 'internalManual', updatedAt: timestamp,
        selectedPlanId: planId, selectedSolutionId: planId, acceptedPlanId: planId, acceptedSolutionId: planId,
        defaultPlanId: planId, defaultSolutionId: planId,
        lineItems: prepared.jobUpdates.estimateLineItems, totalAmountCents: prepared.jobUpdates.rate,
        rateAmountCents: prepared.jobUpdates.rate, subtotalAmountCents: prepared.jobUpdates.estimateSubtotalCents,
      };
      transaction.set(agreementRef, {
        ...updates, acceptedSnapshot: {
          agreementId: request.agreementId, title: agreementSnap.data().title || 'Job estimate', ...updates,
          acceptedPlanTitle: prepared.plan.title || prepared.plan.name || '',
        },
      }, { merge: true });
    }
    if (contractRef) transaction.set(contractRef, {
      status: 'Accepted', receiverAcceptance: true, dateAccepted: timestamp, updatedAt: timestamp,
      ...(agreementRef ? { salesAgreementId: request.agreementId } : {}),
    }, { merge: true });
    return { planId, taskCount: prepared.scope.tasks.length, materialCount: prepared.scope.shoppingItems.length };
  });
});

const syncLinkedJobForAgreementStatus = async ({
  agreement,
  status,
  actorUserId = '',
  actorUserName = '',
  timestamp = admin.firestore.FieldValue.serverTimestamp(),
  selectedSolutionId = '',
  selectedSolutionOption = null,
  responseType = '',
  responseNote = '',
}) => {
  const companyId = agreement.companyId || '';
  const jobId = linkedJobIdForAgreement(agreement);
  if (!companyId || !jobId) return;

  if (normalizeStatus(status) === 'accepted' && selectedSolutionId) {
    return db.runTransaction(async (transaction) => {
      const prepared = await prepareLinkedJobAcceptance({ transaction, agreement, selectedSolutionId, selectedSolutionOption, timestamp, actorUserId, actorUserName });
      prepared?.apply();
    });
  }

  const jobRef = db.collection('companies').doc(companyId).collection('workOrders').doc(jobId);
  const jobDoc = await jobRef.get();
  if (!jobDoc.exists) return;

  const job = jobDoc.data() || {};
  const statusKey = normalizeStatus(status);
  const update = {
    salesAgreementId: agreement.id || agreement.agreementId || '',
    salesAgreementStatus: status,
    salesAgreementStatusUpdatedAt: timestamp,
    salesAgreementStatusUpdatedByUserId: actorUserId,
    salesAgreementStatusUpdatedByUserName: actorUserName,
    updatedAt: timestamp,
  };

  if (statusKey === 'accepted') {
    update.billingStatus = 'Accepted';
    update.salesAgreementAcceptedAt = timestamp;
    if (selectedSolutionId) {
      update.activePlanId = selectedSolutionId;
      update.acceptedPlanId = selectedSolutionId;
      update.activeSolutionId = selectedSolutionId;
      update.acceptedSolutionId = selectedSolutionId;
      update.planSelectionStatus = 'Accepted';
      update.solutionSelectionStatus = 'Accepted';
      update.acceptedPlanTitle = selectedSolutionOption?.title || selectedSolutionOption?.name || '';
      update.acceptedSolutionTitle = selectedSolutionOption?.title || selectedSolutionOption?.name || '';
      update.acceptedPlanTier = selectedSolutionOption?.planTier || selectedSolutionOption?.solutionTier || null;
      update.acceptedPlanTierLabel = selectedSolutionOption?.planTierLabel || selectedSolutionOption?.solutionTierLabel || '';
      update.activePlanTier = selectedSolutionOption?.planTier || selectedSolutionOption?.solutionTier || null;
      update.activePlanTierLabel = selectedSolutionOption?.planTierLabel || selectedSolutionOption?.solutionTierLabel || '';
      update.acceptedSolutionTier = selectedSolutionOption?.solutionTier || selectedSolutionOption?.planTier || null;
      update.acceptedSolutionTierLabel = selectedSolutionOption?.solutionTierLabel || selectedSolutionOption?.planTierLabel || '';
      update.activeSolutionTier = selectedSolutionOption?.solutionTier || selectedSolutionOption?.planTier || null;
      update.activeSolutionTierLabel = selectedSolutionOption?.solutionTierLabel || selectedSolutionOption?.planTierLabel || '';
      if (selectedSolutionOption?.totalAmountCents || selectedSolutionOption?.rateAmountCents) {
        update.rate = Number(selectedSolutionOption.totalAmountCents || selectedSolutionOption.rateAmountCents || 0);
      }
      const selectedLaborCostCents =
        selectedSolutionOption?.laborCostCents ||
        selectedSolutionOption?.costSummary?.plannedLaborCostCents ||
        0;
      if (selectedLaborCostCents) {
        update.laborCost = Number(selectedLaborCostCents || 0);
      }
    }
    if (!job.operationStatus || ['Estimate Pending', 'Unscheduled'].includes(job.operationStatus)) {
      update.operationStatus = 'Unscheduled';
    }
  }

  if (statusKey === 'sent') {
    update.billingStatus = 'Estimate';
    update.salesAgreementSentAt = timestamp;
    if (!job.operationStatus || job.operationStatus === 'Estimate Pending') {
      update.operationStatus = 'Estimate Pending';
    }
  }

  if (statusKey === 'rejected') {
    const changeRequest = responseType === 'changesRequested';
    update.billingStatus = 'Rejected';
    update.salesAgreementRejectedAt = timestamp;
    update.salesAgreementCustomerResponseType = responseType || 'rejected';
    update.salesAgreementResponseNote = responseNote || '';
    update.planSelectionStatus = changeRequest ? 'Changes Requested' : 'Rejected';
    update.solutionSelectionStatus = changeRequest ? 'Changes Requested' : 'Rejected';

    if (!job.operationStatus || ['Estimate Pending', 'Unscheduled'].includes(job.operationStatus)) {
      update.operationStatus = 'Estimate Pending';
    }
  }

  await jobRef.set(update, { merge: true });

  if (statusKey === 'rejected') {
    const changeRequest = responseType === 'changesRequested';
    const responseLabel = changeRequest ? 'Customer requested estimate changes' : 'Customer rejected estimate';
    const responseDescription = responseNote || (changeRequest
      ? 'Customer requested a different plan or estimate revision.'
      : 'Customer declined all estimate options.');
    const commentId = `comp_wo_com_${uuidv4()}`;
    const historyId = `comp_job_hist_${uuidv4()}`;

    await Promise.all([
      jobRef.collection('comments').doc(commentId).set({
        id: commentId,
        jobId,
        companyId,
        userId: actorUserId || '',
        userName: actorUserName || 'Customer',
        authorId: actorUserId || '',
        authorName: actorUserName || 'Customer',
        date: timestamp,
        dateMillis: Date.now(),
        comment: [responseLabel, responseNote].filter(Boolean).join('\n'),
        resolved: false,
        sourceType: changeRequest ? 'estimateChangesRequested' : 'estimateRejected',
        metadata: {
          salesAgreementId: agreement.id || agreement.agreementId || '',
          responseType: responseType || 'rejected',
        },
      }),
      jobRef.collection('history').doc(historyId).set({
        id: historyId,
        companyId,
        jobId,
        eventType: 'Billing',
        title: responseLabel,
        description: responseDescription,
        changes: [
          { field: 'billingStatus', label: 'Billing Status', before: job.billingStatus || '—', after: 'Rejected' },
          {
            field: 'planSelectionStatus',
            label: 'Plan Selection',
            before: job.planSelectionStatus || job.solutionSelectionStatus || '—',
            after: changeRequest ? 'Changes Requested' : 'Rejected',
          },
        ],
        metadata: {
          salesAgreementId: agreement.id || agreement.agreementId || '',
          responseType: responseType || 'rejected',
        },
        severity: changeRequest ? 'warning' : 'danger',
        actorUserId: actorUserId || '',
        actorUserName: actorUserName || 'Customer',
        createdAt: timestamp,
        createdAtMillis: Date.now(),
      }),
    ]);
  }
};

const mapStripeSubscriptionStatus = (status) => {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'past_due' || status === 'unpaid') return 'pastDue';
  if (status === 'canceled' || status === 'incomplete_expired') return 'canceled';
  if (status === 'paused') return 'paused';
  return 'pendingStripe';
};

const nextActionForStripeSubscriptionStatus = (status) => {
  if (status === 'active' || status === 'trialing') return 'monitorBilling';
  if (status === 'past_due' || status === 'unpaid') return 'collectPaymentMethod';
  if (status === 'incomplete') return 'completeCheckout';
  if (status === 'paused') return 'resumeSubscription';
  if (status === 'canceled' || status === 'incomplete_expired') return 'reviewCanceledSubscription';
  return 'reviewStripeStatus';
};

const cadenceToStripeInterval = (cadence = '', rateType = '') => {
  const cadenceKey = normalizeStatus(cadence);
  const rateKey = normalizeStatus(rateType);

  if (cadenceKey.includes('week') || rateKey.includes('week')) return 'week';
  if (cadenceKey.includes('year') || cadenceKey.includes('annual') || rateKey.includes('year') || rateKey.includes('annual')) return 'year';
  if (cadenceKey.includes('day') || rateKey.includes('day')) return 'day';
  return 'month';
};

const billingFrequencyForAgreement = (agreement = {}) => (
  agreement.billingFrequency ||
  agreement.billingCadence ||
  agreement.invoiceFrequency ||
  agreement.serviceCadence ||
  agreement.rateType ||
  'monthly'
);

const billingFrequencyCountForAgreement = (agreement = {}) => Math.max(Number(
  agreement.billingFrequencyCount ||
  agreement.billingCadenceCount ||
  agreement.invoiceFrequencyCount ||
  agreement.serviceCadenceCount ||
  1
), 1);

const billingIntervalCountForAgreement = (agreement = {}) => {
  const frequencyKey = normalizeStatus(billingFrequencyForAgreement(agreement));
  if (frequencyKey === 'biweekly') return 2;
  if (frequencyKey === 'quarterly') return 3;
  return billingFrequencyCountForAgreement(agreement);
};

const serviceFrequencyForAgreement = (agreement = {}) => (
  agreement.serviceCadence ||
  agreement.serviceFrequency ||
  ''
);

const serviceFrequencyCountForAgreement = (agreement = {}) => Math.max(Number(
  agreement.serviceCadenceCount ||
  agreement.serviceFrequencyCount ||
  1
), 1);

const copyLineItemsForBilling = (lineItems = []) => (
  Array.isArray(lineItems)
    ? lineItems.map((item) => ({
      id: item.id || item.catalogItemId || '',
      catalogItemId: item.catalogItemId || '',
      sourceType: item.sourceType || 'manual',
      sourceId: item.sourceId || '',
      name: item.name || item.description || 'Service',
      description: item.description || '',
      quantity: Number(item.quantity ?? 1),
      unitAmountCents: Number(item.unitAmountCents || 0),
      totalAmountCents: Number(item.totalAmountCents || 0),
      taxable: Boolean(item.taxable),
      type: item.type || '',
      stripeProductId: item.stripeProductId || '',
      stripePriceId: item.stripePriceId || '',
      metadata: item.metadata || {},
    }))
    : []
);

const copyList = (value) => (
  Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : String(value || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
);

const buildSalesBillingSubscriptionFromAgreement = ({ agreement, stripeConnectedAccountId }) => {
  const lineItems = copyLineItemsForBilling(agreement.lineItems);
  const amountCents = Number(agreement.totalAmountCents || agreement.rateAmountCents || 0);
  const canStartStripeCheckout = Boolean(stripeConnectedAccountId) && amountCents > 0;
  const billingFrequency = billingFrequencyForAgreement(agreement);
  const billingFrequencyCount = billingFrequencyCountForAgreement(agreement);
  const serviceCadence = serviceFrequencyForAgreement(agreement);
  const serviceCadenceCount = serviceFrequencyCountForAgreement(agreement);

  return {
    id: agreement.billingSubscriptionId || `sbs_${agreement.id}`,
    companyId: agreement.companyId,
    customerId: agreement.customerId || '',
    customerUserId: agreement.customerUserId || null,
    relationshipId: agreement.relationshipId || agreement.customerCompanyRelationshipId || '',
    customerCompanyRelationshipId: agreement.customerCompanyRelationshipId || agreement.relationshipId || '',
    customerName: agreement.customerName || '',
    email: agreement.email || '',
    serviceLocationIds: Array.isArray(agreement.serviceLocationIds) ? agreement.serviceLocationIds : [],
    agreementId: agreement.id,
    billingProfileId: agreement.billingProfileId || '',
    stripeConnectedAccountId: stripeConnectedAccountId || '',
    stripeCustomerId: agreement.stripeCustomerId || '',
    stripeProductId: '',
    stripePriceId: '',
    stripeSubscriptionId: '',
    stripeSubscriptionItemId: '',
    stripeLatestInvoiceId: '',
    stripeDefaultPaymentMethodId: '',
    billingMode: 'connectedAccountDirectCharge',
    billingCollectionMethod: 'manualUntilAutopay',
    status: canStartStripeCheckout ? 'pendingPaymentMethod' : 'notStarted',
    stripeStatus: '',
    autopayStatus: canStartStripeCheckout ? 'available' : 'unavailable',
    autopayEnabled: false,
    amountCents,
    billingTimeZone: agreement.billingTimeZone || 'UTC',
    taxAmountCents: Number(agreement.taxAmountCents || 0),
    discountAmountCents: Number(agreement.discountAmountCents || 0),
    currency: agreement.currency || 'usd',
    interval: cadenceToStripeInterval(billingFrequency, agreement.rateType),
    intervalCount: billingIntervalCountForAgreement(agreement),
    billingFrequency,
    billingFrequencyCount,
    serviceCadence,
    serviceCadenceCount,
    serviceDaysOfWeek: Array.isArray(agreement.serviceDaysOfWeek) ? agreement.serviceDaysOfWeek : [],
    serviceFrequencyLabel: agreement.serviceFrequencyLabel || '',
    previousAgreementId: agreement.previousAgreementId || agreement.supersedesAgreementId || '',
    supersedesAgreementId: agreement.supersedesAgreementId || agreement.previousAgreementId || '',
    agreementHistoryGroupId: agreementHistoryGroupId(agreement),
    agreementVersion: Math.max(Number(agreement.agreementVersion || 1), 1),
    rateType: agreement.rateType || '',
    paymentTerms: agreement.paymentTerms || 'dueOnReceipt',
    invoiceDeliveryMethod: agreement.invoiceDeliveryMethod || 'email',
    firstInvoiceSendAt: agreement.firstInvoiceSendAt || agreement.manualBillingNextInvoiceAt || agreement.startDate || null,
    lineItems,
    chemicalBillingMode: agreement.chemicalBillingMode || 'includedAll',
    includedChemicalIds: copyList(agreement.includedChemicalIds),
    includedChemicalKeywords: copyList(agreement.includedChemicalKeywords),
    separatelyBilledChemicalIds: copyList(agreement.separatelyBilledChemicalIds),
    separatelyBilledChemicalKeywords: copyList(agreement.separatelyBilledChemicalKeywords),
    customerPurchasedChemicalIds: copyList(agreement.customerPurchasedChemicalIds),
    customerPurchasedChemicalKeywords: copyList(agreement.customerPurchasedChemicalKeywords),
    chemicalBillingNotes: agreement.chemicalBillingNotes || '',
    agreementSnapshot: {
      agreementId: agreement.id,
      title: agreement.title || 'Service Agreement',
      customerName: agreement.customerName || '',
      customerId: agreement.customerId || '',
      customerUserId: agreement.customerUserId || null,
      relationshipId: agreement.relationshipId || agreement.customerCompanyRelationshipId || '',
      customerCompanyRelationshipId: agreement.customerCompanyRelationshipId || agreement.relationshipId || '',
      email: agreement.email || '',
      termsTemplateId: agreement.termsTemplateId || '',
      termsTemplateName: agreement.termsTemplateName || '',
      revisionNumber: String(agreement.revisionNumber || 0),
      billingFrequency,
      billingFrequencyCount: String(billingFrequencyCount),
      firstInvoiceSendAt: agreement.firstInvoiceSendAt || agreement.manualBillingNextInvoiceAt || agreement.startDate || null,
      manualBillingAutoSendEnabled: agreement.manualBillingAutoSendEnabled === true,
      serviceCadence,
      serviceCadenceCount: String(serviceCadenceCount),
      serviceDaysOfWeek: Array.isArray(agreement.serviceDaysOfWeek) ? agreement.serviceDaysOfWeek : [],
      serviceFrequencyLabel: agreement.serviceFrequencyLabel || '',
      previousAgreementId: agreement.previousAgreementId || agreement.supersedesAgreementId || '',
      supersedesAgreementId: agreement.supersedesAgreementId || agreement.previousAgreementId || '',
      agreementHistoryGroupId: agreementHistoryGroupId(agreement),
      agreementVersion: String(Math.max(Number(agreement.agreementVersion || 1), 1)),
      chemicalBillingMode: agreement.chemicalBillingMode || 'includedAll',
      includedChemicalIds: copyList(agreement.includedChemicalIds),
      includedChemicalKeywords: copyList(agreement.includedChemicalKeywords),
      separatelyBilledChemicalIds: copyList(agreement.separatelyBilledChemicalIds),
      separatelyBilledChemicalKeywords: copyList(agreement.separatelyBilledChemicalKeywords),
      customerPurchasedChemicalIds: copyList(agreement.customerPurchasedChemicalIds),
      customerPurchasedChemicalKeywords: copyList(agreement.customerPurchasedChemicalKeywords),
      chemicalBillingNotes: agreement.chemicalBillingNotes || '',
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    checkoutSessionId: '',
    checkoutUrl: '',
    checkoutStatus: 'notStarted',
    nextAction: canStartStripeCheckout ? 'collectPaymentMethod' : 'connectStripeAccount',
    customerCanPayImmediately: canStartStripeCheckout,
    manualBillingEnabled: true,
    manualBillingAutoSendEnabled: agreement.manualBillingAutoSendEnabled === true,
    manualBillingNextInvoiceAt: agreement.manualBillingNextInvoiceAt || agreement.firstInvoiceSendAt || agreement.startDate || admin.firestore.Timestamp.now(),
    manualBillingNextDueDate: null,
    manualBillingStatus: 'readyToInvoice',
    manualBillingReason: canStartStripeCheckout ? 'autopayNotSetup' : 'stripeUnavailable',
    receiptDeliveryMethod: agreement.receiptDeliveryMethod || agreement.invoiceDeliveryMethod || 'email',
    receiptsEnabled: agreement.receiptsEnabled !== false,
    lastBillingSource: '',
    stripeReadiness: {
      canStartStripeCheckout,
      hasConnectedAccount: Boolean(stripeConnectedAccountId),
      missingStripePriceItemIds: lineItems
        .filter((item) => !item.stripePriceId)
        .map((item) => item.id || item.catalogItemId || item.name)
        .filter(Boolean),
      canUseInlineStripePrices: true,
    },
    currentPeriodStart: agreement.startDate || null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    paymentMethodType: '',
    stripePaymentMethodType: '',
    paymentMethodLabel: '',
    applicationFeePercent: null,
    platformFeeSource: '',
  };
};

const requireCompanyManagerForSalesSubscription = async ({ auth, billingSubscriptionId, companyId }) => {
  if (!auth?.uid) {
    throw new HttpsError('unauthenticated', 'You must be signed in to manage billing subscriptions.');
  }

  if (!billingSubscriptionId || !companyId) {
    throw new HttpsError('invalid-argument', 'billingSubscriptionId and companyId are required.');
  }

  const subscriptionRef = db.collection(salesCollectionNames.billingSubscriptions).doc(billingSubscriptionId);
  const subscriptionSnap = await subscriptionRef.get();

  if (!subscriptionSnap.exists) {
    throw new HttpsError('not-found', 'Billing subscription was not found.');
  }

  const subscription = { id: subscriptionSnap.id, ...subscriptionSnap.data() };

  if (subscription.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'This billing subscription belongs to another company.');
  }

  const hasAccess = await hasActiveCompanyPermission(db, companyId, auth.uid, ['404']);
  if (!hasAccess) {
    throw new HttpsError('permission-denied', 'You do not have access to manage billing for this company.');
  }

  return { subscriptionRef, subscription };
};

const findCompanyByConnectedAccountId = async (connectedAccount) => {
  const accountId = normalizeStripeAccountId(connectedAccount);
  if (!accountId) return null;

  const primarySnapshot = await db
    .collection('companies')
    .where('stripeConnectedAccountId', '==', accountId)
    .limit(1)
    .get();

  if (!primarySnapshot.empty) {
    const docSnap = primarySnapshot.docs[0];
    return { ref: docSnap.ref, data: { id: docSnap.id, ...docSnap.data() } };
  }

  const legacySnapshot = await db
    .collection('companies')
    .where('stripeConnectAccountId', '==', accountId)
    .limit(1)
    .get();

  if (legacySnapshot.empty) return null;

  const docSnap = legacySnapshot.docs[0];
  return { ref: docSnap.ref, data: { id: docSnap.id, ...docSnap.data() } };
};

const requireManagedConnectedAccount = async ({ data, context, message }) => {
  const callableAuth = await getCallableAuth(
    data,
    context,
    message || 'You must be signed in to manage this Stripe connected account.'
  );
  const receivedData = getCallableData(data);
  const requestedAccount = normalizeStripeAccountId(
    receivedData.connectedAccount ||
    receivedData.stripeConnectedAccountId ||
    receivedData.accountId
  );
  const companyId = String(receivedData.companyId || '').trim();

  let company = null;
  if (companyId) {
    const companyRef = db.collection('companies').doc(companyId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      throw new HttpsError('not-found', 'Company was not found.');
    }

    company = { ref: companyRef, data: { id: companySnap.id, ...companySnap.data() } };
  } else if (requestedAccount) {
    company = await findCompanyByConnectedAccountId(requestedAccount);
  }

  if (!company) {
    throw new HttpsError('invalid-argument', 'companyId or a saved connected account id is required.');
  }

  const hasAccess = await hasActiveCompanyPermission(db, company.data.id, callableAuth.uid, ['404']);
  if (!hasAccess) {
    throw new HttpsError('permission-denied', 'You do not have access to this company Stripe account.');
  }

  const companyConnectedAccount = getCompanyConnectedAccountId(company.data);
  if (!companyConnectedAccount) {
    throw new HttpsError('failed-precondition', 'This company does not have a Stripe connected account yet.');
  }

  if (requestedAccount && requestedAccount !== companyConnectedAccount) {
    throw new HttpsError('permission-denied', 'Connected account does not belong to this company.');
  }

  return {
    auth: callableAuth,
    companyId: company.data.id,
    companyRef: company.ref,
    companyData: company.data,
    connectedAccount: companyConnectedAccount,
    receivedData,
  };
};

const buildStripeSubscriptionUpdateData = ({ stripeSubscription, connectedAccount }) => {
  const firstItem = stripeSubscription.items?.data?.[0] || {};
  const stripeStatus = stripeSubscription.status || '';
  const status = mapStripeSubscriptionStatus(stripeStatus);
  const nextAction = nextActionForStripeSubscriptionStatus(stripeStatus);
  const autopayIsActive = ['active', 'trialing'].includes(stripeStatus);
  const stripeManagedBilling = ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(stripeStatus);
  const autopayStatus = autopayIsActive
    ? 'active'
    : status === 'pastDue'
      ? 'pastDue'
      : status === 'canceled'
        ? 'canceled'
        : 'checkoutStarted';

  return {
    stripeConnectedAccountId: connectedAccount || stripeSubscription.metadata?.stripeConnectedAccountId || '',
    stripeCustomerId: typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : stripeSubscription.customer?.id || '',
    stripeSubscriptionId: stripeSubscription.id,
    stripeSubscriptionItemId: firstItem.id || '',
    stripePriceId: firstItem.price?.id || '',
    stripeProductId: typeof firstItem.price?.product === 'string'
      ? firstItem.price.product
      : firstItem.price?.product?.id || '',
    stripeLatestInvoiceId: typeof stripeSubscription.latest_invoice === 'string'
      ? stripeSubscription.latest_invoice
      : stripeSubscription.latest_invoice?.id || '',
    stripeDefaultPaymentMethodId: typeof stripeSubscription.default_payment_method === 'string'
      ? stripeSubscription.default_payment_method
      : stripeSubscription.default_payment_method?.id || '',
    stripeStatus,
    status,
    nextAction,
    billingCollectionMethod: stripeManagedBilling ? 'automaticStripe' : 'manualUntilAutopay',
    autopayStatus,
    autopayEnabled: autopayIsActive,
    manualBillingEnabled: !stripeManagedBilling,
    manualBillingAutoSendEnabled: !stripeManagedBilling,
    manualBillingStatus: autopayIsActive
      ? 'disabledAutopayActive'
      : stripeManagedBilling
        ? 'disabledStripeBillingActive'
        : 'readyToInvoice',
    manualBillingReason: autopayIsActive
      ? 'stripeAutopayActive'
      : stripeManagedBilling
        ? 'stripeAutopayNeedsAttention'
        : 'autopayNotActive',
    receiptDeliveryMethod: stripeManagedBilling ? 'stripeHostedInvoice' : 'email',
    receiptsEnabled: true,
    lastBillingSource: 'stripeSubscriptionSync',
    customerCanPayImmediately: false,
    checkoutStatus: ['active', 'trialing'].includes(stripeStatus) ? 'completed' : 'synced',
    currentPeriodStart: timestampFromStripeSeconds(stripeSubscription.current_period_start),
    currentPeriodEnd: timestampFromStripeSeconds(stripeSubscription.current_period_end),
    cancelAtPeriodEnd: Boolean(stripeSubscription.cancel_at_period_end),
    canceledAt: timestampFromStripeSeconds(stripeSubscription.canceled_at),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    stripeSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
};

const syncSalesSubscriptionRecordFromStripe = async ({
  subscriptionRef,
  subscription,
  stripeSubscription,
  connectedAccount,
}) => {
  await require('../stripeLifecycle').createStripeLifecycle(db, stripe).syncSubscription({
    id: `operator_${uuidv4()}`, type: 'customer.subscription.updated', account: connectedAccount,
  }, stripeSubscription.id);
  return (await subscriptionRef.get()).data();
};

const createConnectedAccountPriceForSalesLineItem = async ({ connectedAccount, subscription, item, index }) => {
  if (item.stripePriceId) {
    return {
      stripePriceId: item.stripePriceId,
      stripeProductId: item.stripeProductId || '',
      created: false,
    };
  }

  const quantity = Math.max(Number(item.quantity || 1), 1);
  const unitAmount = Number(item.unitAmountCents || Math.round(Number(item.totalAmountCents || 0) / quantity));

  if (!unitAmount || unitAmount < 1) {
    throw new HttpsError(
      'failed-precondition',
      `Line item "${item.name || item.description || index + 1}" needs an amount before it can be added to Stripe.`
    );
  }

  const interval = normalizeStripeInterval(subscription.interval || subscription.serviceCadence || subscription.rateType);
  const intervalCount = Math.max(Number(subscription.intervalCount || 1), 1);
  const currency = String(subscription.currency || 'usd').toLowerCase();
  const name = item.name || item.description || `Service ${index + 1}`;

  const product = await stripe.products.create({
    name,
    description: item.description || undefined,
    metadata: {
      companyId: subscription.companyId || '',
      salesBillingSubscriptionId: subscription.id || '',
      salesAgreementId: subscription.agreementId || '',
      salesCatalogItemId: item.catalogItemId || '',
      salesLineItemId: item.id || '',
      sourceType: item.sourceType || 'manual',
      sourceId: item.sourceId || '',
    },
  }, {
    stripeAccount: connectedAccount,
  });

  const price = await stripe.prices.create({
    currency,
    unit_amount: unitAmount,
    recurring: {
      interval,
      interval_count: intervalCount,
    },
    product: product.id,
    metadata: {
      companyId: subscription.companyId || '',
      salesBillingSubscriptionId: subscription.id || '',
      salesAgreementId: subscription.agreementId || '',
      salesCatalogItemId: item.catalogItemId || '',
      salesLineItemId: item.id || '',
    },
  }, {
    stripeAccount: connectedAccount,
  });

  return {
    stripePriceId: price.id,
    stripeProductId: product.id,
    created: true,
  };
};

const createConnectedAccountStripeObjectForSalesCatalogItem = async ({
  connectedAccount,
  companyId,
  catalogItemId,
  catalogItem,
}) => {
  const existingProductId = String(catalogItem.stripeProductId || '').trim();
  const existingPriceId = String(catalogItem.stripePriceId || '').trim();
  const currency = String(catalogItem.currency || 'usd').toLowerCase();
  const unitAmount = Math.round(Number(catalogItem.unitAmountCents || 0));
  const billingBehavior = String(catalogItem.billingBehavior || 'oneTime');
  const recurringInterval = normalizeStripeInterval(catalogItem.stripeRecurringInterval || 'month');
  const recurringIntervalCount = Math.max(Number(catalogItem.stripeRecurringIntervalCount || 1), 1);
  const name = String(catalogItem.name || '').trim() || 'Service';
  const description = String(catalogItem.description || '').trim();
  const metadata = {
    companyId: String(companyId || ''),
    salesCatalogItemId: String(catalogItemId || ''),
    sourceType: String(catalogItem.sourceType || 'manual'),
    sourceId: String(catalogItem.sourceId || ''),
  };

  if (!Number.isFinite(unitAmount) || unitAmount < 0) {
    throw new HttpsError(
      'failed-precondition',
      'Service price must be zero or greater before creating a Stripe object.'
    );
  }

  let productId = existingProductId;
  let priceId = existingPriceId;
  let createdProduct = false;
  let createdPrice = false;

  if (priceId) {
    try {
      const price = await stripe.prices.retrieve(priceId, { expand: ['product'] }, {
        stripeAccount: connectedAccount,
      });
      if (!productId) {
        productId = typeof price.product === 'string' ? price.product : price.product?.id || '';
      }
    } catch (error) {
      console.warn('Saved Stripe price could not be retrieved. A new price will be created.', {
        companyId,
        catalogItemId,
        priceId,
        error: error.message,
      });
      priceId = '';
    }
  }

  if (productId) {
    try {
      const product = await stripe.products.retrieve(productId, {}, {
        stripeAccount: connectedAccount,
      });
      if (product?.deleted) productId = '';
    } catch (error) {
      console.warn('Saved Stripe product could not be retrieved. A new product will be created.', {
        companyId,
        catalogItemId,
        productId,
        error: error.message,
      });
      productId = '';
    }
  }

  if (!productId) {
    const product = await stripe.products.create({
      name,
      description: description || undefined,
      metadata,
    }, {
      stripeAccount: connectedAccount,
      idempotencyKey: `sales-catalog-product-${companyId}-${catalogItemId}`,
    });

    productId = product.id;
    createdProduct = true;
  }

  if (!priceId) {
    const pricePayload = {
      currency,
      unit_amount: unitAmount,
      product: productId,
      metadata,
    };

    if (billingBehavior === 'recurring') {
      pricePayload.recurring = {
        interval: recurringInterval,
        interval_count: recurringIntervalCount,
      };
    }

    const price = await stripe.prices.create(pricePayload, {
      stripeAccount: connectedAccount,
      idempotencyKey: [
        'sales-catalog-price',
        companyId,
        catalogItemId,
        currency,
        unitAmount,
        billingBehavior,
        billingBehavior === 'recurring' ? recurringInterval : 'one-time',
        billingBehavior === 'recurring' ? recurringIntervalCount : 1,
      ].join('-'),
    });

    priceId = price.id;
    createdPrice = true;
  }

  return {
    stripeConnectedAccountId: connectedAccount,
    stripeProductId: productId,
    stripePriceId: priceId,
    createdProduct,
    createdPrice,
  };
};

exports.createStripeObjectForSalesCatalogItem = functions.https.onCall(async (data, context) => {
  const callableAuth = await getCallableAuth(
    data,
    context,
    'You must be signed in to create Stripe objects for service catalog items.'
  );
  const receivedData = getCallableData(data);
  const companyId = String(receivedData.companyId || '').trim();
  const catalogItemId = String(receivedData.catalogItemId || '').trim();

  if (!companyId || !catalogItemId) {
    throw new HttpsError('invalid-argument', 'companyId and catalogItemId are required.');
  }

  const companyRef = db.collection('companies').doc(companyId);
  const companySnap = await companyRef.get();

  if (!companySnap.exists) {
    throw new HttpsError('not-found', 'Company was not found.');
  }

  const companyData = companySnap.data() || {};
  const hasAccess = await hasActiveCompanyPermission(db, companyId, callableAuth.uid, ['404']);

  if (!hasAccess) {
    throw new HttpsError(
      'permission-denied',
      'You do not have access to manage this company service catalog.'
    );
  }

  const connectedAccount = getCompanyConnectedAccountId(companyData);
  if (!connectedAccount) {
    throw new HttpsError(
      'failed-precondition',
      'Connect this company to Stripe before creating Stripe objects for catalog services.'
    );
  }

  const catalogItemRef = companyRef.collection(salesCollectionNames.catalogItems).doc(catalogItemId);
  const catalogItemSnap = await catalogItemRef.get();

  if (!catalogItemSnap.exists) {
    throw new HttpsError('not-found', 'Service catalog item was not found.');
  }

  const catalogItem = { id: catalogItemSnap.id, ...catalogItemSnap.data() };
  if (catalogItem.companyId && catalogItem.companyId !== companyId) {
    throw new HttpsError(
      'permission-denied',
      'This service catalog item belongs to another company.'
    );
  }

  try {
    const stripeObject = await createConnectedAccountStripeObjectForSalesCatalogItem({
      connectedAccount,
      companyId,
      catalogItemId,
      catalogItem,
    });

    await catalogItemRef.set({
      stripeConnectedAccountId: stripeObject.stripeConnectedAccountId,
      stripeProductId: stripeObject.stripeProductId,
      stripePriceId: stripeObject.stripePriceId,
      stripeObjectUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      stripeObjectUpdatedByUserId: callableAuth.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return stripeObject;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Unable to create Stripe object for sales catalog item', {
      companyId,
      catalogItemId,
      error,
    });
    throw new HttpsError(
      'internal',
      error.message || 'Unable to create Stripe object for this service.'
    );
  }
});

exports.acceptSalesServiceAgreement = functions.https.onCall(async (data, context) => {
  const callableAuth = await getCallableAuth(data, context, 'You must be signed in to accept a service agreement.');
  const receivedData = getCallableData(data);
  const agreementId = receivedData.agreementId;
  const requestedSolutionId = String(receivedData.selectedPlanId || receivedData.selectedSolutionId || '').trim();
  const acceptanceNote = String(receivedData.acceptanceNote || '').trim();
  const requestedAcceptanceSource = normalizeStatus(receivedData.acceptanceSource || receivedData.acceptedSource || '');
  const acceptedSource = {
    customeroffline: 'customerOffline',
    internalmanual: 'internalManual',
    customerportal: 'customerPortal',
    emaillink: 'emailLink',
  }[requestedAcceptanceSource] || 'customerPortal';
  const acceptanceConfirmation = validateAgreementAcceptance(receivedData);
  const acceptanceAudit = getAgreementAcceptanceAudit(context);

  if (!agreementId) {
    throw new HttpsError('invalid-argument', 'agreementId is required.');
  }

  const agreementRef = db.collection(salesCollectionNames.agreements).doc(agreementId);
  const agreementSnap = await agreementRef.get();

  if (!agreementSnap.exists) {
    throw new HttpsError('not-found', 'Service agreement was not found.');
  }

  const agreement = { id: agreementSnap.id, ...agreementSnap.data() };
  const canAccess = await userCanAccessSalesRecord({ auth: callableAuth, record: agreement });

  if (!canAccess) {
    throw new HttpsError('permission-denied', 'This service agreement does not belong to your account.');
  }

  const statusKey = normalizeStatus(agreement.status);
  if (['accepted', 'canceled', 'rejected', 'expired', 'superseded'].includes(statusKey) || agreementIsExpired(agreement)) {
    throw new HttpsError('failed-precondition', 'This service agreement is no longer available to accept.');
  }

  const {
    agreement: acceptanceAgreement,
    selectedOption: selectedSolutionOption,
    selectedSolutionId,
  } = agreementWithSelectedSolution(agreement, requestedSolutionId);

  const companyDoc = await db.collection('companies').doc(acceptanceAgreement.companyId).get();
  const companyData = companyDoc.exists ? companyDoc.data() : {};
  const companyBillingEnabled = companyCustomerBillingEnabled(companyData);
  const requestedBillingPreference = normalizeCustomerBillingPreference(
    receivedData.customerBillingPreference ||
    receivedData.billingPreference ||
    receivedData.paymentPreference ||
    receivedData.paymentCollectionPreference ||
    '',
    ''
  );
  const createBillingSubscriptionOnAcceptance = requestedBillingPreference
    ? requestedBillingPreference === 'payNow'
    : shouldCreateBillingSubscriptionFromRequest(receivedData, companyData);
  const customerBillingPreference = requestedBillingPreference || (
    createBillingSubscriptionOnAcceptance ? 'payNow' : 'requestInvoice'
  );
  const salesBillingAutomationEnabled = (
    companyBillingEnabled &&
    createBillingSubscriptionOnAcceptance &&
    agreementSupportsBillingSubscription(acceptanceAgreement)
  );
  const agreementBillingSubscriptionEligible = agreementSupportsBillingSubscription(acceptanceAgreement);
  const billingSkippedReason = !companyBillingEnabled
    ? 'billingAutomationDisabled'
    : !agreementBillingSubscriptionEligible
      ? 'oneTimeAgreement'
      : 'acceptanceBillingSkipped';
  const skippedBillingFlowStatus = !companyBillingEnabled
    ? 'billingDisabled'
    : !agreementBillingSubscriptionEligible
      ? 'billingNotApplicable'
      : 'notStarted';
  const skippedBillingFlowNextAction = !companyBillingEnabled
    ? 'enableBillingAutomation'
    : !agreementBillingSubscriptionEligible
      ? 'convertToInvoice'
      : 'createBillingSubscription';
  const skippedBillingCollectionMethod = companyBillingEnabled ? 'manualInvoices' : 'externalBilling';
  const stripeConnectedAccountId = acceptanceAgreement.stripeConnectedAccountId || companyData.stripeConnectedAccountId || '';
  const subscriptionDraft = buildSalesBillingSubscriptionFromAgreement({ agreement: acceptanceAgreement, stripeConnectedAccountId });
  const subscriptionRef = db.collection(salesCollectionNames.billingSubscriptions).doc(subscriptionDraft.id);
  const acceptedAt = admin.firestore.FieldValue.serverTimestamp();
  const acceptedByEmail = callableAuth.token?.email || agreement.email || '';
  const acceptedByName = String(receivedData.acceptedByName || receivedData.acceptedByUserName || '').trim()
    || callableAuth.token?.name
    || agreement.customerName
    || acceptedByEmail
    || 'Customer';

  await db.runTransaction(async (transaction) => {
    const freshAgreementSnap = await transaction.get(agreementRef);
    const subscriptionSnap = salesBillingAutomationEnabled
      ? await transaction.get(subscriptionRef)
      : null;

    if (!freshAgreementSnap.exists) {
      throw new HttpsError('not-found', 'Service agreement was not found.');
    }

    const freshSelection = agreementWithSelectedSolution({ id: freshAgreementSnap.id, ...freshAgreementSnap.data() }, selectedSolutionId);
    if (freshSelection.selectedSolutionId !== selectedSolutionId) {
      throw new HttpsError('failed-precondition', 'The estimate plan options have changed. Reload the estimate before accepting.');
    }
    const freshAgreement = freshSelection.agreement;
    const freshStatusKey = normalizeStatus(freshAgreement.status);

    if (['accepted', 'canceled', 'rejected', 'expired', 'superseded'].includes(freshStatusKey) || agreementIsExpired(freshAgreement)) {
      throw new HttpsError('failed-precondition', 'This service agreement is no longer available to accept.');
    }

    const existingSubscription = subscriptionSnap?.exists
      ? { id: subscriptionSnap.id, ...subscriptionSnap.data() }
      : null;
    const hasStripeSubscription = Boolean(existingSubscription?.stripeSubscriptionId);
    const existingStatusKey = normalizeStatus(existingSubscription?.stripeStatus || existingSubscription?.status);
    const existingAutopayActive = hasStripeSubscription && ['active', 'trialing'].includes(existingStatusKey);
    const existingStripeManagedBilling = hasStripeSubscription && ['active', 'trialing', 'pastdue', 'unpaid', 'paused'].includes(existingStatusKey);
    const nextSubscription = {
      ...subscriptionDraft,
      ...existingSubscription,
      companyId: subscriptionDraft.companyId,
      customerId: subscriptionDraft.customerId,
      customerUserId: subscriptionDraft.customerUserId || callableAuth.uid,
      relationshipId: subscriptionDraft.relationshipId,
      customerCompanyRelationshipId: subscriptionDraft.customerCompanyRelationshipId,
      customerName: subscriptionDraft.customerName,
      email: subscriptionDraft.email || acceptedByEmail,
      serviceLocationIds: subscriptionDraft.serviceLocationIds,
      agreementId: subscriptionDraft.agreementId,
      billingProfileId: subscriptionDraft.billingProfileId,
      stripeConnectedAccountId: subscriptionDraft.stripeConnectedAccountId,
      billingCollectionMethod: hasStripeSubscription
        ? existingSubscription.billingCollectionMethod || (
          existingStripeManagedBilling ? 'automaticStripe' : subscriptionDraft.billingCollectionMethod
        )
        : subscriptionDraft.billingCollectionMethod,
      status: hasStripeSubscription ? existingSubscription.status : subscriptionDraft.status,
      stripeStatus: hasStripeSubscription ? existingSubscription.stripeStatus : subscriptionDraft.stripeStatus,
      autopayStatus: hasStripeSubscription
        ? existingSubscription.autopayStatus || (
          existingAutopayActive
            ? 'active'
            : existingStatusKey === 'pastdue' || existingStatusKey === 'unpaid'
              ? 'pastDue'
              : subscriptionDraft.autopayStatus
        )
        : subscriptionDraft.autopayStatus,
      autopayEnabled: hasStripeSubscription
        ? existingAutopayActive || Boolean(existingSubscription.autopayEnabled)
        : subscriptionDraft.autopayEnabled,
      amountCents: subscriptionDraft.amountCents,
      currency: subscriptionDraft.currency,
      interval: subscriptionDraft.interval,
      intervalCount: subscriptionDraft.intervalCount,
      billingFrequency: subscriptionDraft.billingFrequency,
      billingFrequencyCount: subscriptionDraft.billingFrequencyCount,
      serviceCadence: subscriptionDraft.serviceCadence,
      serviceCadenceCount: subscriptionDraft.serviceCadenceCount,
      serviceDaysOfWeek: subscriptionDraft.serviceDaysOfWeek,
      serviceFrequencyLabel: subscriptionDraft.serviceFrequencyLabel,
      previousAgreementId: subscriptionDraft.previousAgreementId,
      supersedesAgreementId: subscriptionDraft.supersedesAgreementId,
      agreementHistoryGroupId: subscriptionDraft.agreementHistoryGroupId,
      agreementVersion: subscriptionDraft.agreementVersion,
      rateType: subscriptionDraft.rateType,
      paymentTerms: subscriptionDraft.paymentTerms,
      invoiceDeliveryMethod: subscriptionDraft.invoiceDeliveryMethod,
      lineItems: subscriptionDraft.lineItems,
      chemicalBillingMode: subscriptionDraft.chemicalBillingMode,
      includedChemicalIds: subscriptionDraft.includedChemicalIds,
      includedChemicalKeywords: subscriptionDraft.includedChemicalKeywords,
      separatelyBilledChemicalIds: subscriptionDraft.separatelyBilledChemicalIds,
      separatelyBilledChemicalKeywords: subscriptionDraft.separatelyBilledChemicalKeywords,
      customerPurchasedChemicalIds: subscriptionDraft.customerPurchasedChemicalIds,
      customerPurchasedChemicalKeywords: subscriptionDraft.customerPurchasedChemicalKeywords,
      chemicalBillingNotes: subscriptionDraft.chemicalBillingNotes,
      agreementSnapshot: {
        ...subscriptionDraft.agreementSnapshot,
        acceptedAt,
      },
      checkoutStatus: hasStripeSubscription ? existingSubscription.checkoutStatus : subscriptionDraft.checkoutStatus,
      nextAction: hasStripeSubscription ? existingSubscription.nextAction : subscriptionDraft.nextAction,
      customerCanPayImmediately: hasStripeSubscription ? existingSubscription.customerCanPayImmediately : subscriptionDraft.customerCanPayImmediately,
      manualBillingEnabled: hasStripeSubscription
        ? existingSubscription.manualBillingEnabled !== undefined
          ? existingSubscription.manualBillingEnabled !== false
          : !existingStripeManagedBilling
        : subscriptionDraft.manualBillingEnabled,
      manualBillingAutoSendEnabled: existingSubscription
        ? existingStripeManagedBilling
          ? false
          : existingSubscription.manualBillingAutoSendEnabled === true
        : subscriptionDraft.manualBillingAutoSendEnabled,
      manualBillingStatus: hasStripeSubscription
        ? existingSubscription.manualBillingStatus || (
          existingAutopayActive
            ? 'disabledAutopayActive'
            : existingStripeManagedBilling
              ? 'disabledStripeBillingActive'
              : subscriptionDraft.manualBillingStatus
        )
        : subscriptionDraft.manualBillingStatus,
      manualBillingReason: hasStripeSubscription
        ? existingSubscription.manualBillingReason || (
          existingAutopayActive
            ? 'stripeAutopayActive'
            : existingStripeManagedBilling
              ? 'stripeAutopayNeedsAttention'
              : subscriptionDraft.manualBillingReason
        )
        : subscriptionDraft.manualBillingReason,
      receiptDeliveryMethod: existingSubscription?.receiptDeliveryMethod || subscriptionDraft.receiptDeliveryMethod,
      receiptsEnabled: existingSubscription?.receiptsEnabled !== false && subscriptionDraft.receiptsEnabled !== false,
      lastBillingSource: existingSubscription?.lastBillingSource || subscriptionDraft.lastBillingSource,
      stripeReadiness: subscriptionDraft.stripeReadiness,
      createdAt: existingSubscription?.createdAt || acceptedAt,
      updatedAt: acceptedAt,
    };
    const previousAgreementId = renewalPreviousAgreementId(freshAgreement);
    const historyGroupId = agreementHistoryGroupId(freshAgreement);
    let previousAgreementRef = null;
    let previousAgreement = null;
    let previousSubscriptionRef = null;
    let previousSubscription = null;

    if (previousAgreementId && previousAgreementId !== freshAgreement.id) {
      previousAgreementRef = db.collection(salesCollectionNames.agreements).doc(previousAgreementId);
      const previousAgreementSnap = await transaction.get(previousAgreementRef);
      if (previousAgreementSnap.exists) {
        previousAgreement = { id: previousAgreementSnap.id, ...previousAgreementSnap.data() };
        if (salesBillingAutomationEnabled && previousAgreement.billingSubscriptionId) {
          previousSubscriptionRef = db.collection(salesCollectionNames.billingSubscriptions).doc(previousAgreement.billingSubscriptionId);
          const previousSubscriptionSnap = await transaction.get(previousSubscriptionRef);
          if (previousSubscriptionSnap.exists) {
            previousSubscription = { id: previousSubscriptionSnap.id, ...previousSubscriptionSnap.data() };
          }
        }
      }
    }

    const billingAcceptanceFields = salesBillingAutomationEnabled
      ? {
        billingSubscriptionId: subscriptionDraft.id,
        billingFlowStatus: nextSubscription.status,
        billingFlowNextAction: nextSubscription.nextAction,
        billingCollectionMethod: nextSubscription.billingCollectionMethod,
        autopayStatus: nextSubscription.autopayStatus,
        manualBillingEnabled: nextSubscription.manualBillingEnabled,
        manualBillingAutoSendEnabled: nextSubscription.manualBillingAutoSendEnabled,
        customerCanPayImmediately: nextSubscription.customerCanPayImmediately,
        salesBillingAutomationEnabled: true,
        billingAutomationDisabledAtAcceptance: false,
      }
      : {
        salesBillingAutomationEnabled: false,
        billingAutomationDisabledAtAcceptance: !companyBillingEnabled,
        billingFlowStatus: skippedBillingFlowStatus,
        billingFlowNextAction: skippedBillingFlowNextAction,
        billingCollectionMethod: skippedBillingCollectionMethod,
        autopayStatus: 'unavailable',
        manualBillingEnabled: false,
        manualBillingAutoSendEnabled: false,
        customerCanPayImmediately: false,
      };
    const billingSnapshotFields = salesBillingAutomationEnabled
      ? {
        billingSubscriptionId: subscriptionDraft.id,
        billingFlowStatus: nextSubscription.status,
        billingFlowNextAction: nextSubscription.nextAction,
        billingCollectionMethod: nextSubscription.billingCollectionMethod,
        autopayStatus: nextSubscription.autopayStatus,
        manualBillingEnabled: nextSubscription.manualBillingEnabled,
        manualBillingAutoSendEnabled: nextSubscription.manualBillingAutoSendEnabled,
      }
      : {
        billingFlowStatus: skippedBillingFlowStatus,
        billingFlowNextAction: skippedBillingFlowNextAction,
        billingCollectionMethod: skippedBillingCollectionMethod,
        autopayStatus: 'unavailable',
        manualBillingEnabled: false,
        manualBillingAutoSendEnabled: false,
      };

    const linkedJobAcceptance = await prepareLinkedJobAcceptance({
      transaction, agreement: freshAgreement, selectedSolutionId, selectedSolutionOption: freshSelection.selectedOption,
      timestamp: acceptedAt, actorUserId: callableAuth.uid, actorUserName: acceptedByName,
    });
    linkedJobAcceptance?.apply();

    if (salesBillingAutomationEnabled) {
      transaction.set(subscriptionRef, nextSubscription, { merge: true });
    }

    transaction.set(agreementRef, {
      lineItems: Array.isArray(freshAgreement.lineItems) ? freshAgreement.lineItems : [],
      totalAmountCents: Number(freshAgreement.totalAmountCents ?? freshAgreement.rateAmountCents ?? 0),
      rateAmountCents: Number(freshAgreement.totalAmountCents ?? freshAgreement.rateAmountCents ?? 0),
      subtotalAmountCents: Number(freshAgreement.subtotalAmountCents ?? freshAgreement.totalAmountCents ?? 0),
      status: 'accepted',
      acceptedAt,
      acceptedByUserId: callableAuth.uid,
      acceptedByUserName: acceptedByName,
      acceptedByEmail,
      acceptedSource,
      acceptedNote: acceptanceNote,
      createBillingSubscriptionOnAcceptance: salesBillingAutomationEnabled,
      acceptedSignatureName: acceptanceConfirmation.signatureName,
      acceptedTermsConfirmed: acceptanceConfirmation.acceptedTermsConfirmed,
      acceptedPricingConfirmed: acceptanceConfirmation.acceptedPricingConfirmed,
      acceptedAutopayNoticeConfirmed: acceptanceConfirmation.acceptedAutopayNoticeConfirmed,
      acceptedUserAgent: acceptanceAudit.acceptedUserAgent,
      acceptedIpAddress: acceptanceAudit.acceptedIpAddress,
      acceptedSnapshot: {
        agreementId: freshAgreement.id,
        title: freshAgreement.title || 'Service Agreement',
        totalAmountCents: Number(freshAgreement.totalAmountCents || freshAgreement.rateAmountCents || 0),
        lineItems: Array.isArray(freshAgreement.lineItems) ? freshAgreement.lineItems : [],
        planOptions: Array.isArray(freshAgreement.planOptions) ? freshAgreement.planOptions : [],
        solutionOptions: Array.isArray(freshAgreement.solutionOptions) ? freshAgreement.solutionOptions : [],
        selectedPlanId: selectedSolutionId,
        selectedSolutionId,
        acceptedPlanId: selectedSolutionId,
        acceptedSolutionId: selectedSolutionId,
        acceptedPlanTitle: selectedSolutionOption?.title || selectedSolutionOption?.name || '',
        acceptedSolutionTitle: selectedSolutionOption?.title || selectedSolutionOption?.name || '',
        acceptedPlanTier: selectedSolutionOption?.planTier || selectedSolutionOption?.solutionTier || null,
        acceptedPlanTierLabel: selectedSolutionOption?.planTierLabel || selectedSolutionOption?.solutionTierLabel || '',
        acceptedSolutionTier: selectedSolutionOption?.solutionTier || selectedSolutionOption?.planTier || null,
        acceptedSolutionTierLabel: selectedSolutionOption?.solutionTierLabel || selectedSolutionOption?.planTierLabel || '',
        terms: freshAgreement.terms || '',
        termsList: Array.isArray(freshAgreement.termsList) ? freshAgreement.termsList : [],
        acceptedAt,
        acceptedByUserId: callableAuth.uid,
        acceptedByUserName: acceptedByName,
        acceptedByEmail,
        acceptedSource,
        acceptedSignatureName: acceptanceConfirmation.signatureName,
        acceptedTermsConfirmed: acceptanceConfirmation.acceptedTermsConfirmed,
        acceptedPricingConfirmed: acceptanceConfirmation.acceptedPricingConfirmed,
        acceptedAutopayNoticeConfirmed: acceptanceConfirmation.acceptedAutopayNoticeConfirmed,
        acceptedUserAgent: acceptanceAudit.acceptedUserAgent,
        acceptedIpAddress: acceptanceAudit.acceptedIpAddress,
        customerBillingPreference,
        customerBillingPreferenceSelectedAt: acceptedAt,
        previousAgreementId: previousAgreementId || '',
        supersedesAgreementId: previousAgreementId || '',
        agreementHistoryGroupId: historyGroupId,
        agreementVersion: String(freshAgreement.agreementVersion || 1),
        ...billingSnapshotFields,
      },
      selectedPlanId: selectedSolutionId,
      selectedSolutionId,
      acceptedPlanId: selectedSolutionId,
      acceptedSolutionId: selectedSolutionId,
      acceptedPlanTitle: selectedSolutionOption?.title || selectedSolutionOption?.name || '',
      acceptedSolutionTitle: selectedSolutionOption?.title || selectedSolutionOption?.name || '',
      acceptedPlanTier: selectedSolutionOption?.planTier || selectedSolutionOption?.solutionTier || null,
      acceptedPlanTierLabel: selectedSolutionOption?.planTierLabel || selectedSolutionOption?.solutionTierLabel || '',
      acceptedSolutionTier: selectedSolutionOption?.solutionTier || selectedSolutionOption?.planTier || null,
      acceptedSolutionTierLabel: selectedSolutionOption?.solutionTierLabel || selectedSolutionOption?.planTierLabel || '',
      billingFlowUpdatedAt: acceptedAt,
      customerBillingPreference,
      customerBillingPreferenceSelectedAt: acceptedAt,
      requestedBillingPreference: customerBillingPreference,
      ...billingAcceptanceFields,
      customerUserId: freshAgreement.customerUserId || callableAuth.uid,
      agreementHistoryGroupId: historyGroupId,
      agreementVersion: Math.max(Number(freshAgreement.agreementVersion || 1), 1),
      activatedAt: freshAgreement.activatedAt || acceptedAt,
      startDate: freshAgreement.startDate || acceptedAt,
      ...(previousAgreementId
        ? {
          previousAgreementId,
          supersedesAgreementId: previousAgreementId,
          previousAgreementEndedAt: acceptedAt,
        }
        : {}),
      operationsSetupStatus: freshAgreement.operationsSetupStatus || 'needsRecurringServiceStop',
      operationsSetupReason: freshAgreement.operationsSetupReason || 'acceptedServiceAgreement',
      operationsSetupUpdatedAt: acceptedAt,
      updatedAt: acceptedAt,
    }, { merge: true });

    if (previousAgreementRef && previousAgreement) {
      transaction.set(previousAgreementRef, {
        status: 'superseded',
        endDate: freshAgreement.startDate || acceptedAt,
        supersededAt: acceptedAt,
        supersededByAgreementId: freshAgreement.id,
        supersededByAgreementTitle: freshAgreement.title || 'Service Agreement',
        agreementHistoryGroupId: historyGroupId,
        updatedAt: acceptedAt,
        statusChangedAt: acceptedAt,
        statusChangeReason: 'Superseded by accepted renewal agreement.',
      }, { merge: true });
    }

    if (salesBillingAutomationEnabled && previousSubscriptionRef && previousSubscription) {
      transaction.set(previousSubscriptionRef, {
        ...supersededSubscriptionUpdates(previousSubscription, acceptedAt),
        supersededByAgreementId: freshAgreement.id,
        supersededByBillingSubscriptionId: subscriptionDraft.id,
      }, { merge: true });
    }
  });

  await syncLinkedLeadForAgreementStatus({
    agreement: acceptanceAgreement,
    status: 'accepted',
    timestamp: acceptedAt,
  });

  return {
    status: 'success',
    agreementId,
    billingSubscriptionId: salesBillingAutomationEnabled ? subscriptionDraft.id : '',
    billingSkipped: !salesBillingAutomationEnabled,
    billingSkippedReason,
    salesBillingAutomationEnabled,
    customerBillingPreference,
    selectedPlanId: selectedSolutionId,
    selectedSolutionId,
    customerCanPayImmediately: salesBillingAutomationEnabled ? subscriptionDraft.customerCanPayImmediately : false,
    nextAction: salesBillingAutomationEnabled
      ? subscriptionDraft.nextAction
      : skippedBillingFlowNextAction,
  };
});

exports.rejectSalesServiceAgreement = functions.https.onCall(async (data, context) => {
  const callableAuth = await getCallableAuth(data, context, 'You must be signed in to decline a service agreement.');
  const receivedData = getCallableData(data);
  const agreementId = String(receivedData.agreementId || '').trim();
  const rejectionNote = String(receivedData.rejectionNote || receivedData.responseNote || '').trim().slice(0, 2000);

  if (!agreementId) {
    throw new HttpsError('invalid-argument', 'agreementId is required.');
  }

  const agreementRef = db.collection(salesCollectionNames.agreements).doc(agreementId);
  const agreementSnap = await agreementRef.get();

  if (!agreementSnap.exists) {
    throw new HttpsError('not-found', 'Service agreement was not found.');
  }

  const agreement = { id: agreementSnap.id, ...agreementSnap.data() };
  const canAccess = await userCanAccessSalesRecord({ auth: callableAuth, record: agreement });

  if (!canAccess) {
    throw new HttpsError('permission-denied', 'This service agreement does not belong to your account.');
  }

  const statusKey = normalizeStatus(agreement.status);
  if (['accepted', 'canceled', 'rejected', 'expired', 'superseded'].includes(statusKey) || agreementIsExpired(agreement)) {
    throw new HttpsError('failed-precondition', 'This service agreement is no longer available to decline.');
  }

  const rejectedAt = admin.firestore.FieldValue.serverTimestamp();
  const rejectedByEmail = callableAuth.token?.email || agreement.email || '';
  const rejectedByName = callableAuth.token?.name || agreement.customerName || rejectedByEmail || 'Customer';

  await db.runTransaction(async (transaction) => {
    const freshAgreementSnap = await transaction.get(agreementRef);

    if (!freshAgreementSnap.exists) {
      throw new HttpsError('not-found', 'Service agreement was not found.');
    }

    const freshAgreement = { id: freshAgreementSnap.id, ...freshAgreementSnap.data() };
    const freshStatusKey = normalizeStatus(freshAgreement.status);

    if (['accepted', 'canceled', 'rejected', 'expired', 'superseded'].includes(freshStatusKey) || agreementIsExpired(freshAgreement)) {
      throw new HttpsError('failed-precondition', 'This service agreement is no longer available to decline.');
    }

    transaction.set(agreementRef, {
      status: 'rejected',
      rejectedAt,
      rejectedByUserId: callableAuth.uid,
      rejectedByUserName: rejectedByName,
      rejectedByEmail,
      rejectedSource: 'customerPortal',
      rejectedNote: rejectionNote,
      customerUserId: freshAgreement.customerUserId || callableAuth.uid,
      statusChangedAt: rejectedAt,
      statusChangedByUserId: callableAuth.uid,
      statusChangedByUserName: rejectedByName,
      statusChangeReason: rejectionNote || 'Customer declined from the client portal.',
      updatedAt: rejectedAt,
    }, { merge: true });
  });

  await syncLinkedJobForAgreementStatus({
    agreement,
    status: 'rejected',
    actorUserId: callableAuth.uid,
    actorUserName: rejectedByName,
    timestamp: rejectedAt,
  });
  await syncLinkedLeadForAgreementStatus({
    agreement,
    status: 'rejected',
    timestamp: rejectedAt,
  });

  return {
    status: 'success',
    agreementId,
  };
});

exports.rejectPublicSalesServiceAgreement = functions.https.onCall(async (data, context) => {
  const receivedData = getCallableData(data);
  const agreementId = String(receivedData.agreementId || '').trim();
  const accessToken = String(receivedData.accessToken || receivedData.reviewToken || '').trim();
  const email = receivedData.email || '';
  const responseType = String(receivedData.responseType || receivedData.customerResponseType || 'rejected').trim() === 'changesRequested'
    ? 'changesRequested'
    : 'rejected';
  const rejectionNote = String(receivedData.rejectionNote || receivedData.responseNote || '').trim().slice(0, 2000);

  if (!agreementId) {
    throw new HttpsError('invalid-argument', 'agreementId is required.');
  }

  if (!accessToken) {
    throw new HttpsError('invalid-argument', 'Open the service agreement from the email link before responding.');
  }

  if (responseType === 'changesRequested' && rejectionNote.length < 3) {
    throw new HttpsError('invalid-argument', 'Add a short note about what you would like changed.');
  }

  const agreementRef = db.collection(salesCollectionNames.agreements).doc(agreementId);
  const agreementSnap = await agreementRef.get();

  if (!agreementSnap.exists) {
    throw new HttpsError('not-found', 'Service agreement was not found.');
  }

  const agreement = { id: agreementSnap.id, ...agreementSnap.data() };
  if (!publicAgreementLinkCanAccess({ agreement, accessToken, email })) {
    throw new HttpsError('permission-denied', 'This service agreement link is invalid or has been replaced by a newer email.');
  }

  const statusKey = normalizeStatus(agreement.status);
  if (['accepted', 'canceled', 'rejected', 'expired', 'superseded'].includes(statusKey) || agreementIsExpired(agreement)) {
    throw new HttpsError('failed-precondition', 'This service agreement is no longer available for a response.');
  }

  const rejectedAt = admin.firestore.FieldValue.serverTimestamp();
  const rejectedByEmail = normalizeEmail(email || agreement.email || agreement.customerEmail || agreement.billingEmail);
  const rejectedByName = agreement.customerName || rejectedByEmail || 'Customer';
  const rejectedByUserId = agreement.customerUserId || '';

  await db.runTransaction(async (transaction) => {
    const freshAgreementSnap = await transaction.get(agreementRef);

    if (!freshAgreementSnap.exists) {
      throw new HttpsError('not-found', 'Service agreement was not found.');
    }

    const freshAgreement = { id: freshAgreementSnap.id, ...freshAgreementSnap.data() };
    if (!publicAgreementLinkCanAccess({ agreement: freshAgreement, accessToken, email })) {
      throw new HttpsError('permission-denied', 'This service agreement link is invalid or has been replaced by a newer email.');
    }

    const freshStatusKey = normalizeStatus(freshAgreement.status);
    if (['accepted', 'canceled', 'rejected', 'expired', 'superseded'].includes(freshStatusKey) || agreementIsExpired(freshAgreement)) {
      throw new HttpsError('failed-precondition', 'This service agreement is no longer available for a response.');
    }

    transaction.set(agreementRef, {
      status: 'rejected',
      rejectedAt,
      rejectedByUserId,
      rejectedByUserName: rejectedByName,
      rejectedByEmail,
      rejectedSource: 'emailLink',
      rejectedNote: rejectionNote,
      customerResponseType: responseType,
      changesRequestedAt: responseType === 'changesRequested' ? rejectedAt : null,
      customerUserId: freshAgreement.customerUserId || rejectedByUserId || null,
      statusChangedAt: rejectedAt,
      statusChangedByUserId: rejectedByUserId,
      statusChangedByUserName: rejectedByName,
      statusChangeReason: rejectionNote || (
        responseType === 'changesRequested'
          ? 'Customer requested a different estimate from the email review link.'
          : 'Customer declined from the email review link.'
      ),
      updatedAt: rejectedAt,
    }, { merge: true });
  });

  await syncLinkedJobForAgreementStatus({
    agreement,
    status: 'rejected',
    actorUserId: rejectedByUserId || 'email-link',
    actorUserName: rejectedByName,
    timestamp: rejectedAt,
    responseType,
    responseNote: rejectionNote,
  });
  await syncLinkedLeadForAgreementStatus({
    agreement,
    status: 'rejected',
    timestamp: rejectedAt,
  });

  return {
    status: 'success',
    agreementId,
    customerResponseType: responseType,
  };
});

exports.acceptPublicSalesServiceAgreement = functions.https.onCall(async (data, context) => {
  const receivedData = getCallableData(data);
  const agreementId = receivedData.agreementId;
  const accessToken = String(receivedData.accessToken || receivedData.reviewToken || '').trim();
  const email = receivedData.email || '';
  const requestedSolutionId = String(receivedData.selectedPlanId || receivedData.selectedSolutionId || '').trim();
  const acceptanceNote = String(receivedData.acceptanceNote || '').trim();
  const acceptanceConfirmation = validateAgreementAcceptance(receivedData);
  const acceptanceAudit = getAgreementAcceptanceAudit(context);

  if (!agreementId) {
    throw new HttpsError('invalid-argument', 'agreementId is required.');
  }

  if (!accessToken) {
    throw new HttpsError('invalid-argument', 'Open the service agreement from the email link before accepting.');
  }

  const agreementRef = db.collection(salesCollectionNames.agreements).doc(agreementId);
  const agreementSnap = await agreementRef.get();

  if (!agreementSnap.exists) {
    throw new HttpsError('not-found', 'Service agreement was not found.');
  }

  const agreement = { id: agreementSnap.id, ...agreementSnap.data() };
  if (!publicAgreementLinkCanAccess({ agreement, accessToken, email })) {
    throw new HttpsError('permission-denied', 'This service agreement link is invalid or has been replaced by a newer email.');
  }

  const statusKey = normalizeStatus(agreement.status);
  if (['accepted', 'canceled', 'rejected', 'expired', 'superseded'].includes(statusKey) || agreementIsExpired(agreement)) {
    throw new HttpsError('failed-precondition', 'This service agreement is no longer available to accept.');
  }

  const {
    agreement: acceptanceAgreement,
    selectedOption: selectedSolutionOption,
    selectedSolutionId,
  } = agreementWithSelectedSolution(agreement, requestedSolutionId);

  const companyDoc = await db.collection('companies').doc(acceptanceAgreement.companyId).get();
  const companyData = companyDoc.exists ? companyDoc.data() : {};
  const companyBillingEnabled = companyCustomerBillingEnabled(companyData);
  const requestedBillingPreference = normalizeCustomerBillingPreference(
    receivedData.customerBillingPreference ||
    receivedData.billingPreference ||
    receivedData.paymentPreference ||
    receivedData.paymentCollectionPreference ||
    '',
    ''
  );
  const createBillingSubscriptionOnAcceptance = requestedBillingPreference
    ? requestedBillingPreference === 'payNow'
    : shouldCreateBillingSubscriptionFromRequest(receivedData, companyData);
  const customerBillingPreference = requestedBillingPreference || (
    createBillingSubscriptionOnAcceptance ? 'payNow' : 'requestInvoice'
  );
  const salesBillingAutomationEnabled = (
    companyBillingEnabled &&
    createBillingSubscriptionOnAcceptance &&
    agreementSupportsBillingSubscription(acceptanceAgreement)
  );
  const agreementBillingSubscriptionEligible = agreementSupportsBillingSubscription(acceptanceAgreement);
  const billingSkippedReason = !companyBillingEnabled
    ? 'billingAutomationDisabled'
    : !agreementBillingSubscriptionEligible
      ? 'oneTimeAgreement'
      : 'acceptanceBillingSkipped';
  const skippedBillingFlowStatus = !companyBillingEnabled
    ? 'billingDisabled'
    : !agreementBillingSubscriptionEligible
      ? 'billingNotApplicable'
      : 'notStarted';
  const skippedBillingFlowNextAction = !companyBillingEnabled
    ? 'enableBillingAutomation'
    : !agreementBillingSubscriptionEligible
      ? 'convertToInvoice'
      : 'createBillingSubscription';
  const skippedBillingCollectionMethod = companyBillingEnabled ? 'manualInvoices' : 'externalBilling';
  const stripeConnectedAccountId = acceptanceAgreement.stripeConnectedAccountId || companyData.stripeConnectedAccountId || '';
  const subscriptionDraft = buildSalesBillingSubscriptionFromAgreement({ agreement: acceptanceAgreement, stripeConnectedAccountId });
  const subscriptionRef = db.collection(salesCollectionNames.billingSubscriptions).doc(subscriptionDraft.id);
  const acceptedAt = admin.firestore.FieldValue.serverTimestamp();
  const acceptedByEmail = normalizeEmail(email || agreement.email || agreement.customerEmail || agreement.billingEmail);
  const acceptedByName = agreement.customerName || acceptedByEmail || 'Customer';
  const acceptedByUserId = agreement.customerUserId || '';

  await db.runTransaction(async (transaction) => {
    const freshAgreementSnap = await transaction.get(agreementRef);
    const subscriptionSnap = salesBillingAutomationEnabled
      ? await transaction.get(subscriptionRef)
      : null;

    if (!freshAgreementSnap.exists) {
      throw new HttpsError('not-found', 'Service agreement was not found.');
    }

    const freshSelection = agreementWithSelectedSolution({ id: freshAgreementSnap.id, ...freshAgreementSnap.data() }, selectedSolutionId);
    if (freshSelection.selectedSolutionId !== selectedSolutionId) {
      throw new HttpsError('failed-precondition', 'The estimate plan options have changed. Reload the estimate before accepting.');
    }
    const freshAgreement = freshSelection.agreement;
    if (!publicAgreementLinkCanAccess({ agreement: freshAgreement, accessToken, email })) {
      throw new HttpsError('permission-denied', 'This service agreement link is invalid or has been replaced by a newer email.');
    }

    const freshStatusKey = normalizeStatus(freshAgreement.status);
    if (['accepted', 'canceled', 'rejected', 'expired', 'superseded'].includes(freshStatusKey) || agreementIsExpired(freshAgreement)) {
      throw new HttpsError('failed-precondition', 'This service agreement is no longer available to accept.');
    }

    const existingSubscription = subscriptionSnap?.exists
      ? { id: subscriptionSnap.id, ...subscriptionSnap.data() }
      : null;
    const hasStripeSubscription = Boolean(existingSubscription?.stripeSubscriptionId);
    const existingStatusKey = normalizeStatus(existingSubscription?.stripeStatus || existingSubscription?.status);
    const existingAutopayActive = hasStripeSubscription && ['active', 'trialing'].includes(existingStatusKey);
    const existingStripeManagedBilling = hasStripeSubscription && ['active', 'trialing', 'pastdue', 'unpaid', 'paused'].includes(existingStatusKey);
    const nextSubscription = {
      ...subscriptionDraft,
      ...existingSubscription,
      companyId: subscriptionDraft.companyId,
      customerId: subscriptionDraft.customerId,
      customerUserId: subscriptionDraft.customerUserId || existingSubscription?.customerUserId || null,
      relationshipId: subscriptionDraft.relationshipId,
      customerCompanyRelationshipId: subscriptionDraft.customerCompanyRelationshipId,
      customerName: subscriptionDraft.customerName,
      email: subscriptionDraft.email || acceptedByEmail,
      serviceLocationIds: subscriptionDraft.serviceLocationIds,
      agreementId: subscriptionDraft.agreementId,
      billingProfileId: subscriptionDraft.billingProfileId,
      stripeConnectedAccountId: subscriptionDraft.stripeConnectedAccountId,
      billingCollectionMethod: hasStripeSubscription
        ? existingSubscription.billingCollectionMethod || (
          existingStripeManagedBilling ? 'automaticStripe' : subscriptionDraft.billingCollectionMethod
        )
        : subscriptionDraft.billingCollectionMethod,
      status: hasStripeSubscription ? existingSubscription.status : subscriptionDraft.status,
      stripeStatus: hasStripeSubscription ? existingSubscription.stripeStatus : subscriptionDraft.stripeStatus,
      autopayStatus: hasStripeSubscription
        ? existingSubscription.autopayStatus || (
          existingAutopayActive
            ? 'active'
            : existingStatusKey === 'pastdue' || existingStatusKey === 'unpaid'
              ? 'pastDue'
              : subscriptionDraft.autopayStatus
        )
        : subscriptionDraft.autopayStatus,
      autopayEnabled: hasStripeSubscription
        ? existingAutopayActive || Boolean(existingSubscription.autopayEnabled)
        : subscriptionDraft.autopayEnabled,
      amountCents: subscriptionDraft.amountCents,
      currency: subscriptionDraft.currency,
      interval: subscriptionDraft.interval,
      intervalCount: subscriptionDraft.intervalCount,
      billingFrequency: subscriptionDraft.billingFrequency,
      billingFrequencyCount: subscriptionDraft.billingFrequencyCount,
      serviceCadence: subscriptionDraft.serviceCadence,
      serviceCadenceCount: subscriptionDraft.serviceCadenceCount,
      serviceDaysOfWeek: subscriptionDraft.serviceDaysOfWeek,
      serviceFrequencyLabel: subscriptionDraft.serviceFrequencyLabel,
      previousAgreementId: subscriptionDraft.previousAgreementId,
      supersedesAgreementId: subscriptionDraft.supersedesAgreementId,
      agreementHistoryGroupId: subscriptionDraft.agreementHistoryGroupId,
      agreementVersion: subscriptionDraft.agreementVersion,
      rateType: subscriptionDraft.rateType,
      paymentTerms: subscriptionDraft.paymentTerms,
      invoiceDeliveryMethod: subscriptionDraft.invoiceDeliveryMethod,
      lineItems: subscriptionDraft.lineItems,
      chemicalBillingMode: subscriptionDraft.chemicalBillingMode,
      includedChemicalIds: subscriptionDraft.includedChemicalIds,
      includedChemicalKeywords: subscriptionDraft.includedChemicalKeywords,
      separatelyBilledChemicalIds: subscriptionDraft.separatelyBilledChemicalIds,
      separatelyBilledChemicalKeywords: subscriptionDraft.separatelyBilledChemicalKeywords,
      customerPurchasedChemicalIds: subscriptionDraft.customerPurchasedChemicalIds,
      customerPurchasedChemicalKeywords: subscriptionDraft.customerPurchasedChemicalKeywords,
      chemicalBillingNotes: subscriptionDraft.chemicalBillingNotes,
      agreementSnapshot: {
        ...subscriptionDraft.agreementSnapshot,
        acceptedAt,
      },
      checkoutStatus: hasStripeSubscription ? existingSubscription.checkoutStatus : subscriptionDraft.checkoutStatus,
      nextAction: hasStripeSubscription ? existingSubscription.nextAction : subscriptionDraft.nextAction,
      customerCanPayImmediately: hasStripeSubscription ? existingSubscription.customerCanPayImmediately : subscriptionDraft.customerCanPayImmediately,
      manualBillingEnabled: hasStripeSubscription
        ? existingSubscription.manualBillingEnabled !== undefined
          ? existingSubscription.manualBillingEnabled !== false
          : !existingStripeManagedBilling
        : subscriptionDraft.manualBillingEnabled,
      manualBillingAutoSendEnabled: existingSubscription
        ? existingStripeManagedBilling
          ? false
          : existingSubscription.manualBillingAutoSendEnabled === true
        : subscriptionDraft.manualBillingAutoSendEnabled,
      manualBillingStatus: hasStripeSubscription
        ? existingSubscription.manualBillingStatus || (
          existingAutopayActive
            ? 'disabledAutopayActive'
            : existingStripeManagedBilling
              ? 'disabledStripeBillingActive'
              : subscriptionDraft.manualBillingStatus
        )
        : subscriptionDraft.manualBillingStatus,
      manualBillingReason: hasStripeSubscription
        ? existingSubscription.manualBillingReason || (
          existingAutopayActive
            ? 'stripeAutopayActive'
            : existingStripeManagedBilling
              ? 'stripeAutopayNeedsAttention'
              : subscriptionDraft.manualBillingReason
        )
        : subscriptionDraft.manualBillingReason,
      receiptDeliveryMethod: existingSubscription?.receiptDeliveryMethod || subscriptionDraft.receiptDeliveryMethod,
      receiptsEnabled: existingSubscription?.receiptsEnabled !== false && subscriptionDraft.receiptsEnabled !== false,
      lastBillingSource: existingSubscription?.lastBillingSource || subscriptionDraft.lastBillingSource,
      stripeReadiness: subscriptionDraft.stripeReadiness,
      createdAt: existingSubscription?.createdAt || acceptedAt,
      updatedAt: acceptedAt,
    };
    const previousAgreementId = renewalPreviousAgreementId(freshAgreement);
    const historyGroupId = agreementHistoryGroupId(freshAgreement);
    let previousAgreementRef = null;
    let previousAgreement = null;
    let previousSubscriptionRef = null;
    let previousSubscription = null;

    if (previousAgreementId && previousAgreementId !== freshAgreement.id) {
      previousAgreementRef = db.collection(salesCollectionNames.agreements).doc(previousAgreementId);
      const previousAgreementSnap = await transaction.get(previousAgreementRef);
      if (previousAgreementSnap.exists) {
        previousAgreement = { id: previousAgreementSnap.id, ...previousAgreementSnap.data() };
        if (salesBillingAutomationEnabled && previousAgreement.billingSubscriptionId) {
          previousSubscriptionRef = db.collection(salesCollectionNames.billingSubscriptions).doc(previousAgreement.billingSubscriptionId);
          const previousSubscriptionSnap = await transaction.get(previousSubscriptionRef);
          if (previousSubscriptionSnap.exists) {
            previousSubscription = { id: previousSubscriptionSnap.id, ...previousSubscriptionSnap.data() };
          }
        }
      }
    }

    const billingAcceptanceFields = salesBillingAutomationEnabled
      ? {
        billingSubscriptionId: subscriptionDraft.id,
        billingFlowStatus: nextSubscription.status,
        billingFlowNextAction: nextSubscription.nextAction,
        billingCollectionMethod: nextSubscription.billingCollectionMethod,
        autopayStatus: nextSubscription.autopayStatus,
        manualBillingEnabled: nextSubscription.manualBillingEnabled,
        manualBillingAutoSendEnabled: nextSubscription.manualBillingAutoSendEnabled,
        customerCanPayImmediately: nextSubscription.customerCanPayImmediately,
        salesBillingAutomationEnabled: true,
        billingAutomationDisabledAtAcceptance: false,
      }
      : {
        salesBillingAutomationEnabled: false,
        billingAutomationDisabledAtAcceptance: !companyBillingEnabled,
        billingFlowStatus: skippedBillingFlowStatus,
        billingFlowNextAction: skippedBillingFlowNextAction,
        billingCollectionMethod: skippedBillingCollectionMethod,
        autopayStatus: 'unavailable',
        manualBillingEnabled: false,
        manualBillingAutoSendEnabled: false,
        customerCanPayImmediately: false,
      };
    const billingSnapshotFields = salesBillingAutomationEnabled
      ? {
        billingSubscriptionId: subscriptionDraft.id,
        billingFlowStatus: nextSubscription.status,
        billingFlowNextAction: nextSubscription.nextAction,
        billingCollectionMethod: nextSubscription.billingCollectionMethod,
        autopayStatus: nextSubscription.autopayStatus,
        manualBillingEnabled: nextSubscription.manualBillingEnabled,
        manualBillingAutoSendEnabled: nextSubscription.manualBillingAutoSendEnabled,
      }
      : {
        billingFlowStatus: skippedBillingFlowStatus,
        billingFlowNextAction: skippedBillingFlowNextAction,
        billingCollectionMethod: skippedBillingCollectionMethod,
        autopayStatus: 'unavailable',
        manualBillingEnabled: false,
        manualBillingAutoSendEnabled: false,
      };

    const linkedJobAcceptance = await prepareLinkedJobAcceptance({
      transaction, agreement: freshAgreement, selectedSolutionId, selectedSolutionOption: freshSelection.selectedOption,
      timestamp: acceptedAt, actorUserId: acceptedByUserId || 'email-link', actorUserName: acceptedByName,
    });
    linkedJobAcceptance?.apply();

    if (salesBillingAutomationEnabled) {
      transaction.set(subscriptionRef, nextSubscription, { merge: true });
    }

    transaction.set(agreementRef, {
      lineItems: Array.isArray(freshAgreement.lineItems) ? freshAgreement.lineItems : [],
      totalAmountCents: Number(freshAgreement.totalAmountCents ?? freshAgreement.rateAmountCents ?? 0),
      rateAmountCents: Number(freshAgreement.totalAmountCents ?? freshAgreement.rateAmountCents ?? 0),
      subtotalAmountCents: Number(freshAgreement.subtotalAmountCents ?? freshAgreement.totalAmountCents ?? 0),
      status: 'accepted',
      acceptedAt,
      acceptedByUserId,
      acceptedByUserName: acceptedByName,
      acceptedByEmail,
      acceptedSource: 'emailLink',
      acceptedNote: acceptanceNote,
      createBillingSubscriptionOnAcceptance: salesBillingAutomationEnabled,
      acceptedSignatureName: acceptanceConfirmation.signatureName,
      acceptedTermsConfirmed: acceptanceConfirmation.acceptedTermsConfirmed,
      acceptedPricingConfirmed: acceptanceConfirmation.acceptedPricingConfirmed,
      acceptedAutopayNoticeConfirmed: acceptanceConfirmation.acceptedAutopayNoticeConfirmed,
      acceptedUserAgent: acceptanceAudit.acceptedUserAgent,
      acceptedIpAddress: acceptanceAudit.acceptedIpAddress,
      acceptedSnapshot: {
        agreementId: freshAgreement.id,
        title: freshAgreement.title || 'Service Agreement',
        totalAmountCents: Number(freshAgreement.totalAmountCents || freshAgreement.rateAmountCents || 0),
        lineItems: Array.isArray(freshAgreement.lineItems) ? freshAgreement.lineItems : [],
        planOptions: Array.isArray(freshAgreement.planOptions) ? freshAgreement.planOptions : [],
        solutionOptions: Array.isArray(freshAgreement.solutionOptions) ? freshAgreement.solutionOptions : [],
        selectedPlanId: selectedSolutionId,
        selectedSolutionId,
        acceptedPlanId: selectedSolutionId,
        acceptedSolutionId: selectedSolutionId,
        acceptedPlanTitle: selectedSolutionOption?.title || selectedSolutionOption?.name || '',
        acceptedSolutionTitle: selectedSolutionOption?.title || selectedSolutionOption?.name || '',
        acceptedPlanTier: selectedSolutionOption?.planTier || selectedSolutionOption?.solutionTier || null,
        acceptedPlanTierLabel: selectedSolutionOption?.planTierLabel || selectedSolutionOption?.solutionTierLabel || '',
        acceptedSolutionTier: selectedSolutionOption?.solutionTier || selectedSolutionOption?.planTier || null,
        acceptedSolutionTierLabel: selectedSolutionOption?.solutionTierLabel || selectedSolutionOption?.planTierLabel || '',
        terms: freshAgreement.terms || '',
        termsList: Array.isArray(freshAgreement.termsList) ? freshAgreement.termsList : [],
        acceptedAt,
        acceptedByUserId,
        acceptedByUserName: acceptedByName,
        acceptedByEmail,
        acceptedSignatureName: acceptanceConfirmation.signatureName,
        acceptedTermsConfirmed: acceptanceConfirmation.acceptedTermsConfirmed,
        acceptedPricingConfirmed: acceptanceConfirmation.acceptedPricingConfirmed,
        acceptedAutopayNoticeConfirmed: acceptanceConfirmation.acceptedAutopayNoticeConfirmed,
        acceptedUserAgent: acceptanceAudit.acceptedUserAgent,
        acceptedIpAddress: acceptanceAudit.acceptedIpAddress,
        customerBillingPreference,
        customerBillingPreferenceSelectedAt: acceptedAt,
        previousAgreementId: previousAgreementId || '',
        supersedesAgreementId: previousAgreementId || '',
        agreementHistoryGroupId: historyGroupId,
        agreementVersion: String(freshAgreement.agreementVersion || 1),
        ...billingSnapshotFields,
      },
      selectedPlanId: selectedSolutionId,
      selectedSolutionId,
      acceptedPlanId: selectedSolutionId,
      acceptedSolutionId: selectedSolutionId,
      acceptedPlanTitle: selectedSolutionOption?.title || selectedSolutionOption?.name || '',
      acceptedSolutionTitle: selectedSolutionOption?.title || selectedSolutionOption?.name || '',
      acceptedPlanTier: selectedSolutionOption?.planTier || selectedSolutionOption?.solutionTier || null,
      acceptedPlanTierLabel: selectedSolutionOption?.planTierLabel || selectedSolutionOption?.solutionTierLabel || '',
      acceptedSolutionTier: selectedSolutionOption?.solutionTier || selectedSolutionOption?.planTier || null,
      acceptedSolutionTierLabel: selectedSolutionOption?.solutionTierLabel || selectedSolutionOption?.planTierLabel || '',
      billingFlowUpdatedAt: acceptedAt,
      customerBillingPreference,
      customerBillingPreferenceSelectedAt: acceptedAt,
      requestedBillingPreference: customerBillingPreference,
      ...billingAcceptanceFields,
      customerUserId: freshAgreement.customerUserId || null,
      agreementHistoryGroupId: historyGroupId,
      agreementVersion: Math.max(Number(freshAgreement.agreementVersion || 1), 1),
      activatedAt: freshAgreement.activatedAt || acceptedAt,
      startDate: freshAgreement.startDate || acceptedAt,
      ...(previousAgreementId
        ? {
          previousAgreementId,
          supersedesAgreementId: previousAgreementId,
          previousAgreementEndedAt: acceptedAt,
        }
        : {}),
      operationsSetupStatus: freshAgreement.operationsSetupStatus || 'needsRecurringServiceStop',
      operationsSetupReason: freshAgreement.operationsSetupReason || 'acceptedServiceAgreement',
      operationsSetupUpdatedAt: acceptedAt,
      updatedAt: acceptedAt,
    }, { merge: true });

    if (previousAgreementRef && previousAgreement) {
      transaction.set(previousAgreementRef, {
        status: 'superseded',
        endDate: freshAgreement.startDate || acceptedAt,
        supersededAt: acceptedAt,
        supersededByAgreementId: freshAgreement.id,
        supersededByAgreementTitle: freshAgreement.title || 'Service Agreement',
        agreementHistoryGroupId: historyGroupId,
        updatedAt: acceptedAt,
        statusChangedAt: acceptedAt,
        statusChangeReason: 'Superseded by accepted renewal agreement.',
      }, { merge: true });
    }

    if (salesBillingAutomationEnabled && previousSubscriptionRef && previousSubscription) {
      transaction.set(previousSubscriptionRef, {
        ...supersededSubscriptionUpdates(previousSubscription, acceptedAt),
        supersededByAgreementId: freshAgreement.id,
        supersededByBillingSubscriptionId: subscriptionDraft.id,
      }, { merge: true });
    }
  });

  await syncLinkedLeadForAgreementStatus({
    agreement: acceptanceAgreement,
    status: 'accepted',
    timestamp: acceptedAt,
  });

  return {
    status: 'success',
    agreementId,
    billingSubscriptionId: salesBillingAutomationEnabled ? subscriptionDraft.id : '',
    billingSkipped: !salesBillingAutomationEnabled,
    billingSkippedReason,
    salesBillingAutomationEnabled,
    customerBillingPreference,
    selectedPlanId: selectedSolutionId,
    selectedSolutionId,
    customerCanPayImmediately: salesBillingAutomationEnabled ? subscriptionDraft.customerCanPayImmediately : false,
    nextAction: salesBillingAutomationEnabled
      ? subscriptionDraft.nextAction
      : skippedBillingFlowNextAction,
  };
});

exports.deleteSalesAgreement = functions.https.onCall(async (data, context) => {
  const callableAuth = await getCallableAuth(data, context, 'You must be signed in to delete a service agreement.');
  const receivedData = getCallableData(data);
  const agreementId = String(receivedData.agreementId || '').trim();
  const companyId = String(receivedData.companyId || '').trim();

  if (!agreementId || !companyId) {
    throw new HttpsError('invalid-argument', 'agreementId and companyId are required.');
  }

  const agreementRef = db.collection(salesCollectionNames.agreements).doc(agreementId);
  const agreementSnap = await agreementRef.get();

  if (!agreementSnap.exists) {
    throw new HttpsError('not-found', 'Service agreement was not found.');
  }

  const agreement = { id: agreementSnap.id, ...agreementSnap.data() };

  if (agreement.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'This service agreement belongs to another company.');
  }

  const hasAccess = await userHasAnyCompanyPermission(callableAuth.uid, companyId, [
    FINANCE_PERMISSION_ID,
    DELETE_SERVICE_AGREEMENTS_PERMISSION_ID,
  ]);
  if (!hasAccess) {
    throw new HttpsError('permission-denied', 'You do not have permission to delete service agreements for this company.');
  }

  const subscriptionsToDelete = new Map();

  if (agreement.billingSubscriptionId) {
    const linkedSubscriptionSnap = await db
      .collection(salesCollectionNames.billingSubscriptions)
      .doc(String(agreement.billingSubscriptionId))
      .get();

    if (linkedSubscriptionSnap.exists) {
      subscriptionsToDelete.set(linkedSubscriptionSnap.id, {
        id: linkedSubscriptionSnap.id,
        ...linkedSubscriptionSnap.data(),
      });
    }
  }

  const linkedSubscriptionsSnap = await db
    .collection(salesCollectionNames.billingSubscriptions)
    .where('agreementId', '==', agreementId)
    .get();

  linkedSubscriptionsSnap.docs.forEach((subscriptionSnap) => {
    subscriptionsToDelete.set(subscriptionSnap.id, {
      id: subscriptionSnap.id,
      ...subscriptionSnap.data(),
    });
  });

  const mismatchedSubscription = [...subscriptionsToDelete.values()].find(
    (subscription) => subscription.companyId !== companyId
  );
  if (mismatchedSubscription) {
    throw new HttpsError(
      'permission-denied',
      `Linked billing subscription ${mismatchedSubscription.id || ''} belongs to another company.`
    );
  }

  const liveStripeSubscription = [...subscriptionsToDelete.values()].find(
    (subscription) => !canDeleteBillingSubscriptionRecord(subscription)
  );
  if (liveStripeSubscription) {
    throw new HttpsError(
      'failed-precondition',
      'Cancel the active Stripe billing subscription before deleting this agreement.'
    );
  }

  const batch = db.batch();
  [...subscriptionsToDelete.keys()].forEach((subscriptionId) => {
    batch.delete(db.collection(salesCollectionNames.billingSubscriptions).doc(subscriptionId));
  });
  batch.delete(agreementRef);
  await batch.commit();

  return {
    status: 'success',
    agreementId,
    deletedBillingSubscriptionIds: [...subscriptionsToDelete.keys()],
  };
});

exports.createSalesBillingSubscriptionCheckoutSession = functions.https.onCall(async (data, context) => {
  const auth = await getCallableAuth(data, context, 'Sign in to start billing setup.');
  return require('../subscriptionCheckout').createSubscriptionCheckout(db, stripe).start({ auth, data: getCallableData(data) });
});

exports.syncSalesBillingSubscriptionFromStripe = functions.https.onCall(async (data, context) => {
  const receivedData = data.data || data;
  const { billingSubscriptionId, companyId } = receivedData;
  const { subscriptionRef, subscription } = await requireCompanyManagerForSalesSubscription({
    auth: context.auth,
    billingSubscriptionId,
    companyId,
  });

  if (!subscription.stripeSubscriptionId) {
    throw new HttpsError('failed-precondition', 'This billing subscription does not have a Stripe subscription yet.');
  }

  const connectedAccount = subscription.stripeConnectedAccountId;
  if (!connectedAccount) {
    throw new HttpsError('failed-precondition', 'This billing subscription is missing a Stripe connected account id.');
  }

  try {
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId, {
      expand: ['items.data.price.product', 'latest_invoice', 'default_payment_method'],
    }, {
      stripeAccount: connectedAccount,
    });

    const updateData = await syncSalesSubscriptionRecordFromStripe({
      subscriptionRef,
      subscription,
      stripeSubscription,
      connectedAccount,
    });

    return {
      status: 'success',
      stripeSubscriptionId: stripeSubscription.id,
      stripeStatus: updateData.stripeStatus,
      billingStatus: updateData.status,
      nextAction: updateData.nextAction,
    };
  } catch (error) {
    console.error('Unable to sync sales billing subscription from Stripe', error);
    throw new HttpsError(
      'internal',
      error.message || 'Unable to sync billing subscription from Stripe.'
    );
  }
});

exports.cancelSalesBillingSubscription = functions.https.onCall(async (data, context) => {
  const receivedData = data.data || data;
  const {
    billingSubscriptionId,
    companyId,
    cancelAtPeriodEnd = true,
  } = receivedData;
  const { subscriptionRef, subscription } = await requireCompanyManagerForSalesSubscription({
    auth: context.auth,
    billingSubscriptionId,
    companyId,
  });

  if (!subscription.stripeSubscriptionId) {
    const now = admin.firestore.FieldValue.serverTimestamp();
    const updateData = {
      status: 'canceled',
      nextAction: 'reviewCanceledSubscription',
      cancelAtPeriodEnd: false,
      canceledAt: now,
      updatedAt: now,
    };
    await subscriptionRef.set(updateData, { merge: true });

    if (subscription.agreementId) {
      await db.collection(salesCollectionNames.agreements).doc(subscription.agreementId).set({
        billingFlowStatus: updateData.status,
        billingFlowNextAction: updateData.nextAction,
        billingFlowUpdatedAt: now,
        updatedAt: now,
      }, { merge: true });
    }

    return {
      status: 'success',
      billingStatus: updateData.status,
      nextAction: updateData.nextAction,
      message: 'Local billing subscription canceled.',
    };
  }

  const connectedAccount = subscription.stripeConnectedAccountId;
  if (!connectedAccount) {
    throw new HttpsError('failed-precondition', 'This billing subscription is missing a Stripe connected account id.');
  }

  try {
    const stripeSubscription = cancelAtPeriodEnd
      ? await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      }, {
        stripeAccount: connectedAccount,
      })
      : await stripe.subscriptions.cancel(subscription.stripeSubscriptionId, {}, {
        stripeAccount: connectedAccount,
      });

    const updateData = await syncSalesSubscriptionRecordFromStripe({
      subscriptionRef,
      subscription,
      stripeSubscription,
      connectedAccount,
    });

    return {
      status: 'success',
      stripeSubscriptionId: stripeSubscription.id,
      stripeStatus: updateData.stripeStatus,
      billingStatus: updateData.status,
      nextAction: updateData.nextAction,
      cancelAtPeriodEnd: updateData.cancelAtPeriodEnd,
    };
  } catch (error) {
    console.error('Unable to cancel sales billing subscription in Stripe', error);
    throw new HttpsError(
      'internal',
      error.message || 'Unable to cancel billing subscription.'
    );
  }
});

exports.resumeSalesBillingSubscription = functions.https.onCall(async (data, context) => {
  const receivedData = data.data || data;
  const { billingSubscriptionId, companyId } = receivedData;
  const { subscriptionRef, subscription } = await requireCompanyManagerForSalesSubscription({
    auth: context.auth,
    billingSubscriptionId,
    companyId,
  });

  if (!subscription.stripeSubscriptionId) {
    throw new HttpsError('failed-precondition', 'This billing subscription does not have a Stripe subscription yet.');
  }

  const connectedAccount = subscription.stripeConnectedAccountId;
  if (!connectedAccount) {
    throw new HttpsError('failed-precondition', 'This billing subscription is missing a Stripe connected account id.');
  }

  try {
    const stripeSubscription = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
    }, {
      stripeAccount: connectedAccount,
    });

    const updateData = await syncSalesSubscriptionRecordFromStripe({
      subscriptionRef,
      subscription,
      stripeSubscription,
      connectedAccount,
    });

    return {
      status: 'success',
      stripeSubscriptionId: stripeSubscription.id,
      stripeStatus: updateData.stripeStatus,
      billingStatus: updateData.status,
      nextAction: updateData.nextAction,
      cancelAtPeriodEnd: updateData.cancelAtPeriodEnd,
    };
  } catch (error) {
    console.error('Unable to resume sales billing subscription in Stripe', error);
    throw new HttpsError(
      'internal',
      error.message || 'Unable to resume billing subscription.'
    );
  }
});

exports.updateSalesBillingSubscriptionStripeItems = functions.https.onCall(async (data, context) => {
  const receivedData = data.data || data;
  const {
    billingSubscriptionId,
    companyId,
    prorationBehavior = 'none',
  } = receivedData;
  const { subscriptionRef, subscription } = await requireCompanyManagerForSalesSubscription({
    auth: context.auth,
    billingSubscriptionId,
    companyId,
  });

  if (!subscription.stripeSubscriptionId) {
    throw new HttpsError('failed-precondition', 'This billing subscription does not have a Stripe subscription yet.');
  }

  const connectedAccount = subscription.stripeConnectedAccountId;
  if (!connectedAccount) {
    throw new HttpsError('failed-precondition', 'This billing subscription is missing a Stripe connected account id.');
  }

  if (prorationBehavior !== 'none') throw new HttpsError('failed-precondition', 'Pricing changes take effect at the next renewal. Immediate adjustments require a separate reviewed invoice.');
  const {pricing,hash,id} = require('../billingMath');
  const accepted = pricing(subscription);
  const interval = normalizeStripeInterval(subscription.interval || 'month');
  const intervalCount = Number(subscription.intervalCount || 1);
  const priceKey = hash({subscriptionId:subscription.id,accepted,interval,intervalCount});
  const options = {stripeAccount:connectedAccount};
  const current = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId, {}, options);
  if (id(current.customer) !== subscription.stripeCustomerId || current.metadata?.salesBillingSubscriptionId && current.metadata.salesBillingSubscriptionId !== subscription.id)
    throw new HttpsError('permission-denied', 'Stripe subscription ownership does not match.');
  const price = await stripe.prices.create({currency:accepted.currency,unit_amount:accepted.totalAmountCents,
    recurring:{interval,interval_count:intervalCount},product_data:{name:subscription.agreementSnapshot?.title || 'Pool service',metadata:{pricingSnapshotHash:priceKey}}},
    {...options,idempotencyKey:`price_${priceKey}`});
  const existing = current.items?.data || [];
  const updated = await stripe.subscriptions.update(current.id, {proration_behavior:'none',
    items:[{...(existing[0]?{id:existing[0].id}:{}),price:price.id,quantity:1},...existing.slice(1).map(item=>({id:item.id,deleted:true}))],
    metadata:{...(current.metadata || {}),companyId:subscription.companyId,salesBillingSubscriptionId:subscription.id,salesAgreementId:subscription.agreementId || '',pricingSnapshotHash:priceKey}},
    {...options,idempotencyKey:`pricing_${priceKey}`});
  await subscriptionRef.set({stripePricingSnapshotHash:priceKey,stripePricingUpdatedAt:admin.firestore.FieldValue.serverTimestamp(),stripePricingUpdatedByUserId:context.auth.uid},{merge:true});
  const result = await syncSalesSubscriptionRecordFromStripe({subscriptionRef,subscription,stripeSubscription:updated,connectedAccount});
  return {status:'success',stripeSubscriptionId:updated.id,stripeStatus:result.stripeStatus,billingStatus:result.status,nextAction:result.nextAction,createdPriceCount:1,lineItemCount:accepted.lines.length};
});


exports.verifyConnectedAccountBillingReadiness = functions.https.onCall(async(data, context) => {
    const callableAuth = await getCallableAuth(
      data,
      context,
      'You must be signed in to check Stripe billing readiness.'
    );
    const receivedData = data.data || data;
    const companyId = String(receivedData.companyId || '').trim();

    if (!companyId) {
      throw new HttpsError(
        'invalid-argument',
        'A company id is required.'
      );
    }

    const companySnapshot = await db.collection('companies').doc(companyId).get();

    if (!companySnapshot.exists) {
      throw new HttpsError(
        'not-found',
        'Company was not found.'
      );
    }

    const companyData = companySnapshot.data() || {};
    const companyAccountId = getCompanyConnectedAccountId(companyData);
    const connectedAccount = normalizeStripeAccountId(
      receivedData.accountId ||
      receivedData.connectedAccount ||
      receivedData.stripeConnectedAccountId ||
      companyAccountId
    );

    if (!connectedAccount) {
      throw new HttpsError(
        'failed-precondition',
        'This company does not have a Stripe connected account yet.'
      );
    }

    if (companyAccountId && connectedAccount !== companyAccountId) {
      throw new HttpsError(
        'permission-denied',
        'Connected account does not belong to this company.'
      );
    }

    const hasAccess = companyData.ownerId === callableAuth.uid || await userHasCompanyAccess(callableAuth.uid, companyId);

    if (!hasAccess) {
      throw new HttpsError(
        'permission-denied',
        'You do not have access to this company Stripe account.'
      );
    }

    try {
      const account = await stripe.accounts.retrieve(connectedAccount);
      const requirements = account.requirements || {};
      const futureRequirements = account.future_requirements || {};
      const capabilities = account.capabilities || {};
      const currentlyDue = requirements.currently_due || [];
      const pastDue = requirements.past_due || [];
      const pendingVerification = requirements.pending_verification || [];
      const errors = requirements.errors || [];
      const cardPaymentsCapability = capabilities.card_payments || 'unknown';
      const transfersCapability = capabilities.transfers || 'unknown';
      const canCreateCharges = Boolean(account.charges_enabled);
      const canProcessCardPayments = cardPaymentsCapability === 'active';
      const canReceivePayouts = Boolean(account.payouts_enabled);
      const canTransferFunds = transfersCapability === 'active';
      const hasBlockingRequirements = currentlyDue.length > 0 || pastDue.length > 0 || errors.length > 0;
      const canBillCustomers = canCreateCharges && canProcessCardPayments && !hasBlockingRequirements;
      const applicationFee = resolveApplicationFee({}, companyData);
      const canRunLiveBilling = (
        Boolean(account.livemode) &&
        canBillCustomers &&
        canReceivePayouts &&
        canTransferFunds &&
        stripeWebhookSecretConfigured()
      );

      return {
        accountId: account.id,
        email: account.email || '',
        canBillCustomers,
        canRunLiveBilling,
        livemode: Boolean(account.livemode),
        chargesEnabled: canCreateCharges,
        cardPaymentsEnabled: canProcessCardPayments,
        payoutsEnabled: canReceivePayouts,
        transfersEnabled: canTransferFunds,
        detailsSubmitted: Boolean(account.details_submitted),
        disabledReason: requirements.disabled_reason || '',
        currentlyDue,
        pastDue,
        eventuallyDue: requirements.eventually_due || [],
        pendingVerification,
        errors,
        futureRequirements: {
          currentlyDue: futureRequirements.currently_due || [],
          eventuallyDue: futureRequirements.eventually_due || [],
          pastDue: futureRequirements.past_due || [],
          pendingVerification: futureRequirements.pending_verification || [],
          errors: futureRequirements.errors || [],
        },
        capabilities: {
          cardPayments: cardPaymentsCapability,
          transfers: transfersCapability,
        },
        platform: {
          webhookSigningSecretConfigured: stripeWebhookSecretConfigured(),
          stripeApiKeyConfigured: Boolean(process.env.STRIPE_API_KEY || process.env.STRIPE_SECRET_KEY || process.env.stripe_secret_key),
          applicationFeePercent: applicationFee.percent,
          applicationFeeSource: applicationFee.source,
        },
        businessProfile: {
          name: account.business_profile?.name || '',
          productDescription: account.business_profile?.product_description || '',
          mcc: account.business_profile?.mcc || '',
          url: account.business_profile?.url || '',
          supportEmail: account.business_profile?.support_email || '',
          supportPhone: account.business_profile?.support_phone || '',
        },
        payoutsSchedule: {
          interval: account.settings?.payouts?.schedule?.interval || '',
          delayDays: account.settings?.payouts?.schedule?.delay_days ?? '',
          weeklyAnchor: account.settings?.payouts?.schedule?.weekly_anchor || '',
          monthlyAnchor: account.settings?.payouts?.schedule?.monthly_anchor || '',
        },
        dashboard: {
          displayName: account.settings?.dashboard?.display_name || '',
          timezone: account.settings?.dashboard?.timezone || '',
        },
        chargesStatementDescriptor: account.settings?.card_payments?.statement_descriptor_prefix || '',
        externalAccountsCount: Number(account.external_accounts?.total_count || 0),
        defaultCurrency: account.default_currency || '',
        country: account.country || '',
        businessType: account.business_type || '',
        companyId,
      };
    } catch(error) {
      console.error('Unable to verify connected account billing readiness', error);
      throw new HttpsError(
        'internal',
        error.message || 'Unable to verify connected account billing readiness.'
      );
    }
  });



exports.getProductList = functions.https.onCall(async(data,context) => {
    const { connectedAccount, receivedData } = await requireManagedConnectedAccount({
      data,
      context,
      message: 'You must be signed in to list connected-account products.',
    });
    try {
      const listParams = {
        limit: Math.min(Number(receivedData.limit || 100), 100),
      };

      if (typeof receivedData.active === 'boolean') {
        listParams.active = receivedData.active;
      }

      const products = await stripe.products.list(listParams, {
        stripeAccount: connectedAccount,
      });
      return {
        productList:products
      }
    } catch(error) {
      console.error(error)
      throw new HttpsError('internal', error.message || 'Unable to list connected-account products.');
    }
  });

exports.createNewProduct = functions.https.onCall(async(data,context) => {
    const { connectedAccount, companyId, receivedData } = await requireManagedConnectedAccount({
      data,
      context,
      message: 'You must be signed in to create connected-account products.',
    });
    const name = String(receivedData.name || '').trim();
    const description = String(receivedData.description || '').trim();
    const unitAmountCents = Math.round(Number(receivedData.unitAmountCents || receivedData.priceCents || 0));
    const currency = String(receivedData.currency || 'usd').toLowerCase();

    if (!name) {
      throw new HttpsError('invalid-argument', 'Product name is required.');
    }

    try {
      const productPayload = {
        name,
        description: description || undefined,
        active: receivedData.active !== false,
        metadata: {
          companyId,
          source: 'legacyConnectedAccountProductScreen',
        },
        expand: ['default_price'],
      };

      if (unitAmountCents > 0) {
        productPayload.default_price_data = {
          currency,
          unit_amount: unitAmountCents,
          recurring: {
            interval: ['day', 'week', 'month', 'year'].includes(String(receivedData.interval || '').toLowerCase())
              ? String(receivedData.interval).toLowerCase()
              : 'month',
            interval_count: Math.max(Number(receivedData.intervalCount || 1), 1),
          },
        };
      }

      const product = await stripe.products.create(productPayload, {
        stripeAccount: connectedAccount,
      });

      return { product };
    } catch(error) {
      console.error(error);
      throw new HttpsError('internal', error.message || 'Unable to create connected-account product.');
    }
  });

  //------------------CRUD Price------------------
  exports.createNewPrice = functions.https.onCall(async(data,context) => {
    const { connectedAccount, receivedData } = await requireManagedConnectedAccount({
      data,
      context,
      message: 'You must be signed in to create connected-account prices.',
    });
    try {
      const price = await stripe.prices.create({
        product: receivedData.productId,
        currency: String(receivedData.currency || 'usd').toLowerCase(),
        unit_amount: Math.round(Number(receivedData.unitAmountCents || receivedData.price || 0)),
        active: receivedData.active !== false,
      }, {
        stripeAccount: connectedAccount,
      });
      return {
        price
  
      }
    } catch(error) {
      console.error(error)
      throw new HttpsError('internal', error.message || 'Unable to create connected-account price.');
    }
  });
  exports.getPriceList = functions.https.onCall(async(data,context) => {
    const { connectedAccount, receivedData } = await requireManagedConnectedAccount({
      data,
      context,
      message: 'You must be signed in to list connected-account prices.',
    });
    try {
      const listParams = {
        limit: Math.min(Number(receivedData.limit || 100), 100),
      };

      if (receivedData.productId) {
        listParams.product = receivedData.productId;
      }

      if (typeof receivedData.active === 'boolean') {
        listParams.active = receivedData.active;
      }

      const prices = await stripe.prices.list(listParams,
      {
        stripeAccount: connectedAccount,
      }
      );
      return {
        priceList:prices
      }
    } catch(error) {
  
      console.error(error)
      throw new HttpsError('internal', error.message || 'Unable to list connected-account prices.');
    }
  });

  
exports.getDefaultPrice = functions.https.onCall(async(data,context) => {
    const { connectedAccount, receivedData } = await requireManagedConnectedAccount({
      data,
      context,
      message: 'You must be signed in to retrieve connected-account prices.',
    });
    try {
      const price = await stripe.prices.retrieve(
        receivedData.priceId
        ,
        {},
        {
          stripeAccount: connectedAccount,
        }
      );
      return {
        price:price
      }
    } catch(error) {
  
      console.error(error)
      throw new HttpsError('internal', error.message || 'Unable to retrieve connected-account price.');
    }
  });
  //------------------CRUD Contract------------------

exports.acceptContract = functions.https.onCall(async(data,context) => {
    await requireManagedConnectedAccount({data,context,message:'Sign in to manage billing.'});
    throw new HttpsError('failed-precondition','Use the agreement’s current billing setup. Legacy contract checkout cannot create an untracked recurring charge.');
  });
  

exports.acceptContract2 = functions.https.onCall(async(data,context) => {
    await requireManagedConnectedAccount({data,context,message:'Sign in to manage billing.'});
    throw new HttpsError('failed-precondition','Use the agreement’s current billing setup. Legacy contract checkout cannot create an untracked recurring charge.');
  });
  
  exports.getSubcriptionList = functions.https.onCall(async(data,context) => {
    const { connectedAccount, receivedData } = await requireManagedConnectedAccount({
      data,
      context,
      message: 'You must be signed in to list connected-account subscriptions.',
    });
    try {
      const listParams = {
        limit: Math.min(Number(receivedData.limit || 100), 100),
      };

      if (receivedData.customerId) {
        listParams.customer = receivedData.customerId;
      }

      const subscriptions = await stripe.subscriptions.list(listParams,
      {
        stripeAccount: connectedAccount,
      });

      return {
        subscriptions:subscriptions
      }
    } catch(error) {
  
      console.error(error)
      throw new HttpsError('internal', error.message || 'Unable to list connected-account subscriptions.');
    }
  }); 
  
  //------------------CRUD Customer------------------
  exports.setUpConnectedAccountCustomer = functions.https.onCall(async(data,context) => {
    const { connectedAccount, receivedData } = await requireManagedConnectedAccount({
      data,
      context,
      message: 'You must be signed in to create connected-account customers.',
    });
    try {
      const customer = await stripe.customers.create({
        name: receivedData.name,
        email: receivedData.email,
        metadata: {
          companyId: receivedData.companyId || '',
        },
      },
       {
        stripeAccount: connectedAccount,
      }
    );

      return {
        customer:customer
      }
    } catch(error) {
  
      console.error(error)
      throw new HttpsError('internal', error.message || 'Unable to create connected-account customer.');
    }
  });
