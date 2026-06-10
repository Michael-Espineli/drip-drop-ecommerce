import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import {
  SalesAutopayStatus,
  SalesBillingMode,
  SalesBillingCollectionMethod,
  SalesBillingSubscriptionStatus,
  salesCollectionNames,
} from '../models/Sales';

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const cadenceToStripeInterval = (cadence = '', rateType = '') => {
  const cadenceKey = normalizeStatus(cadence);
  const rateKey = normalizeStatus(rateType);

  if (cadenceKey.includes('week') || rateKey.includes('week')) return 'week';
  if (cadenceKey.includes('year') || rateKey.includes('year')) return 'year';
  if (cadenceKey.includes('day') || rateKey.includes('day')) return 'day';
  return 'month';
};

const recurringIntervalCount = (agreement = {}) => Math.max(Number(agreement.serviceCadenceCount || 1), 1);

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

export const buildBillingSubscriptionFromAgreement = (agreement = {}, options = {}) => {
  const lineItems = copyLineItemsForBilling(agreement.lineItems);
  const missingStripePriceItemIds = lineItems
    .filter((item) => !item.stripePriceId)
    .map((item) => item.id || item.catalogItemId || item.name)
    .filter(Boolean);
  const stripeConnectedAccountId = options.stripeConnectedAccountId || agreement.stripeConnectedAccountId || '';
  const canStartStripeCheckout = Boolean(stripeConnectedAccountId) && Number(agreement.totalAmountCents || agreement.rateAmountCents || 0) > 0;

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
    stripeConnectedAccountId,
    stripeCustomerId: agreement.stripeCustomerId || '',
    stripeProductId: '',
    stripePriceId: '',
    stripeSubscriptionId: '',
    stripeSubscriptionItemId: '',
    stripeLatestInvoiceId: '',
    stripeDefaultPaymentMethodId: '',
    billingMode: SalesBillingMode.connectedAccountDirectCharge,
    billingCollectionMethod: SalesBillingCollectionMethod.manualUntilAutopay,
    status: canStartStripeCheckout
      ? SalesBillingSubscriptionStatus.pendingPaymentMethod
      : SalesBillingSubscriptionStatus.notStarted,
    stripeStatus: '',
    autopayStatus: canStartStripeCheckout ? SalesAutopayStatus.available : SalesAutopayStatus.unavailable,
    autopayEnabled: false,
    amountCents: Number(agreement.totalAmountCents || agreement.rateAmountCents || 0),
    currency: agreement.currency || 'usd',
    interval: cadenceToStripeInterval(agreement.serviceCadence, agreement.rateType),
    intervalCount: recurringIntervalCount(agreement),
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
      acceptedAt: agreement.acceptedAt || null,
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
      missingStripePriceItemIds,
      canUseInlineStripePrices: missingStripePriceItemIds.length > 0,
    },
    currentPeriodStart: agreement.startDate || null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    applicationFeePercent: null,
  };
};

