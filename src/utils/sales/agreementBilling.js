import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import {
  SalesAutopayStatus,
  SalesBillingMode,
  SalesBillingCollectionMethod,
  SalesBillingSubscriptionStatus,
  SalesAgreementStatus,
  SalesAgreementChemicalBillingMode,
  salesCollectionNames,
} from '../models/Sales';
import {
  billingFrequencyForAgreement,
  billingFrequencyCountForAgreement,
  billingFrequencyToStripeInterval,
  billingIntervalCountForAgreement,
  serviceFrequencyCountForAgreement,
  serviceFrequencyForAgreement,
} from './agreementCadence';

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

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

const supersededSubscriptionUpdates = (subscription = {}, timestamp) => {
  const hasStripeSubscription = Boolean(subscription.stripeSubscriptionId);
  const statusKey = normalizeStatus(subscription.stripeStatus || subscription.status);
  const keepStripeManagedStatus = hasStripeSubscription && activeStripeStatusKeys.has(statusKey);

  return {
    supersededAt: timestamp,
    manualBillingEnabled: false,
    manualBillingStatus: 'disabledSupersededAgreement',
    manualBillingReason: 'agreementSuperseded',
    nextAction: keepStripeManagedStatus ? 'reviewStripeSubscriptionAfterRenewal' : 'agreementSuperseded',
    ...(keepStripeManagedStatus
      ? {}
      : {
        status: SalesBillingSubscriptionStatus.canceled,
        autopayStatus: SalesAutopayStatus.canceled,
        canceledAt: timestamp,
      }),
    updatedAt: timestamp,
  };
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

const copyList = (value) => (
  Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : String(value || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
);

export const buildBillingSubscriptionFromAgreement = (agreement = {}, options = {}) => {
  const lineItems = copyLineItemsForBilling(agreement.lineItems);
  const billingFrequency = billingFrequencyForAgreement(agreement);
  const billingFrequencyCount = billingFrequencyCountForAgreement(agreement);
  const serviceCadence = serviceFrequencyForAgreement(agreement);
  const serviceCadenceCount = serviceFrequencyCountForAgreement(agreement);
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
    interval: billingFrequencyToStripeInterval(billingFrequency, agreement.rateType),
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
    recurringServiceStopId: agreement.recurringServiceStopId || '',
    recurringRouteId: agreement.recurringRouteId || '',
    recurringRouteName: agreement.recurringRouteName || '',
    operationsSetupStatus: agreement.operationsSetupStatus || '',
    operationsSetupReason: agreement.operationsSetupReason || '',
    rateType: agreement.rateType || '',
    paymentTerms: agreement.paymentTerms || 'dueOnReceipt',
    invoiceDeliveryMethod: agreement.invoiceDeliveryMethod || 'email',
    lineItems,
    chemicalBillingMode: agreement.chemicalBillingMode || SalesAgreementChemicalBillingMode.includedAll,
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
      acceptedAt: agreement.acceptedAt || null,
      billingFrequency,
      billingFrequencyCount: String(billingFrequencyCount),
      serviceCadence,
      serviceCadenceCount: String(serviceCadenceCount),
      serviceDaysOfWeek: Array.isArray(agreement.serviceDaysOfWeek) ? agreement.serviceDaysOfWeek : [],
      serviceFrequencyLabel: agreement.serviceFrequencyLabel || '',
      previousAgreementId: agreement.previousAgreementId || agreement.supersedesAgreementId || '',
      supersedesAgreementId: agreement.supersedesAgreementId || agreement.previousAgreementId || '',
      agreementHistoryGroupId: agreementHistoryGroupId(agreement),
      agreementVersion: String(Math.max(Number(agreement.agreementVersion || 1), 1)),
      recurringServiceStopId: agreement.recurringServiceStopId || '',
      recurringRouteId: agreement.recurringRouteId || '',
      recurringRouteName: agreement.recurringRouteName || '',
      operationsSetupStatus: agreement.operationsSetupStatus || '',
      operationsSetupReason: agreement.operationsSetupReason || '',
      chemicalBillingMode: agreement.chemicalBillingMode || SalesAgreementChemicalBillingMode.includedAll,
      includedChemicalIds: copyList(agreement.includedChemicalIds),
      includedChemicalKeywords: copyList(agreement.includedChemicalKeywords),
      separatelyBilledChemicalIds: copyList(agreement.separatelyBilledChemicalIds),
      separatelyBilledChemicalKeywords: copyList(agreement.separatelyBilledChemicalKeywords),
      customerPurchasedChemicalIds: copyList(agreement.customerPurchasedChemicalIds),
      customerPurchasedChemicalKeywords: copyList(agreement.customerPurchasedChemicalKeywords),
      chemicalBillingNotes: agreement.chemicalBillingNotes || '',
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
      billingFrequency: subscription.billingFrequency,
      billingFrequencyCount: subscription.billingFrequencyCount,
      serviceCadence: subscription.serviceCadence,
      serviceCadenceCount: subscription.serviceCadenceCount,
      serviceDaysOfWeek: subscription.serviceDaysOfWeek,
      serviceFrequencyLabel: subscription.serviceFrequencyLabel,
      previousAgreementId: subscription.previousAgreementId,
      supersedesAgreementId: subscription.supersedesAgreementId,
      agreementHistoryGroupId: subscription.agreementHistoryGroupId,
      agreementVersion: subscription.agreementVersion,
      recurringServiceStopId: subscription.recurringServiceStopId,
      recurringRouteId: subscription.recurringRouteId,
      recurringRouteName: subscription.recurringRouteName,
      operationsSetupStatus: subscription.operationsSetupStatus,
      operationsSetupReason: subscription.operationsSetupReason,
      rateType: subscription.rateType,
      paymentTerms: subscription.paymentTerms,
      invoiceDeliveryMethod: subscription.invoiceDeliveryMethod,
      lineItems: subscription.lineItems,
      chemicalBillingMode: subscription.chemicalBillingMode,
      includedChemicalIds: subscription.includedChemicalIds,
      includedChemicalKeywords: subscription.includedChemicalKeywords,
      separatelyBilledChemicalIds: subscription.separatelyBilledChemicalIds,
      separatelyBilledChemicalKeywords: subscription.separatelyBilledChemicalKeywords,
      customerPurchasedChemicalIds: subscription.customerPurchasedChemicalIds,
      customerPurchasedChemicalKeywords: subscription.customerPurchasedChemicalKeywords,
      chemicalBillingNotes: subscription.chemicalBillingNotes,
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

    const willBeAccepted = normalizeStatus(options.agreementUpdates?.status || currentAgreement.status) === 'accepted';
    const acceptedTimestamp = options.agreementUpdates?.acceptedAt || serverTimestamp();
    const previousAgreementId = willBeAccepted ? renewalPreviousAgreementId(currentAgreement) : '';
    const historyGroupId = agreementHistoryGroupId(currentAgreement);
    let previousAgreementRef = null;
    let previousAgreement = null;
    let previousSubscriptionRef = null;
    let previousSubscription = null;

    if (previousAgreementId && previousAgreementId !== currentAgreement.id) {
      previousAgreementRef = doc(db, salesCollectionNames.agreements, previousAgreementId);
      const previousAgreementSnap = await transaction.get(previousAgreementRef);
      if (previousAgreementSnap.exists()) {
        previousAgreement = { id: previousAgreementSnap.id, ...previousAgreementSnap.data() };
        if (previousAgreement.billingSubscriptionId) {
          previousSubscriptionRef = doc(db, salesCollectionNames.billingSubscriptions, previousAgreement.billingSubscriptionId);
          const previousSubscriptionSnap = await transaction.get(previousSubscriptionRef);
          if (previousSubscriptionSnap.exists()) {
            previousSubscription = { id: previousSubscriptionSnap.id, ...previousSubscriptionSnap.data() };
          }
        }
      }
    }

    const operationsSetupUpdates = willBeAccepted
      ? {
        operationsSetupStatus: currentAgreement.operationsSetupStatus || 'needsRecurringServiceStop',
        operationsSetupReason: currentAgreement.operationsSetupReason || 'acceptedServiceAgreement',
        operationsSetupUpdatedAt: acceptedTimestamp,
      }
      : {};
    const renewalActivationUpdates = willBeAccepted
      ? {
        agreementHistoryGroupId: historyGroupId,
        agreementVersion: Math.max(Number(currentAgreement.agreementVersion || 1), 1),
        activatedAt: currentAgreement.activatedAt || acceptedTimestamp,
        startDate: currentAgreement.startDate || acceptedTimestamp,
        ...(previousAgreementId
          ? {
            previousAgreementId,
            supersedesAgreementId: previousAgreementId,
            previousAgreementEndedAt: acceptedTimestamp,
          }
          : {}),
      }
      : {};

    transaction.set(subscriptionRef, nextSubscription, { merge: true });
    transaction.update(agreementRef, {
      billingSubscriptionId: subscription.id,
      billingFlowStatus: nextSubscription.status,
      billingFlowNextAction: nextSubscription.nextAction,
      billingFlowUpdatedAt: acceptedTimestamp,
      billingCollectionMethod: nextSubscription.billingCollectionMethod,
      autopayStatus: nextSubscription.autopayStatus,
      manualBillingEnabled: nextSubscription.manualBillingEnabled,
      customerCanPayImmediately: nextSubscription.customerCanPayImmediately,
      ...operationsSetupUpdates,
      ...renewalActivationUpdates,
      updatedAt: acceptedTimestamp,
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

    if (previousAgreementRef && previousAgreement) {
      transaction.update(previousAgreementRef, {
        status: SalesAgreementStatus.superseded,
        endDate: currentAgreement.startDate || acceptedTimestamp,
        supersededAt: acceptedTimestamp,
        supersededByAgreementId: currentAgreement.id,
        supersededByAgreementTitle: currentAgreement.title || 'Service Agreement',
        agreementHistoryGroupId: historyGroupId,
        updatedAt: acceptedTimestamp,
        statusChangedAt: acceptedTimestamp,
        statusChangeReason: 'Superseded by accepted renewal agreement.',
      });
    }

    if (previousSubscriptionRef && previousSubscription) {
      transaction.update(previousSubscriptionRef, {
        ...supersededSubscriptionUpdates(previousSubscription, acceptedTimestamp),
        supersededByAgreementId: currentAgreement.id,
        supersededByBillingSubscriptionId: subscription.id,
      });
    }
  });

  return subscription;
};
