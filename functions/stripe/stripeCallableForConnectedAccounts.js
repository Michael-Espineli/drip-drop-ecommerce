
const { onCall, HttpsError } = require("firebase-functions/v2/https");
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

// CORRECTED: Use the Stripe API key from the environment variables loaded in index.js
const stripe = require("stripe")(process.env.STRIPE_API_KEY || 'sk_test_dummyApiKey');

const salesCollectionNames = {
  billingProfiles: 'salesBillingProfiles',
  agreements: 'salesAgreements',
  billingSubscriptions: 'salesBillingSubscriptions',
};

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
    throw new functions.https.HttpsError('unauthenticated', message);
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    return {
      uid: decodedToken.uid,
      token: decodedToken,
    };
  } catch (error) {
    console.error('Unable to verify callable id token', error);
    throw new functions.https.HttpsError('unauthenticated', message);
  }
};

const userHasCompanyAccess = async (uid, companyId) => {
  if (!uid || !companyId) return false;

  const accessDoc = await db
    .collection('users')
    .doc(uid)
    .collection('userAccess')
    .doc(companyId)
    .get();

  return accessDoc.exists;
};

const userCanAccessSalesRecord = async ({ auth, record }) => {
  if (!auth || !record) return false;

  const recordCustomerUserId = String(record.customerUserId || '').trim();
  if (recordCustomerUserId && recordCustomerUserId === auth.uid) return true;

  if (await userHasCompanyAccess(auth.uid, record.companyId)) return true;

  if (recordCustomerUserId) return false;

  const authEmail = normalizeEmail(auth.token?.email);
  const recordEmail = normalizeEmail(record.email || record.customerEmail || record.billingEmail);
  if (authEmail && recordEmail && authEmail === recordEmail) return true;

  return false;
};

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const linkedJobIdForAgreement = (agreement = {}) => {
  if (agreement.jobId) return agreement.jobId;
  if (agreement.workOrderId) return agreement.workOrderId;
  if (normalizeStatus(agreement.sourceType) === 'oneoffjob' && agreement.sourceId) return agreement.sourceId;
  return '';
};

const syncLinkedJobForAgreementStatus = async ({
  agreement,
  status,
  actorUserId = '',
  actorUserName = '',
  timestamp = admin.firestore.FieldValue.serverTimestamp(),
}) => {
  const companyId = agreement.companyId || '';
  const jobId = linkedJobIdForAgreement(agreement);
  if (!companyId || !jobId) return;

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
    if (!job.operationStatus || ['Estimate Pending', 'Unscheduled'].includes(job.operationStatus)) {
      update.operationStatus = 'Unscheduled';
    }
  }

  if (statusKey === 'sent') {
    update.billingStatus = 'Estimate';
    update.salesAgreementSentAt = timestamp;
    if (!job.operationStatus || job.operationStatus === 'Estimate Pending') {
      update.operationStatus = 'Unscheduled';
    }
  }

  await jobRef.set(update, { merge: true });
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
  if (cadenceKey.includes('year') || rateKey.includes('year')) return 'year';
  if (cadenceKey.includes('day') || rateKey.includes('day')) return 'day';
  return 'month';
};