export const ensureBillingSubscriptionForAgreement = async (db, agreement, options = {}) => {
  if (!agreement?.id) throw new Error('Missing agreement id.');

  const subscription = buildBillingSubscriptionFromAgreement(agreement, options);
  const agreementRef = doc(db, salesCollectionNames.agreements, agreement.id);
  const subscriptionRef = doc(db, salesCollectionNames.billingSubscriptions, subscription.id);

  await runTransaction(db, async (transaction) => {
    const [agreementSnap, subscriptionSnap] = await Promise.all([
      transaction.get(agreementRef),
      transaction.get(subscriptionRef),
    ]);

    if (!agreementSnap.exists()) throw new Error('Service agreement no longer exists.');

    const currentAgreement = { id: agreementSnap.id, ...agreementSnap.data() };
    const existingSubscription = subscriptionSnap.exists()
      ? { id: subscriptionSnap.id, ...subscriptionSnap.data() }
      : null;
    const hasStripeSubscription = Boolean(existingSubscription?.stripeSubscriptionId);
    const existingStatusKey = normalizeStatus(existingSubscription?.stripeStatus || existingSubscription?.status);
    const existingAutopayActive = hasStripeSubscription && ['active', 'trialing'].includes(existingStatusKey);
    const existingStripeManagedBilling = hasStripeSubscription && ['active', 'trialing', 'pastdue', 'unpaid', 'paused'].includes(existingStatusKey);
    const nextSubscription = {
      ...subscription,
      ...existingSubscription,
      companyId: subscription.companyId,
      customerId: subscription.customerId,
      customerUserId: subscription.customerUserId,
      relationshipId: subscription.relationshipId,
      customerCompanyRelationshipId: subscription.customerCompanyRelationshipId,
      customerName: subscription.customerName,
      email: subscription.email,
      serviceLocationIds: subscription.serviceLocationIds,
      agreementId: subscription.agreementId,
      billingProfileId: subscription.billingProfileId,
      stripeConnectedAccountId: subscription.stripeConnectedAccountId,
      billingCollectionMethod: hasStripeSubscription
        ? existingSubscription.billingCollectionMethod || (
          existingStripeManagedBilling ? SalesBillingCollectionMethod.automaticStripe : subscription.billingCollectionMethod
        )
        : subscription.billingCollectionMethod,
      status: hasStripeSubscription ? existingSubscription.status : subscription.status,
      stripeStatus: hasStripeSubscription ? existingSubscription.stripeStatus : subscription.stripeStatus,
      autopayStatus: hasStripeSubscription
        ? existingSubscription.autopayStatus || (
          existingAutopayActive
            ? SalesAutopayStatus.active
            : existingStatusKey === 'pastdue' || existingStatusKey === 'unpaid'
              ? SalesAutopayStatus.pastDue
              : subscription.autopayStatus
        )
        : subscription.autopayStatus,
      autopayEnabled: hasStripeSubscription
        ? existingAutopayActive || Boolean(existingSubscription.autopayEnabled)
        : subscription.autopayEnabled,
      amountCents: subscription.amountCents,
      currency: subscription.currency,
      interval: subscription.interval,
      intervalCount: subscription.intervalCount,
      serviceCadence: subscription.serviceCadence,
      rateType: subscription.rateType,
      paymentTerms: subscription.paymentTerms,
      invoiceDeliveryMethod: subscription.invoiceDeliveryMethod,
      lineItems: subscription.lineItems,
      agreementSnapshot: subscription.agreementSnapshot,
      checkoutStatus: hasStripeSubscription ? existingSubscription.checkoutStatus : subscription.checkoutStatus,
      nextAction: hasStripeSubscription ? existingSubscription.nextAction : subscription.nextAction,
      customerCanPayImmediately: hasStripeSubscription ? existingSubscription.customerCanPayImmediately : subscription.customerCanPayImmediately,
      manualBillingEnabled: hasStripeSubscription
        ? existingSubscription.manualBillingEnabled !== undefined
          ? existingSubscription.manualBillingEnabled !== false
          : !existingStripeManagedBilling
        : subscription.manualBillingEnabled,
      manualBillingStatus: hasStripeSubscription
        ? existingSubscription.manualBillingStatus || (
          existingAutopayActive
            ? 'disabledAutopayActive'
            : existingStripeManagedBilling
              ? 'disabledStripeBillingActive'
              : subscription.manualBillingStatus
        )
        : subscription.manualBillingStatus,
      manualBillingReason: hasStripeSubscription
        ? existingSubscription.manualBillingReason || (
          existingAutopayActive
            ? 'stripeAutopayActive'
            : existingStripeManagedBilling
              ? 'stripeAutopayNeedsAttention'
              : subscription.manualBillingReason
        )
        : subscription.manualBillingReason,
      receiptDeliveryMethod: existingSubscription?.receiptDeliveryMethod || subscription.receiptDeliveryMethod,
      receiptsEnabled: existingSubscription?.receiptsEnabled !== false && subscription.receiptsEnabled !== false,
      lastBillingSource: existingSubscription?.lastBillingSource || subscription.lastBillingSource,
      stripeReadiness: subscription.stripeReadiness,
      createdAt: existingSubscription?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    transaction.set(subscriptionRef, nextSubscription, { merge: true });
    const willBeAccepted = normalizeStatus(options.agreementUpdates?.status || currentAgreement.status) === 'accepted';
    const operationsSetupUpdates = willBeAccepted
      ? {
        operationsSetupStatus: currentAgreement.operationsSetupStatus || 'needsRecurringServiceStop',
        operationsSetupReason: currentAgreement.operationsSetupReason || 'acceptedServiceAgreement',
        operationsSetupUpdatedAt: serverTimestamp(),
      }
      : {};

    transaction.update(agreementRef, {
      billingSubscriptionId: subscription.id,
      billingFlowStatus: nextSubscription.status,
      billingFlowNextAction: nextSubscription.nextAction,
      billingFlowUpdatedAt: serverTimestamp(),
      billingCollectionMethod: nextSubscription.billingCollectionMethod,
      autopayStatus: nextSubscription.autopayStatus,
      manualBillingEnabled: nextSubscription.manualBillingEnabled,
      customerCanPayImmediately: nextSubscription.customerCanPayImmediately,
      ...operationsSetupUpdates,
      updatedAt: serverTimestamp(),
      ...options.agreementUpdates,
      acceptedSnapshot: {
        ...(currentAgreement.acceptedSnapshot || {}),
        ...(options.agreementUpdates?.acceptedSnapshot || {}),
        billingSubscriptionId: subscription.id,
        billingFlowStatus: nextSubscription.status,
        billingFlowNextAction: nextSubscription.nextAction,
        billingCollectionMethod: nextSubscription.billingCollectionMethod,
        autopayStatus: nextSubscription.autopayStatus,
        manualBillingEnabled: nextSubscription.manualBillingEnabled,
      },
    });
  });

  return subscription;
};
