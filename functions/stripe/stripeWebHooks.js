require('dotenv').config({ path: `.env.${process.env.GCLOUD_PROJECT}` });
// Rewritten to use the modern v2 Cloud Function structure.
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require('uuid');
const {
    createStripeProxy,
} = require("./stripeClient");

const stripe = createStripeProxy();

// Securely access webhook secrets from environment variables. Stripe issues a
// different signing secret for each endpoint, so allow comma-separated values.
const endpointSecrets = [
    ...(process.env.STRIPE_WEBHOOK_SECRET || '').split(','),
    ...(process.env.STRIPE_WEBHOOK_SECRETS || '').split(','),
]
    .map((secret) => secret.trim())
    .filter(Boolean);

const salesCollectionNames = {
    agreements: 'salesAgreements',
    billingSubscriptions: 'salesBillingSubscriptions',
    invoices: 'salesInvoices',
    payments: 'salesPayments',
    paymentEvents: 'salesPaymentEvents',
    payouts: 'stripePayouts',
};

const timestampFromStripeSeconds = (seconds) => (
    seconds ? admin.firestore.Timestamp.fromMillis(seconds * 1000) : null
);

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

const mapStripeInvoiceStatus = (status) => {
    if (status === 'paid') return 'paid';
    if (status === 'void') return 'void';
    if (status === 'uncollectible') return 'uncollectible';
    return 'open';
};

const normalizeSalesPaymentMethodType = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['ach', 'bank', 'bank_account', 'us_bank_account'].includes(normalized)) return 'ach';
    if (['card', 'credit_card', 'debit_card'].includes(normalized)) return 'card';
    return '';
};

const salesPaymentMethodPolicy = (value) => {
    const paymentMethodType = normalizeSalesPaymentMethodType(value) || 'card';

    if (paymentMethodType === 'ach') {
        return {
            paymentMethodType: 'ach',
            stripePaymentMethodType: 'us_bank_account',
            stripePaymentMethodTypes: ['us_bank_account'],
            paymentMethodLabel: 'Bank account (ACH)',
            salesPaymentMethod: 'stripeAch',
        };
    }

    return {
        paymentMethodType: 'card',
        stripePaymentMethodType: 'card',
        stripePaymentMethodTypes: ['card'],
        paymentMethodLabel: 'Card',
        salesPaymentMethod: 'stripeCard',
    };
};

const normalizeApplicationFeePercent = (value) => {
    if (value === undefined || value === null || value === '') return null;

    const percent = Number(value);
    if (!Number.isFinite(percent) || percent <= 0) return null;

    return Math.min(Math.round(percent * 100) / 100, 100);
};