const copyLineItemsForBilling = (lineItems = []) => (
  Array.isArray(lineItems)
    ? lineItems.map((item) => ({
      id: item.id || item.catalogItemId || '',
      catalogItemId: item.catalogItemId || '',
      sourceType: item.sourceType || 'manual',
      sourceId: item.sourceId || '',
      name: item.name || item.description || 'Service',
      description: item.description || '',
      quantity: Number(item.quantity || 1),
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

const buildSalesBillingSubscriptionFromAgreement = ({ agreement, stripeConnectedAccountId }) => {
  const lineItems = copyLineItemsForBilling(agreement.lineItems);
  const amountCents = Number(agreement.totalAmountCents || agreement.rateAmountCents || 0);
  const canStartStripeCheckout = Boolean(stripeConnectedAccountId) && amountCents > 0;

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
    currency: agreement.currency || 'usd',
    interval: cadenceToStripeInterval(agreement.serviceCadence, agreement.rateType),
    intervalCount: Math.max(Number(agreement.serviceCadenceCount || 1), 1),
    serviceCadence: agreement.serviceCadence || '',
    rateType: agreement.rateType || '',
    paymentTerms: agreement.paymentTerms || 'dueOnReceipt',
    invoiceDeliveryMethod: agreement.invoiceDeliveryMethod || 'email',
    lineItems,
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
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    checkoutSessionId: '',
    checkoutUrl: '',
    checkoutStatus: 'notStarted',
    nextAction: canStartStripeCheckout ? 'collectPaymentMethod' : 'connectStripeAccount',
    customerCanPayImmediately: canStartStripeCheckout,
    manualBillingEnabled: true,
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
    applicationFeePercent: null,
  };
};

const requireCompanyManagerForSalesSubscription = async ({ auth, billingSubscriptionId, companyId }) => {
  if (!auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in to manage billing subscriptions.');
  }

  if (!billingSubscriptionId || !companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'billingSubscriptionId and companyId are required.');
  }

  const subscriptionRef = db.collection(salesCollectionNames.billingSubscriptions).doc(billingSubscriptionId);
  const subscriptionSnap = await subscriptionRef.get();

  if (!subscriptionSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Billing subscription was not found.');
  }

  const subscription = { id: subscriptionSnap.id, ...subscriptionSnap.data() };

  if (subscription.companyId !== companyId) {
    throw new functions.https.HttpsError('permission-denied', 'This billing subscription belongs to another company.');
  }

  const hasAccess = await userHasCompanyAccess(auth.uid, companyId);
  if (!hasAccess) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to manage billing for this company.');
  }

  return { subscriptionRef, subscription };
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
  const updateData = buildStripeSubscriptionUpdateData({ stripeSubscription, connectedAccount });

  if (updateData.status === 'active' && !subscription.operationsSetupStatus) {
    updateData.operationsSetupStatus = 'needsRecurringServiceStop';
    updateData.operationsSetupReason = 'paidBillingSubscription';
    updateData.operationsSetupUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  const batch = db.batch();
  batch.set(subscriptionRef, updateData, { merge: true });

  if (subscription.agreementId || stripeSubscription.metadata?.salesAgreementId) {
    const agreementId = subscription.agreementId || stripeSubscription.metadata.salesAgreementId;
    const agreementUpdate = {
      stripeCustomerId: updateData.stripeCustomerId,
      billingSubscriptionId: subscription.id,
      billingFlowStatus: updateData.status,
      billingFlowNextAction: updateData.nextAction,
      billingFlowUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      billingCollectionMethod: updateData.billingCollectionMethod,
      autopayStatus: updateData.autopayStatus,
      manualBillingEnabled: updateData.manualBillingEnabled,
      customerCanPayImmediately: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (updateData.operationsSetupStatus) {
      agreementUpdate.operationsSetupStatus = updateData.operationsSetupStatus;
      agreementUpdate.operationsSetupReason = updateData.operationsSetupReason;
      agreementUpdate.operationsSetupUpdatedAt = updateData.operationsSetupUpdatedAt;
    }

    batch.set(db.collection(salesCollectionNames.agreements).doc(agreementId), agreementUpdate, { merge: true });
  }

  await batch.commit();

  return updateData;
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
    throw new functions.https.HttpsError(
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

exports.acceptSalesServiceAgreement = functions.https.onCall(async (data, context) => {
  const callableAuth = await getCallableAuth(data, context, 'You must be signed in to accept a service agreement.');
  const receivedData = getCallableData(data);
  const agreementId = receivedData.agreementId;
  const acceptanceNote = String(receivedData.acceptanceNote || '').trim();

  if (!agreementId) {
    throw new functions.https.HttpsError('invalid-argument', 'agreementId is required.');
  }

  const agreementRef = db.collection(salesCollectionNames.agreements).doc(agreementId);
  const agreementSnap = await agreementRef.get();

  if (!agreementSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Service agreement was not found.');
  }

  const agreement = { id: agreementSnap.id, ...agreementSnap.data() };
  const canAccess = await userCanAccessSalesRecord({ auth: callableAuth, record: agreement });

  if (!canAccess) {
    throw new functions.https.HttpsError('permission-denied', 'This service agreement does not belong to your account.');
  }

  const statusKey = normalizeStatus(agreement.status);
  if (['canceled', 'rejected', 'expired'].includes(statusKey)) {
    throw new functions.https.HttpsError('failed-precondition', 'This service agreement is no longer available to accept.');
  }

  const companyDoc = await db.collection('companies').doc(agreement.companyId).get();
  const companyData = companyDoc.exists ? companyDoc.data() : {};
  const stripeConnectedAccountId = agreement.stripeConnectedAccountId || companyData.stripeConnectedAccountId || '';
  const subscriptionDraft = buildSalesBillingSubscriptionFromAgreement({ agreement, stripeConnectedAccountId });
  const subscriptionRef = db.collection(salesCollectionNames.billingSubscriptions).doc(subscriptionDraft.id);
  const acceptedAt = admin.firestore.FieldValue.serverTimestamp();
  const acceptedByEmail = callableAuth.token?.email || agreement.email || '';
  const acceptedByName = callableAuth.token?.name || agreement.customerName || acceptedByEmail || 'Customer';

  await db.runTransaction(async (transaction) => {
    const [freshAgreementSnap, subscriptionSnap] = await Promise.all([
      transaction.get(agreementRef),
      transaction.get(subscriptionRef),
    ]);

    if (!freshAgreementSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Service agreement was not found.');
    }

    const freshAgreement = { id: freshAgreementSnap.id, ...freshAgreementSnap.data() };
    const existingSubscription = subscriptionSnap.exists
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
      serviceCadence: subscriptionDraft.serviceCadence,
      rateType: subscriptionDraft.rateType,
      paymentTerms: subscriptionDraft.paymentTerms,
      invoiceDeliveryMethod: subscriptionDraft.invoiceDeliveryMethod,
      lineItems: subscriptionDraft.lineItems,
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

    transaction.set(subscriptionRef, nextSubscription, { merge: true });
    transaction.set(agreementRef, {
      status: 'accepted',
      acceptedAt,
      acceptedByUserId: callableAuth.uid,
      acceptedByUserName: acceptedByName,
      acceptedByEmail,
      acceptedSource: 'customerPortal',
      acceptedNote: acceptanceNote,
      acceptedSnapshot: {
        agreementId: freshAgreement.id,
        title: freshAgreement.title || 'Service Agreement',
        totalAmountCents: Number(freshAgreement.totalAmountCents || freshAgreement.rateAmountCents || 0),
        lineItems: Array.isArray(freshAgreement.lineItems) ? freshAgreement.lineItems : [],
        terms: freshAgreement.terms || '',
        termsList: Array.isArray(freshAgreement.termsList) ? freshAgreement.termsList : [],
        acceptedAt,
        acceptedByUserId: callableAuth.uid,
        acceptedByUserName: acceptedByName,
        acceptedByEmail,
        billingSubscriptionId: subscriptionDraft.id,
        billingFlowStatus: nextSubscription.status,
        billingFlowNextAction: nextSubscription.nextAction,
        billingCollectionMethod: nextSubscription.billingCollectionMethod,
        autopayStatus: nextSubscription.autopayStatus,
        manualBillingEnabled: nextSubscription.manualBillingEnabled,
      },
      billingSubscriptionId: subscriptionDraft.id,
      billingFlowStatus: nextSubscription.status,
      billingFlowNextAction: nextSubscription.nextAction,
      billingFlowUpdatedAt: acceptedAt,
      billingCollectionMethod: nextSubscription.billingCollectionMethod,
      autopayStatus: nextSubscription.autopayStatus,
      manualBillingEnabled: nextSubscription.manualBillingEnabled,
      customerUserId: freshAgreement.customerUserId || callableAuth.uid,
      customerCanPayImmediately: nextSubscription.customerCanPayImmediately,
      operationsSetupStatus: freshAgreement.operationsSetupStatus || 'needsRecurringServiceStop',
      operationsSetupReason: freshAgreement.operationsSetupReason || 'acceptedServiceAgreement',
      operationsSetupUpdatedAt: acceptedAt,
      updatedAt: acceptedAt,
    }, { merge: true });
  });

  await syncLinkedJobForAgreementStatus({
    agreement,
    status: 'accepted',
    actorUserId: callableAuth.uid,
    actorUserName: acceptedByName,
    timestamp: acceptedAt,
  });

  return {
    status: 'success',
    agreementId,
    billingSubscriptionId: subscriptionDraft.id,
    customerCanPayImmediately: subscriptionDraft.customerCanPayImmediately,
    nextAction: subscriptionDraft.nextAction,
  };
});

exports.createSalesBillingSubscriptionCheckoutSession = functions.https.onCall(async (data, context) => {
  const callableAuth = await getCallableAuth(data, context, 'You must be signed in to start Stripe Checkout.');
  const receivedData = getCallableData(data);
  const {
    billingSubscriptionId,
    agreementId,
    companyId,
    successUrl,
    cancelUrl,
  } = receivedData;

  if (!billingSubscriptionId || !companyId || !successUrl || !cancelUrl) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'billingSubscriptionId, companyId, successUrl, and cancelUrl are required.'
    );
  }

  const subscriptionRef = db.collection(salesCollectionNames.billingSubscriptions).doc(billingSubscriptionId);
  const subscriptionSnap = await subscriptionRef.get();

  if (!subscriptionSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Billing subscription was not found.');
  }

  const subscription = { id: subscriptionSnap.id, ...subscriptionSnap.data() };

  if (subscription.companyId !== companyId) {
    throw new functions.https.HttpsError('permission-denied', 'This billing subscription belongs to another company.');
  }

  const canAccess = await userCanAccessSalesRecord({ auth: callableAuth, record: subscription });
  if (!canAccess) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to this billing subscription.');
  }

  if (agreementId && subscription.agreementId && subscription.agreementId !== agreementId) {
    throw new functions.https.HttpsError('invalid-argument', 'Billing subscription does not match the service agreement.');
  }

  if (subscription.stripeSubscriptionId && ['active', 'trialing'].includes(String(subscription.stripeStatus || subscription.status || '').toLowerCase())) {
    return {
      status: 'already_active',
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      message: 'This billing subscription is already active in Stripe.',
    };
  }

  const connectedAccount = subscription.stripeConnectedAccountId;
  if (!connectedAccount) {
    throw new functions.https.HttpsError('failed-precondition', 'The company needs a Stripe connected account before Checkout can start.');
  }

  const lineItems = buildCheckoutLineItems(subscription);
  if (lineItems.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'At least one billable line item is required before Checkout can start.');
  }

  try {
    const account = await stripe.accounts.retrieve(connectedAccount);
    if (!account.charges_enabled) {
      throw new functions.https.HttpsError('failed-precondition', 'Stripe says this connected account cannot create charges yet.');
    }

    const stripeCustomer = await getOrCreateConnectedStripeCustomer({ subscription, connectedAccount });
    const metadata = {
      flow: 'sales_billing_subscription',
      companyId,
      salesBillingSubscriptionId: billingSubscriptionId,
      salesAgreementId: subscription.agreementId || agreementId || '',
      salesCustomerId: subscription.customerId || '',
      createdByUserId: callableAuth.uid,
      stripeConnectedAccountId: connectedAccount,
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomer.id,
      payment_method_types: ['card'],
      line_items: lineItems,
      client_reference_id: billingSubscriptionId,
      metadata,
      subscription_data: {
        metadata,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    }, {
      stripeAccount: connectedAccount,
    });

    const updateData = {
      stripeCustomerId: stripeCustomer.id,
      checkoutSessionId: session.id,
      checkoutUrl: session.url || '',
      checkoutStatus: 'created',
      status: 'pendingStripe',
      billingCollectionMethod: 'manualUntilAutopay',
      autopayStatus: 'checkoutStarted',
      autopayEnabled: false,
      manualBillingEnabled: subscription.manualBillingEnabled !== false,
      manualBillingStatus: subscription.manualBillingStatus || 'readyToInvoice',
      manualBillingReason: 'autopayCheckoutStarted',
      nextAction: 'completeCheckout',
      customerCanPayImmediately: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      stripeCheckoutCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      stripeCheckoutCreatedByUserId: callableAuth.uid,
    };

    const batch = db.batch();
    batch.set(subscriptionRef, updateData, { merge: true });

    if (subscription.billingProfileId) {
      batch.set(db.collection('salesBillingProfiles').doc(subscription.billingProfileId), {
        stripeCustomerId: stripeCustomer.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    if (subscription.agreementId || agreementId) {
      batch.set(db.collection(salesCollectionNames.agreements).doc(subscription.agreementId || agreementId), {
        stripeCustomerId: stripeCustomer.id,
        billingFlowStatus: 'pendingStripe',
        billingFlowNextAction: 'completeCheckout',
        billingFlowUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        billingCollectionMethod: 'manualUntilAutopay',
        autopayStatus: 'checkoutStarted',
        manualBillingEnabled: subscription.manualBillingEnabled !== false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    await batch.commit();

    return {
      status: 'success',
      url: session.url,
      sessionId: session.id,
      stripeCustomerId: stripeCustomer.id,
    };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;

    console.error('Unable to create sales billing Checkout session', error);
    throw new functions.https.HttpsError(
      'internal',
      error.message || 'Unable to create Stripe Checkout session.'
    );
  }
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
    throw new functions.https.HttpsError('failed-precondition', 'This billing subscription does not have a Stripe subscription yet.');
  }

  const connectedAccount = subscription.stripeConnectedAccountId;
  if (!connectedAccount) {
    throw new functions.https.HttpsError('failed-precondition', 'This billing subscription is missing a Stripe connected account id.');
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
    throw new functions.https.HttpsError(
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
    throw new functions.https.HttpsError('failed-precondition', 'This billing subscription is missing a Stripe connected account id.');
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
    throw new functions.https.HttpsError(
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
    throw new functions.https.HttpsError('failed-precondition', 'This billing subscription does not have a Stripe subscription yet.');
  }

  const connectedAccount = subscription.stripeConnectedAccountId;
  if (!connectedAccount) {
    throw new functions.https.HttpsError('failed-precondition', 'This billing subscription is missing a Stripe connected account id.');
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
    throw new functions.https.HttpsError(
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
    throw new functions.https.HttpsError('failed-precondition', 'This billing subscription does not have a Stripe subscription yet.');
  }

  const connectedAccount = subscription.stripeConnectedAccountId;
  if (!connectedAccount) {
    throw new functions.https.HttpsError('failed-precondition', 'This billing subscription is missing a Stripe connected account id.');
  }

  const rawLineItems = Array.isArray(subscription.lineItems) ? subscription.lineItems : [];
  if (!rawLineItems.length) {
    throw new functions.https.HttpsError('failed-precondition', 'Add at least one line item before updating Stripe pricing.');
  }

  try {
    const priceResults = await Promise.all(
      rawLineItems.map((item, index) => createConnectedAccountPriceForSalesLineItem({
        connectedAccount,
        subscription,
        item,
        index,
      }))
    );

    const nextLineItems = rawLineItems.map((item, index) => ({
      ...item,
      stripePriceId: priceResults[index].stripePriceId,
      stripeProductId: priceResults[index].stripeProductId || item.stripeProductId || '',
    }));
    const createdPriceCount = priceResults.filter((result) => result.created).length;
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId, {
      expand: ['items.data.price'],
    }, {
      stripeAccount: connectedAccount,
    });
    const existingItems = stripeSubscription.items?.data || [];
    const updateItems = [
      ...existingItems.map((item) => ({
        id: item.id,
        deleted: true,
      })),
      ...nextLineItems.map((item) => ({
        price: item.stripePriceId,
        quantity: Math.max(Number(item.quantity || 1), 1),
      })),
    ];
    const updatedStripeSubscription = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      items: updateItems,
      proration_behavior: prorationBehavior,
      metadata: {
        ...(stripeSubscription.metadata || {}),
        salesBillingSubscriptionId: subscription.id,
        salesAgreementId: subscription.agreementId || '',
        companyId: subscription.companyId || '',
        stripeConnectedAccountId: connectedAccount,
      },
    }, {
      stripeAccount: connectedAccount,
    });

    await subscriptionRef.set({
      lineItems: nextLineItems,
      stripePricingUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      stripePricingUpdatedByUserId: context.auth.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const updateData = await syncSalesSubscriptionRecordFromStripe({
      subscriptionRef,
      subscription: {
        ...subscription,
        lineItems: nextLineItems,
      },
      stripeSubscription: updatedStripeSubscription,
      connectedAccount,
    });

    return {
      status: 'success',
      stripeSubscriptionId: updatedStripeSubscription.id,
      stripeStatus: updateData.stripeStatus,
      billingStatus: updateData.status,
      nextAction: updateData.nextAction,
      createdPriceCount,
      lineItemCount: nextLineItems.length,
    };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;

    console.error('Unable to update sales billing subscription Stripe items', error);
    throw new functions.https.HttpsError(
      'internal',
      error.message || 'Unable to update Stripe pricing for this billing subscription.'
    );
  }
});


exports.verifyConnectedAccountBillingReadiness = functions.https.onCall(async(data, context) => {
    const receivedData = data.data || data;
    const connectedAccount = receivedData.connectedAccount || receivedData.stripeConnectedAccountId;

    if (!connectedAccount) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'A Stripe connected account id is required.'
      );
    }

    try {
      const account = await stripe.accounts.retrieve(connectedAccount);
      const requirements = account.requirements || {};
      const capabilities = account.capabilities || {};
      const currentlyDue = requirements.currently_due || [];
      const pastDue = requirements.past_due || [];
      const errors = requirements.errors || [];
      const cardPaymentsCapability = capabilities.card_payments || 'unknown';
      const transfersCapability = capabilities.transfers || 'unknown';
      const canCreateCharges = Boolean(account.charges_enabled);
      const canProcessCardPayments = cardPaymentsCapability === 'active';
      const canReceivePayouts = Boolean(account.payouts_enabled);
      const hasBlockingRequirements = currentlyDue.length > 0 || pastDue.length > 0 || errors.length > 0;
      const canBillCustomers = canCreateCharges && canProcessCardPayments && !hasBlockingRequirements;

      return {
        accountId: account.id,
        canBillCustomers,
        chargesEnabled: canCreateCharges,
        cardPaymentsEnabled: canProcessCardPayments,
        payoutsEnabled: canReceivePayouts,
        detailsSubmitted: Boolean(account.details_submitted),
        disabledReason: requirements.disabled_reason || '',
        currentlyDue,
        pastDue,
        eventuallyDue: requirements.eventually_due || [],
        pendingVerification: requirements.pending_verification || [],
        errors,
        capabilities: {
          cardPayments: cardPaymentsCapability,
          transfers: transfersCapability,
        },
        defaultCurrency: account.default_currency || '',
        country: account.country || '',
        businessType: account.business_type || '',
      };
    } catch(error) {
      console.error('Unable to verify connected account billing readiness', error);
      throw new functions.https.HttpsError(
        'internal',
        error.message || 'Unable to verify connected account billing readiness.'
      );
    }
  });



exports.getProductList = functions.https.onCall(async(data,context) => {
    const receivedData = data.data
    try {
      const products = await stripe.products.list({
        stripeAccount: receivedData.connectedAccount,
        active: receivedData.active,
      });
      return {
        productList:products
      }
    } catch(error) {
      console.error(error)
    }
  });
  //------------------CRUD Price------------------
  exports.createNewPrice = functions.https.onCall(async(data,context) => {
    const receivedData = data.data
    try {
      const product = await stripe.price.create({
        name: receivedData.name,
        description: receivedData.description,
        active: receivedData.active
      },
      {
        stripeAccount: receivedData.connectedAccount,
      });
      return {
        product:product
  
      }
    } catch(error) {
      console.error(error)
    }
  });
  exports.getPriceList = functions.https.onCall(async(data,context) => {
    const receivedData = data.data
    console.log('-------------- receivedData -------------------')
  
    console.log(receivedData)
    try {
      const prices = await stripe.prices.list({
        product : receivedData.productId,
        active : receivedData.active
      },
      {
        stripeAccount: receivedData.connectedAccount,
      }
      );
      console.log('-------------- Prices -------------------')
      console.log(prices)
      return {
        priceList:prices
      }
    } catch(error) {
  
      console.error(error)
    }
  });

  
exports.getDefaultPrice = functions.https.onCall(async(data,context) => {
    const receivedData = data.data
    console.log('-------------- receivedData -------------------')
    //priceId:String
    //connectedAccount:String
    console.log(receivedData)
    try {
      const price = await stripe.prices.retrieve(
        receivedData.priceId
        ,
        {
          stripeAccount: receivedData.connectedAccount,
        }
      );
  
      console.log('-------------- Prices -------------------')
      console.log(price)
      return {
        price:price
      }
    } catch(error) {
  
      console.error(error)
    }
  });
  //------------------CRUD Contract------------------

exports.acceptContract = functions.https.onCall(async(data,context) => {
    const receivedData = data.data
  
    console.log('-------------- Received Data -------------------')
  
    console.log(receivedData)
  
    try {
  
      const subscription = await stripe.subscriptions.create(
        {
          customer: receivedData.customerId,
          items: [
            {
              price: receivedData.priceId,
            },
          ],
          expand: ['latest_invoice.payment_intent'],
        },
        {
          stripeAccount: receivedData.connectedAccount,
        }
      );
  
      console.log('-------------- subscription -------------------')
      console.log(subscription)
      return {
        subscription:subscription
      }
    } catch(error) {
  
      console.error(error)
    }
  });
  

exports.acceptContract2 = functions.https.onCall(async(data,context) => {
    const receivedData = data.data
  
    console.log('-------------- Received Data -------------------')
  
    console.log(receivedData)
  
    try {
  
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer:receivedData.customerId,
        line_items: [
          {
            price: receivedData.priceId,
            // For metered billing, do not pass quantity
            quantity: 1,
          },
        ],
        // {CHECKOUT_SESSION_ID} is a string literal; do not change it!
        // the actual Session ID is returned in the query parameter when your customer
        // is redirected to the success page.
        success_url: 'http://localhost:3000/success/sessionId/{CHECKOUT_SESSION_ID}',
        cancel_url: 'http://localhost:3000/canceled',
      },
      {
        stripeAccount: receivedData.connectedAccount,
      });
  
      console.log('-------------- subscription -------------------')
      console.log(session)
      return {
        session:session
      }
    } catch(error) {
  
      console.error(error)
    }
  });
  
  exports.getSubcriptionList = functions.https.onCall(async(data,context) => {
    const receivedData = data.data
    console.log('-------------- receivedData -------------------')
  
    console.log(receivedData)
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: receivedData.customerId,
      },
      {
        stripeAccount: receivedData.connectedAccount,
      });
      
      console.log('-------------- subscriptions -------------------')
      console.log(subscriptions)
      return {
        subscriptions:subscriptions
      }
    } catch(error) {
  
      console.error(error)
    }
  }); 
  
  //------------------CRUD Customer------------------
  exports.setUpConnectedAccountCustomer = functions.https.onCall(async(data,context) => {
    const receivedData = data.data
    console.log('-------------- receivedData -------------------')
  
    console.log(receivedData)
    try {
      const customer = await stripe.customers.create({
        name: receivedData.name,
        email: receivedData.email,
      },
       {
        stripeAccount: receivedData.connectedAccount,
      }
    );
   
      console.log('-------------- Prices -------------------')
      console.log(customer)
      return {
        customer:customer
      }
    } catch(error) {
  
      console.error(error)
    }
  });