const constructStripeWebhookEvent = (rawBody, signature) => {
    if (endpointSecrets.length === 0) {
        throw new Error('Stripe webhook signing secret is not configured.');
    }

    let lastError;
    for (const secret of endpointSecrets) {
        try {
            return stripe.webhooks.constructEvent(rawBody, signature, secret);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError;
};

const normalizeStripeAccountId = (value) => {
    const id = typeof value === 'string' ? value.trim() : '';
    return id.startsWith('acct_') ? id : '';
};

const findCompanyByConnectedAccountId = async (connectedAccount) => {
    const accountId = normalizeStripeAccountId(connectedAccount);
    if (!accountId) return null;

    const snapshot = await admin.firestore()
        .collection('companies')
        .where('stripeConnectedAccountId', '==', accountId)
        .limit(1)
        .get();

    if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return {
            ref: doc.ref,
            data: { id: doc.id, ...doc.data() },
        };
    }

    const legacySnapshot = await admin.firestore()
        .collection('companies')
        .where('stripeConnectAccountId', '==', accountId)
        .limit(1)
        .get();

    if (legacySnapshot.empty) return null;

    const doc = legacySnapshot.docs[0];
    return {
        ref: doc.ref,
        data: { id: doc.id, ...doc.data() },
    };
};

const mapConnectedAccountStatus = (account = {}) => {
    const requirements = account.requirements || {};
    const hasBlockingRequirements = Boolean(
        requirements.disabled_reason ||
        requirements.currently_due?.length ||
        requirements.past_due?.length ||
        requirements.errors?.length
    );

    if (!account.details_submitted) return 'Not Started';
    if (account.charges_enabled && account.payouts_enabled && !hasBlockingRequirements) return 'Ready';
    return 'Needs Attention';
};

const syncConnectedAccountSnapshot = async ({ account, connectedAccount, event }) => {
    const accountId = normalizeStripeAccountId(connectedAccount || account?.id);
    if (!accountId) return false;

    const company = await findCompanyByConnectedAccountId(accountId);
    if (!company) return false;

    const requirements = account.requirements || {};
    const capabilities = account.capabilities || {};

    await company.ref.set({
        stripeConnectedAccountId: accountId,
        stripeConnectedAccountStatus: mapConnectedAccountStatus(account),
        stripeConnectAccountId: accountId,
        stripeConnectAccountStatus: mapConnectedAccountStatus(account),
        stripeConnectedAccountChargesEnabled: Boolean(account.charges_enabled),
        stripeConnectedAccountPayoutsEnabled: Boolean(account.payouts_enabled),
        stripeConnectedAccountDetailsSubmitted: Boolean(account.details_submitted),
        stripeConnectedAccountLivemode: Boolean(account.livemode),
        stripeConnectedAccountDefaultCurrency: account.default_currency || '',
        stripeConnectedAccountCountry: account.country || '',
        stripeConnectedAccountBusinessType: account.business_type || '',
        stripeConnectedAccountDisabledReason: requirements.disabled_reason || '',
        stripeConnectedAccountCurrentlyDue: requirements.currently_due || [],
        stripeConnectedAccountPastDue: requirements.past_due || [],
        stripeConnectedAccountEventuallyDue: requirements.eventually_due || [],
        stripeConnectedAccountPendingVerification: requirements.pending_verification || [],
        stripeConnectedAccountRequirementErrors: requirements.errors || [],
        stripeConnectedAccountCapabilities: {
            cardPayments: capabilities.card_payments || 'unknown',
            transfers: capabilities.transfers || 'unknown',
        },
        stripeConnectedAccountLastEventId: event?.id || '',
        stripeConnectedAccountLastEventType: event?.type || '',
        stripeConnectedAccountUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return true;
};

const syncExternalAccountSnapshot = async ({ externalAccount, connectedAccount, event }) => {
    const accountId = normalizeStripeAccountId(connectedAccount);
    if (!accountId) return false;

    const company = await findCompanyByConnectedAccountId(accountId);
    if (!company) return false;

    await company.ref.set({
        stripeConnectedAccountId: accountId,
        stripePayoutExternalAccountId: externalAccount.id || '',
        stripePayoutExternalAccountObject: externalAccount.object || '',
        stripePayoutExternalAccountBankName: externalAccount.bank_name || '',
        stripePayoutExternalAccountLast4: externalAccount.last4 || '',
        stripePayoutExternalAccountStatus: externalAccount.status || '',
        stripePayoutExternalAccountCurrency: externalAccount.currency || '',
        stripePayoutExternalAccountCountry: externalAccount.country || '',
        stripePayoutExternalAccountUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        stripeConnectedAccountLastEventId: event?.id || '',
        stripeConnectedAccountLastEventType: event?.type || '',
    }, { merge: true });

    return true;
};

const upsertStripePayout = async ({ payout, connectedAccount, event }) => {
    const accountId = normalizeStripeAccountId(connectedAccount);
    if (!accountId || !payout?.id) return false;

    const company = await findCompanyByConnectedAccountId(accountId);
    if (!company) return false;

    const payoutData = {
        id: payout.id,
        companyId: company.data.id,
        stripePayoutId: payout.id,
        stripeConnectedAccountId: accountId,
        amountCents: Number(payout.amount || 0),
        currency: String(payout.currency || 'usd').toLowerCase(),
        status: payout.status || '',
        method: payout.method || '',
        type: payout.type || '',
        description: payout.description || '',
        statementDescriptor: payout.statement_descriptor || '',
        automatic: Boolean(payout.automatic),
        arrivalDate: timestampFromStripeSeconds(payout.arrival_date),
        stripeCreatedAt: timestampFromStripeSeconds(payout.created),
        destinationId: typeof payout.destination === 'string' ? payout.destination : payout.destination?.id || '',
        failureCode: payout.failure_code || '',
        failureMessage: payout.failure_message || '',
        livemode: Boolean(payout.livemode),
        lastStripeEventId: event?.id || '',
        lastStripeEventType: event?.type || '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const batch = admin.firestore().batch();
    const companyPayoutRef = company.ref.collection(salesCollectionNames.payouts).doc(payout.id);
    const payoutRef = admin.firestore().collection(salesCollectionNames.payouts).doc(payout.id);

    batch.set(companyPayoutRef, payoutData, { merge: true });
    batch.set(payoutRef, payoutData, { merge: true });
    batch.set(company.ref, {
        stripeLastPayoutId: payout.id,
        stripeLastPayoutStatus: payout.status || '',
        stripeLastPayoutAmountCents: Number(payout.amount || 0),
        stripeLastPayoutCurrency: String(payout.currency || 'usd').toLowerCase(),
        stripeLastPayoutArrivalDate: timestampFromStripeSeconds(payout.arrival_date),
        stripeLastPayoutUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await batch.commit();
    return true;
};

const findSalesBillingSubscriptionByStripeId = async (stripeSubscriptionId) => {
    if (!stripeSubscriptionId) return null;

    const querySnapshot = await admin.firestore()
        .collection(salesCollectionNames.billingSubscriptions)
        .where('stripeSubscriptionId', '==', stripeSubscriptionId)
        .limit(1)
        .get();

    if (querySnapshot.empty) return null;

    const doc = querySnapshot.docs[0];
    return {
        ref: doc.ref,
        data: { id: doc.id, ...doc.data() },
    };
};

const updateSalesBillingSubscriptionFromStripe = async ({ subscription, connectedAccount, checkoutSession = null }) => {
    const metadata = subscription.metadata || checkoutSession?.metadata || {};
    const billingSubscriptionId = metadata.salesBillingSubscriptionId;
    const subscriptionRef = billingSubscriptionId
        ? admin.firestore().collection(salesCollectionNames.billingSubscriptions).doc(billingSubscriptionId)
        : (await findSalesBillingSubscriptionByStripeId(subscription.id))?.ref;

    if (!subscriptionRef) return false;

    const item = subscription.items?.data?.[0] || {};
    const stripeStatus = subscription.status || '';
    const status = mapStripeSubscriptionStatus(stripeStatus);
    const paymentMethodPolicy = salesPaymentMethodPolicy(
        metadata.paymentMethodType ||
        metadata.stripePaymentMethodType ||
        checkoutSession?.payment_method_types?.[0] ||
        ''
    );
    const applicationFeePercent = normalizeApplicationFeePercent(
        metadata.applicationFeePercent ||
        subscription.application_fee_percent
    );
    const autopayIsActive = ['active', 'trialing'].includes(stripeStatus);
    const stripeManagedBilling = ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(stripeStatus);
    const autopayStatus = autopayIsActive
        ? 'active'
        : status === 'pastDue'
            ? 'pastDue'
            : status === 'canceled'
                ? 'canceled'
                : 'checkoutStarted';
    const updateData = {
        stripeConnectedAccountId: connectedAccount || metadata.stripeConnectedAccountId || '',
        stripeCustomerId: subscription.customer || checkoutSession?.customer || '',
        stripeSubscriptionId: subscription.id,
        stripeSubscriptionItemId: item.id || '',
        stripePriceId: item.price?.id || '',
        stripeProductId: typeof item.price?.product === 'string' ? item.price.product : item.price?.product?.id || '',
        stripeLatestInvoiceId: typeof subscription.latest_invoice === 'string'
            ? subscription.latest_invoice
            : subscription.latest_invoice?.id || '',
        stripeDefaultPaymentMethodId: typeof subscription.default_payment_method === 'string'
            ? subscription.default_payment_method
            : subscription.default_payment_method?.id || '',
        paymentMethodType: paymentMethodPolicy.paymentMethodType,
        stripePaymentMethodType: paymentMethodPolicy.stripePaymentMethodType,
        stripePaymentMethodTypes: paymentMethodPolicy.stripePaymentMethodTypes,
        paymentMethodLabel: paymentMethodPolicy.paymentMethodLabel,
        applicationFeePercent,
        platformFeeSource: metadata.applicationFeeSource || '',
        stripeStatus,
        status,
        checkoutStatus: checkoutSession ? 'completed' : 'synced',
        nextAction: nextActionForStripeSubscriptionStatus(stripeStatus),
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
        lastBillingSource: 'stripeSubscriptionWebhook',
        customerCanPayImmediately: false,
        currentPeriodStart: timestampFromStripeSeconds(subscription.current_period_start),
        currentPeriodEnd: timestampFromStripeSeconds(subscription.current_period_end),
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        canceledAt: timestampFromStripeSeconds(subscription.canceled_at),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        stripeSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await subscriptionRef.set(updateData, { merge: true });

    const updatedSnap = await subscriptionRef.get();
    const updatedSubscription = { id: updatedSnap.id, ...updatedSnap.data() };
    const agreementId = updatedSubscription.agreementId || metadata.salesAgreementId;

    if (agreementId) {
        await admin.firestore().collection(salesCollectionNames.agreements).doc(agreementId).set({
            stripeCustomerId: updateData.stripeCustomerId,
            billingSubscriptionId: updatedSubscription.id,
            billingFlowStatus: updateData.status,
            billingFlowNextAction: updateData.nextAction,
            billingFlowUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            billingCollectionMethod: updateData.billingCollectionMethod,
            autopayStatus: updateData.autopayStatus,
            manualBillingEnabled: updateData.manualBillingEnabled,
            manualBillingAutoSendEnabled: updateData.manualBillingAutoSendEnabled,
            paymentMethodType: updateData.paymentMethodType,
            stripePaymentMethodType: updateData.stripePaymentMethodType,
            paymentMethodLabel: updateData.paymentMethodLabel,
            applicationFeePercent: updateData.applicationFeePercent,
            platformFeeSource: updateData.platformFeeSource,
            customerCanPayImmediately: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }

    return true;
};

const upsertSalesInvoiceAndPaymentFromStripeInvoice = async ({
    invoice,
    connectedAccount,
    eventType = '',
    eventId = '',
}) => {
    const stripeSubscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;

    const salesSubscription = await findSalesBillingSubscriptionByStripeId(stripeSubscriptionId);
    if (!salesSubscription) return false;

    const subscription = salesSubscription.data;
    const invoiceId = `sinv_${invoice.id}`;
    const paymentIntentId = typeof invoice.payment_intent === 'string'
        ? invoice.payment_intent
        : invoice.payment_intent?.id || '';
    const paymentId = `spay_${invoice.id}`;
    const failedPaymentId = `spay_failed_${invoice.id}_${paymentIntentId || 'latest'}`;
    const paymentEventId = `spe_${eventId || `${invoice.id}_${eventType || 'invoice'}`}`;
    const invoiceRef = admin.firestore().collection(salesCollectionNames.invoices).doc(invoiceId);
    const paymentRef = admin.firestore().collection(salesCollectionNames.payments).doc(paymentId);
    const failedPaymentRef = admin.firestore().collection(salesCollectionNames.payments).doc(failedPaymentId);
    const paymentEventRef = admin.firestore().collection(salesCollectionNames.paymentEvents).doc(paymentEventId);
    const batch = admin.firestore().batch();

    const amountDue = Number(invoice.amount_due || 0);
    const amountPaid = Number(invoice.amount_paid || 0);
    const amountRemaining = Number(invoice.amount_remaining || Math.max(amountDue - amountPaid, 0));
    const isPaid = invoice.status === 'paid' && amountPaid > 0;
    const isPaymentFailed = eventType === 'invoice.payment_failed';
    const currency = String(invoice.currency || subscription.currency || 'usd').toLowerCase();
    const receiptUrl = invoice.hosted_invoice_url || invoice.invoice_pdf || '';
    const receiptDeliveryMethod = 'stripeHostedInvoice';
    const paymentMethodPolicy = salesPaymentMethodPolicy(
        subscription.paymentMethodType ||
        subscription.stripePaymentMethodType ||
        invoice.payment_settings?.payment_method_types?.[0] ||
        ''
    );
    const basePaymentFields = {
        companyId: subscription.companyId || '',
        customerId: subscription.customerId || '',
        customerUserId: subscription.customerUserId || null,
        relationshipId: subscription.relationshipId || subscription.customerCompanyRelationshipId || '',
        customerCompanyRelationshipId: subscription.customerCompanyRelationshipId || subscription.relationshipId || '',
        customerName: subscription.customerName || '',
        email: subscription.email || '',
        invoiceId,
        billingSubscriptionId: subscription.id,
        agreementId: subscription.agreementId || '',
        currency,
        method: paymentMethodPolicy.salesPaymentMethod,
        paymentMethodType: paymentMethodPolicy.paymentMethodType,
        stripePaymentMethodType: paymentMethodPolicy.stripePaymentMethodType,
        paymentMethodLabel: paymentMethodPolicy.paymentMethodLabel,
        applicationFeePercent: subscription.applicationFeePercent ?? null,
        platformFeeSource: subscription.platformFeeSource || '',
        stripeConnectedAccountId: connectedAccount || subscription.stripeConnectedAccountId || '',
        stripeCustomerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || '',
        stripeSubscriptionId,
        stripeInvoiceId: invoice.id,
        stripePaymentIntentId: paymentIntentId,
        billingCollectionMethod: 'automaticStripe',
        receiptDeliveryMethod,
        receiptsEnabled: true,
        receiptUrl,
        receiptEmail: invoice.customer_email || subscription.email || '',
        referenceNumber: invoice.number || invoice.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const invoiceUpdate = {
        id: invoiceId,
        companyId: subscription.companyId || '',
        customerId: subscription.customerId || '',
        customerUserId: subscription.customerUserId || null,
        relationshipId: subscription.relationshipId || subscription.customerCompanyRelationshipId || '',
        customerCompanyRelationshipId: subscription.customerCompanyRelationshipId || subscription.relationshipId || '',
        customerName: subscription.customerName || '',
        email: subscription.email || '',
        billingSubscriptionId: subscription.id,
        agreementId: subscription.agreementId || '',
        type: 'subscription',
        status: mapStripeInvoiceStatus(invoice.status),
        deliveryMethod: receiptDeliveryMethod,
        billingCollectionMethod: 'automaticStripe',
        receiptDeliveryMethod,
        receiptsEnabled: true,
        currency,
        paymentMethodType: paymentMethodPolicy.paymentMethodType,
        stripePaymentMethodType: paymentMethodPolicy.stripePaymentMethodType,
        paymentMethodLabel: paymentMethodPolicy.paymentMethodLabel,
        applicationFeePercent: subscription.applicationFeePercent ?? null,
        platformFeeSource: subscription.platformFeeSource || '',
        amountDueCents: amountRemaining,
        amountPaidCents: amountPaid,
        balanceCents: amountRemaining,
        stripeAmountDueCents: amountDue,
        subtotalAmountCents: Number(invoice.subtotal || 0),
        taxAmountCents: Number(invoice.tax || 0),
        totalAmountCents: Number(invoice.total || amountDue || 0),
        dueDate: timestampFromStripeSeconds(invoice.due_date),
        issuedAt: timestampFromStripeSeconds(invoice.created),
        paidAt: invoice.status_transitions?.paid_at
            ? timestampFromStripeSeconds(invoice.status_transitions.paid_at)
            : null,
        stripeConnectedAccountId: connectedAccount || subscription.stripeConnectedAccountId || '',
        stripeCustomerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || '',
        stripeSubscriptionId,
        stripeInvoiceId: invoice.id,
        stripePaymentIntentId: paymentIntentId,
        stripeHostedInvoiceUrl: invoice.hosted_invoice_url || '',
        stripeInvoicePdfUrl: invoice.invoice_pdf || '',
        receiptUrl,
        receiptEmail: invoice.customer_email || subscription.email || '',
        lastStripeEventType: eventType,
        lastStripeEventId: eventId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (isPaymentFailed) {
        invoiceUpdate.paymentFailedAt = admin.firestore.FieldValue.serverTimestamp();
    }

    batch.set(invoiceRef, invoiceUpdate, { merge: true });

    if (isPaid) {
        batch.set(paymentRef, {
            id: paymentId,
            ...basePaymentFields,
            amountCents: amountPaid,
            status: 'posted',
            receivedAt: invoice.status_transitions?.paid_at
                ? timestampFromStripeSeconds(invoice.status_transitions.paid_at)
                : admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }

    if (isPaymentFailed) {
        batch.set(failedPaymentRef, {
            id: failedPaymentId,
            ...basePaymentFields,
            amountCents: amountRemaining || amountDue,
            status: 'failed',
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }

    batch.set(paymentEventRef, {
        id: paymentEventId,
        companyId: subscription.companyId || '',
        customerId: subscription.customerId || '',
        customerUserId: subscription.customerUserId || null,
        relationshipId: subscription.relationshipId || subscription.customerCompanyRelationshipId || '',
        customerCompanyRelationshipId: subscription.customerCompanyRelationshipId || subscription.relationshipId || '',
        customerName: subscription.customerName || '',
        email: subscription.email || '',
        invoiceId,
        billingSubscriptionId: subscription.id,
        agreementId: subscription.agreementId || '',
        type: eventType || 'invoice.updated',
        status: isPaymentFailed ? 'failed' : isPaid ? 'posted' : mapStripeInvoiceStatus(invoice.status),
        amountCents: isPaid ? amountPaid : amountRemaining || amountDue,
        currency,
        method: paymentMethodPolicy.salesPaymentMethod,
        paymentMethodType: paymentMethodPolicy.paymentMethodType,
        stripePaymentMethodType: paymentMethodPolicy.stripePaymentMethodType,
        paymentMethodLabel: paymentMethodPolicy.paymentMethodLabel,
        applicationFeePercent: subscription.applicationFeePercent ?? null,
        platformFeeSource: subscription.platformFeeSource || '',
        stripeConnectedAccountId: connectedAccount || subscription.stripeConnectedAccountId || '',
        stripeCustomerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || '',
        stripeSubscriptionId,
        stripeInvoiceId: invoice.id,
        stripePaymentIntentId: paymentIntentId,
        stripeEventId: eventId,
        billingCollectionMethod: 'automaticStripe',
        receiptDeliveryMethod,
        receiptUrl,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const subscriptionUpdate = {
        stripeLatestInvoiceId: invoice.id,
        status: salesSubscription.data.status || 'pendingStripe',
        stripeStatus: salesSubscription.data.stripeStatus || '',
        nextAction: salesSubscription.data.nextAction || 'reviewStripeStatus',
        lastPaymentStatus: isPaymentFailed ? 'failed' : isPaid ? 'posted' : mapStripeInvoiceStatus(invoice.status),
        lastPaymentEventId: paymentEventId,
        lastBillingSource: 'stripeInvoiceWebhook',
        lastStripeInvoiceSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastReceiptUrl: receiptUrl,
        receiptDeliveryMethod,
        receiptsEnabled: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        stripeSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (isPaid) {
        subscriptionUpdate.status = 'active';
        subscriptionUpdate.stripeStatus = 'active';
        subscriptionUpdate.nextAction = 'monitorBilling';
        subscriptionUpdate.billingCollectionMethod = 'automaticStripe';
        subscriptionUpdate.autopayStatus = 'active';
        subscriptionUpdate.autopayEnabled = true;
        subscriptionUpdate.manualBillingEnabled = false;
        subscriptionUpdate.manualBillingAutoSendEnabled = false;
        subscriptionUpdate.manualBillingStatus = 'disabledAutopayActive';
        subscriptionUpdate.manualBillingReason = 'stripeAutopayActive';
        subscriptionUpdate.lastPaymentAt = admin.firestore.FieldValue.serverTimestamp();
        subscriptionUpdate.lastPaymentFailedAt = null;

        if (!subscription.operationsSetupStatus) {
            subscriptionUpdate.operationsSetupStatus = 'needsRecurringServiceStop';
            subscriptionUpdate.operationsSetupReason = 'paidBillingSubscription';
            subscriptionUpdate.operationsSetupUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
        }
    }

    if (isPaymentFailed) {
        subscriptionUpdate.status = 'pastDue';
        subscriptionUpdate.stripeStatus = 'past_due';
        subscriptionUpdate.nextAction = 'collectPaymentMethod';
        subscriptionUpdate.billingCollectionMethod = 'automaticStripe';
        subscriptionUpdate.autopayStatus = 'pastDue';
        subscriptionUpdate.autopayEnabled = false;
        subscriptionUpdate.manualBillingEnabled = false;
        subscriptionUpdate.manualBillingAutoSendEnabled = false;
        subscriptionUpdate.manualBillingStatus = 'disabledStripeBillingActive';
        subscriptionUpdate.manualBillingReason = 'stripePaymentFailed';
        subscriptionUpdate.lastPaymentFailedAt = admin.firestore.FieldValue.serverTimestamp();
        subscriptionUpdate.lastPaymentFailedInvoiceId = invoice.id;
    }

    batch.set(salesSubscription.ref, subscriptionUpdate, { merge: true });

    if (subscription.agreementId) {
        const agreementUpdate = {
            billingSubscriptionId: subscription.id,
            billingFlowStatus: subscriptionUpdate.status,
            billingFlowNextAction: subscriptionUpdate.nextAction,
            billingFlowUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            billingCollectionMethod: subscriptionUpdate.billingCollectionMethod || subscription.billingCollectionMethod || 'automaticStripe',
            autopayStatus: subscriptionUpdate.autopayStatus || subscription.autopayStatus || '',
            manualBillingEnabled: subscriptionUpdate.manualBillingEnabled !== undefined
                ? subscriptionUpdate.manualBillingEnabled
                : subscription.manualBillingEnabled !== false,
            manualBillingAutoSendEnabled: subscriptionUpdate.manualBillingAutoSendEnabled !== undefined
                ? subscriptionUpdate.manualBillingAutoSendEnabled
                : subscription.manualBillingAutoSendEnabled === true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (subscriptionUpdate.operationsSetupStatus) {
            agreementUpdate.operationsSetupStatus = subscriptionUpdate.operationsSetupStatus;
            agreementUpdate.operationsSetupReason = subscriptionUpdate.operationsSetupReason;
            agreementUpdate.operationsSetupUpdatedAt = subscriptionUpdate.operationsSetupUpdatedAt;
        }

        batch.set(admin.firestore().collection(salesCollectionNames.agreements).doc(subscription.agreementId), agreementUpdate, { merge: true });
    }

    await batch.commit();
    return true;
};

// This is now a v2 function, which aligns with the project and resolves deployment conflicts.
exports.stripeWebHook = onRequest(async (request, response) => {
    const sig = request.headers["stripe-signature"];

    let event;

    try {          
        // The rawBody is available in v2 functions and is required for signature verification.
        event = constructStripeWebhookEvent(request.rawBody, sig);
    } catch (err) {
        console.error('Webhook signature verification failed!', err.message);
        response.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    if (event.type === 'account.updated') {
        try {
            const account = event.data.object;
            const handledAccountUpdate = await syncConnectedAccountSnapshot({
                account,
                connectedAccount: event.account || account.id,
                event,
            });

            response.status(200).send(handledAccountUpdate ? 'Connected account synchronized.' : 'Connected account not linked in Firestore.');
            return;
        } catch (accountError) {
            console.error('Database update failed for connected account webhook:', accountError);
            response.status(500).send(`Internal Server Error: ${accountError.message}`);
            return;
        }
    }

    if (event.type === 'account.external_account.updated') {
        try {
            const externalAccount = event.data.object;
            const handledExternalAccountUpdate = await syncExternalAccountSnapshot({
                externalAccount,
                connectedAccount: event.account,
                event,
            });

            response.status(200).send(handledExternalAccountUpdate ? 'Connected account external payout account synchronized.' : 'Connected account not linked in Firestore.');
            return;
        } catch (externalAccountError) {
            console.error('Database update failed for connected external account webhook:', externalAccountError);
            response.status(500).send(`Internal Server Error: ${externalAccountError.message}`);
            return;
        }
    }

    if (['payout.created', 'payout.updated', 'payout.paid', 'payout.failed', 'payout.canceled'].includes(event.type)) {
        try {
            const payout = event.data.object;
            const handledPayout = await upsertStripePayout({
                payout,
                connectedAccount: event.account,
                event,
            });

            response.status(200).send(handledPayout ? 'Payout synchronized.' : 'Payout connected account not linked in Firestore.');
            return;
        } catch (payoutError) {
            console.error('Database update failed for payout webhook:', payoutError);
            response.status(500).send(`Internal Server Error: ${payoutError.message}`);
            return;
        }
    }

    // Handle the 'checkout.session.completed' event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const isSalesCheckout = session.metadata?.flow === 'sales_billing_subscription' || Boolean(session.metadata?.salesBillingSubscriptionId);

        if (isSalesCheckout) {
            try {
                const connectedAccount = event.account || session.metadata?.stripeConnectedAccountId;
                const subscription = await stripe.subscriptions.retrieve(
                    session.subscription,
                    {},
                    connectedAccount ? { stripeAccount: connectedAccount } : undefined
                );

                await updateSalesBillingSubscriptionFromStripe({
                    subscription,
                    connectedAccount,
                    checkoutSession: session,
                });

                response.status(200).send('Sales checkout synchronized.');
                return;
            } catch (salesError) {
                console.error('Database update failed after receiving sales checkout webhook:', salesError);
                response.status(500).send(`Internal Server Error: ${salesError.message}`);
                return;
            }
        }

        const { userId, companyId } = session.metadata;
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        if (!userId || !companyId) {
            console.error('Webhook received checkout.session.completed without required metadata.');
            response.status(400).send('Missing metadata.');
            return;
        }

        try {
            // Update the subscription with the metadata from the checkout session
            await stripe.subscriptions.update(subscriptionId, { metadata: { userId, companyId } });

            const subscription = await stripe.subscriptions.retrieve(subscriptionId);

            const product = await admin.firestore().collection('subscriptions').where('stripeProductId', '==', subscription.items.data[0].price.product).get();
            if (product.empty) {
                 throw new Error(`No product found with stripeProductId: ${subscription.items.data[0].price.product}`);
            }
            const productData = product.docs[0].data();

            const newSubId = `com_s_${uuidv4()}`;
            const subscriptionRef = admin.firestore().collection('companies').doc(companyId).collection('subscriptions').doc(newSubId);

            await subscriptionRef.set({
                id: newSubId,
                dripDropSubscriptionId: product.docs[0].id,
                name: productData.name,
                description: productData.description,
                price: productData.price,
                stripePriceId: subscription.items.data[0].price.id,
                stripeProductId: subscription.items.data[0].price.product,
                stripeSubscriptionId: subscription.id,
                stripeCustomerId: customerId,
                userId: userId,
                status: subscription.status,
                started: admin.firestore.Timestamp.fromMillis(subscription.created * 1000),
                currentPeriodStart: admin.firestore.Timestamp.fromMillis(subscription.current_period_start * 1000),
                currentPeriodEnd: admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000),
                lastPaid: admin.firestore.Timestamp.now(),
            });

            console.log(`Successfully created subscription ${newSubId} for company ${companyId}.`);

        } catch (dbError) {
            console.error('Database update failed after receiving webhook:', dbError);
            response.status(500).send(`Internal Server Error: ${dbError.message}`);
            return;
        }
    }

    // Handle the 'customer.subscription.updated' event
    if (event.type === 'customer.subscription.updated') {
        const subscription = event.data.object;
        const salesUpdated = await updateSalesBillingSubscriptionFromStripe({
            subscription,
            connectedAccount: event.account || subscription.metadata?.stripeConnectedAccountId || '',
        });

        if (salesUpdated) {
            response.status(200).send('Sales subscription updated.');
            return;
        }

        const stripeSubscriptionId = subscription.id;
        const { companyId } = subscription.metadata;

        try {
            const companySubscriptionsRef = admin.firestore().collection('companies').doc(companyId).collection('subscriptions').where('stripeSubscriptionId', '==', stripeSubscriptionId);
            const querySnapshot = await companySubscriptionsRef.get();

            if (querySnapshot.empty) {
                console.warn(`Webhook received for a subscription not found in the database: ${stripeSubscriptionId}`);
                response.status(200).send('Subscription not found in DB, but webhook acknowledged.');
                return;
            }

            const newStripeProductId = subscription.items.data[0].price.product;
            const productQuery = await admin.firestore().collection('subscriptions').where('stripeProductId', '==', newStripeProductId).get();

            if (productQuery.empty) {
                console.error(`Webhook received for an unknown product: ${newStripeProductId}. Cannot update subscription details.`);
                 // Even if the product is unknown, we should still update the status.
            } 
            
            const productData = productQuery.docs[0]?.data() || {};

            const updateData = {
                // Update fields from our product template if available
                ...(productData.name && { name: productData.name }),
                ...(productData.description && { description: productData.description }),
                ...(productData.price && { price: productData.price }),
                ...(productQuery.docs[0]?.id && { dripDropSubscriptionId: productQuery.docs[0].id }),
                
                // Update stripe-specific fields
                stripePriceId: subscription.items.data[0].price.id,
                stripeProductId: newStripeProductId,
                
                // Update period info from the webhook payload
                // current_period_start: admin.firestore.Timestamp.fromMillis(subscription.current_period_start * 1000),
                // current_period_end: admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000),
                status: subscription.status, // Default to the status from Stripe
                // cancel_at: subscription.cancel_at ? admin.firestore.Timestamp.fromMillis(subscription.cancel_at * 1000) : null,
            };
            console.log('Updated Data ',updateData)
            // Handle the specific 'pending_cancellation' status
            if (subscription.cancel_at_period_end) {
                updateData.status = 'pending_cancellation';
            }

            const updates = querySnapshot.docs.map(doc => doc.ref.update(updateData));
            await Promise.all(updates);

            console.log(`Successfully updated subscription(s) with Stripe ID ${stripeSubscriptionId}.`);

        } catch (dbError) {
            console.error('Database update failed for subscription update:', dbError);
            response.status(500).send(`Internal Server Error: ${dbError.message}`);
            return;
        }
    }

    // Handle the 'customer.subscription.deleted' event
    if (event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object;
        const salesUpdated = await updateSalesBillingSubscriptionFromStripe({
            subscription,
            connectedAccount: event.account || subscription.metadata?.stripeConnectedAccountId || '',
        });

        if (salesUpdated) {
            response.status(200).send('Sales subscription canceled.');
            return;
        }

        const stripeSubscriptionId = subscription.id;
        const { companyId } = subscription.metadata;

        try {
            // Find the subscription in your database using the companyId from the metadata
            const companySubscriptionsRef = admin.firestore().collection('companies').doc(companyId).collection('subscriptions').where('stripeSubscriptionId', '==', stripeSubscriptionId);
            const querySnapshot = await companySubscriptionsRef.get();

            if (querySnapshot.empty) {
                console.warn(`Webhook received for a subscription not found in the database: ${stripeSubscriptionId}`);
                response.status(200).send('Subscription not found in DB, but webhook acknowledged.');
                return;
            }

            // Update the status of the found subscription(s)
            const updates = querySnapshot.docs.map(doc => doc.ref.update({ status: 'canceled' }));
            await Promise.all(updates);

            console.log(`Successfully marked subscription(s) with Stripe ID ${stripeSubscriptionId} as canceled.`);

        } catch (dbError) {
            console.error('Database update failed for subscription cancellation:', dbError);
            response.status(500).send(`Internal Server Error: ${dbError.message}`);
            return;
        }
    }

    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed' || event.type === 'invoice.finalized') {
        try {
            const invoice = event.data.object;
            const handledSalesInvoice = await upsertSalesInvoiceAndPaymentFromStripeInvoice({
                invoice,
                connectedAccount: event.account || '',
                eventType: event.type,
                eventId: event.id,
            });

            if (handledSalesInvoice) {
                response.status(200).send('Sales invoice synchronized.');
                return;
            }
        } catch (invoiceError) {
            console.error('Database update failed for sales invoice webhook:', invoiceError);
            response.status(500).send(`Internal Server Error: ${invoiceError.message}`);
            return;
        }
    }

    // Send a 200 response to acknowledge receipt of the event
    response.status(200).send();
});
