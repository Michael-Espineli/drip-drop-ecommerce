import {
  Timestamp,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import {
  SalesAutopayStatus,
  SalesBillingCollectionMethod,
  SalesInvoiceDeliveryMethod,
  SalesInvoiceStatus,
  SalesInvoiceType,
  SalesPaymentStatus,
  salesCollectionNames,
} from '../models/Sales';

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const toDate = (value, fallback = new Date()) => {
  const millis = toMillis(value);
  return millis ? new Date(millis) : new Date(fallback);
};

const startOfDay = (value) => {
  const date = toDate(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const toTimestamp = (value) => Timestamp.fromDate(startOfDay(value));

const dateKey = (value) => startOfDay(value).toISOString().slice(0, 10).replace(/-/g, '');

const addInterval = (value, interval = 'month', intervalCount = 1) => {
  const date = startOfDay(value);
  const count = Math.max(Number(intervalCount || 1), 1);
  const key = normalizeStatus(interval);

  if (key.includes('day')) date.setDate(date.getDate() + count);
  else if (key.includes('week')) date.setDate(date.getDate() + (count * 7));
  else if (key.includes('year')) date.setFullYear(date.getFullYear() + count);
  else date.setMonth(date.getMonth() + count);

  return date;
};

const addIntervalDateTime = (value, interval = 'month', intervalCount = 1) => {
  const date = toDate(value);
  const count = Math.max(Number(intervalCount || 1), 1);
  const key = normalizeStatus(interval);

  if (key.includes('day')) date.setDate(date.getDate() + count);
  else if (key.includes('week')) date.setDate(date.getDate() + (count * 7));
  else if (key.includes('year')) date.setFullYear(date.getFullYear() + count);
  else date.setMonth(date.getMonth() + count);

  return date;
};

const paymentTermsDueDays = (paymentTerms = '') => {
  const key = normalizeStatus(paymentTerms);
  if (key === 'net7') return 7;
  if (key === 'net14') return 14;
  if (key === 'net30') return 30;
  return 0;
};

const dueDateForTerms = (paymentTerms, baseDate = new Date()) => {
  const date = startOfDay(baseDate);
  date.setDate(date.getDate() + paymentTermsDueDays(paymentTerms));
  return date;
};

const copySubscriptionLineItems = (subscription = {}) => {
  const sourceItems = Array.isArray(subscription.lineItems) ? subscription.lineItems : [];
  const lineItems = sourceItems
    .map((item) => {
      const quantity = Math.max(Number(item.quantity || 1), 0);
      const unitAmountCents = Number(item.unitAmountCents || 0);
      const totalAmountCents = Number(item.totalAmountCents || Math.round(unitAmountCents * quantity));

      return {
        id: item.id || item.catalogItemId || `sili_${uuidv4()}`,
        catalogItemId: item.catalogItemId || '',
        sourceType: item.sourceType || 'recurringService',
        sourceId: item.sourceId || item.catalogItemId || '',
        name: item.name || item.description || 'Recurring service',
        description: item.description || '',
        quantity,
        unitAmountCents,
        totalAmountCents,
        taxable: Boolean(item.taxable),
        type: item.type || 'recurringService',
        stripeProductId: item.stripeProductId || '',
        stripePriceId: item.stripePriceId || '',
        metadata: item.metadata || {},
      };
    })
    .filter((item) => item.name && item.quantity > 0);

  if (lineItems.length) return lineItems;

  const amountCents = Number(subscription.amountCents || 0);
  return amountCents > 0
    ? [{
      id: `sili_${uuidv4()}`,
      catalogItemId: '',
      sourceType: 'recurringService',
      sourceId: subscription.agreementId || subscription.id || '',
      name: subscription.agreementSnapshot?.title || 'Recurring service',
      description: subscription.serviceCadence || subscription.rateType || '',
      quantity: 1,
      unitAmountCents: amountCents,
      totalAmountCents: amountCents,
      taxable: false,
      type: 'recurringService',
      stripeProductId: '',
      stripePriceId: '',
      metadata: {},
    }]
    : [];
};

export const invoiceBalanceCents = (invoice = {}) => {
  if (invoice.amountDueCents !== undefined && invoice.amountDueCents !== null) return Number(invoice.amountDueCents) || 0;

  const total = Number(invoice.totalAmountCents || invoice.totalCents) || 0;
  const paid = Number(invoice.amountPaidCents) || 0;
  const writtenOff = Number(invoice.writeOffAmountCents) || 0;

  return Math.max(total - paid - writtenOff, 0);
};

export const getSubscriptionBillingPeriodPreview = (subscription = {}) => {
  const fallbackStart =
    subscription.currentPeriodStart ||
    subscription.agreementSnapshot?.acceptedAt ||
    subscription.createdAt ||
    new Date();
  const invoiceSendAt = toDate(
    subscription.manualBillingNextInvoiceAt ||
    subscription.manualBillingNextPeriodStart ||
    fallbackStart
  );
  const start = startOfDay(
    subscription.manualBillingNextPeriodStart ||
    fallbackStart
  );
  const interval = subscription.interval || 'month';
  const intervalCount = Math.max(Number(subscription.intervalCount || 1), 1);
  const existingEndMillis = toMillis(subscription.manualBillingNextPeriodEnd || subscription.currentPeriodEnd);
  const end = existingEndMillis > start.getTime()
    ? startOfDay(subscription.manualBillingNextPeriodEnd || subscription.currentPeriodEnd)
    : addInterval(start, interval, intervalCount);

  return {
    invoiceSendAt,
    periodStart: start,
    periodEnd: end,
    nextPeriodStart: end,
    nextPeriodEnd: addInterval(end, interval, intervalCount),
    nextInvoiceAt: addIntervalDateTime(invoiceSendAt, interval, intervalCount),
    dueDate: dueDateForTerms(subscription.paymentTerms, invoiceSendAt),
    invoiceId: `si_${subscription.id}_${dateKey(start)}`,
    invoiceNumber: `REC-${dateKey(start)}-${String(subscription.id || '').slice(-6).toUpperCase()}`,
  };
};

export const createManualSubscriptionInvoice = async (db, subscription = {}, options = {}) => {
  if (!subscription?.id) throw new Error('Missing billing subscription id.');
  if (!subscription.companyId) throw new Error('Billing subscription is missing a company id.');
  if (!subscription.customerId) throw new Error('Billing subscription is missing a customer.');
  if (
    subscription.manualBillingEnabled === false ||
    subscription.billingCollectionMethod === SalesBillingCollectionMethod.automaticStripe
  ) {
    throw new Error('Manual recurring invoices are disabled while this subscription is handled by automatic billing.');
  }

  const period = getSubscriptionBillingPeriodPreview(subscription);
  const lineItems = copySubscriptionLineItems(subscription);
  const subtotalAmountCents = lineItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);
  const totalAmountCents = subtotalAmountCents;
  const billingCollectionMethod = subscription.billingCollectionMethod || SalesBillingCollectionMethod.manualUntilAutopay;
  const receiptDeliveryMethod = subscription.receiptDeliveryMethod || subscription.invoiceDeliveryMethod || SalesInvoiceDeliveryMethod.email;
  const receiptsEnabled = subscription.receiptsEnabled !== false;

  if (totalAmountCents <= 0 || !lineItems.length) {
    throw new Error('Billing subscription needs an amount or line items before an invoice can be created.');
  }

  const invoiceRef = doc(db, salesCollectionNames.invoices, period.invoiceId);
  const subscriptionRef = doc(db, salesCollectionNames.billingSubscriptions, subscription.id);

  let created = false;

  await runTransaction(db, async (transaction) => {
    const invoiceSnap = await transaction.get(invoiceRef);
    if (invoiceSnap.exists()) return;

    created = true;
    const now = serverTimestamp();

    transaction.set(invoiceRef, {
      id: period.invoiceId,
      companyId: subscription.companyId,
      companyName: subscription.companyName || options.companyName || '',
      customerId: subscription.customerId || '',
      customerUserId: subscription.customerUserId || null,
      relationshipId: subscription.relationshipId || subscription.customerCompanyRelationshipId || '',
      customerCompanyRelationshipId: subscription.customerCompanyRelationshipId || subscription.relationshipId || '',
      customerName: subscription.customerName || '',
      email: subscription.email || '',
      serviceLocationIds: Array.isArray(subscription.serviceLocationIds) ? subscription.serviceLocationIds : [],
      serviceLocationSnapshots: Array.isArray(subscription.serviceLocationSnapshots) ? subscription.serviceLocationSnapshots : [],
      agreementId: subscription.agreementId || '',
      jobId: '',
      billingProfileId: subscription.billingProfileId || '',
      billingSubscriptionId: subscription.id,
      stripeConnectedAccountId: subscription.stripeConnectedAccountId || options.stripeConnectedAccountId || '',
      invoiceNumber: period.invoiceNumber,
      type: SalesInvoiceType.subscription,
      sourceType: 'manualBillingSubscription',
      status: SalesInvoiceStatus.open,
      deliveryMethod: subscription.invoiceDeliveryMethod || SalesInvoiceDeliveryMethod.email,
      billingCollectionMethod,
      autopayStatus: subscription.autopayStatus || (
        subscription.stripeConnectedAccountId ? SalesAutopayStatus.available : SalesAutopayStatus.unavailable
      ),
      receiptDeliveryMethod,
      receiptsEnabled,
      currency: subscription.currency || 'usd',
      billingPeriodStart: toTimestamp(period.periodStart),
      billingPeriodEnd: toTimestamp(period.periodEnd),
      dueDate: toTimestamp(period.dueDate),
      subtotalAmountCents,
      discountAmountCents: 0,
      taxAmountCents: 0,
      totalAmountCents,
      amountPaidCents: 0,
      amountDueCents: totalAmountCents,
      writeOffAmountCents: 0,
      memo: options.memo || subscription.manualInvoiceMemo || '',
      lineItems,
      recurringManualInvoice: true,
      manualBilling: {
        generatedFromSubscriptionId: subscription.id,
        periodStartKey: dateKey(period.periodStart),
        interval: subscription.interval || 'month',
        intervalCount: Math.max(Number(subscription.intervalCount || 1), 1),
      },
      createdByUserId: options.userId || '',
      createdAt: now,
      updatedAt: now,
    });

    transaction.set(subscriptionRef, {
      manualBillingLastInvoiceId: period.invoiceId,
      manualBillingLastInvoiceNumber: period.invoiceNumber,
      manualBillingLastInvoiceAt: now,
      manualBillingLastPeriodStart: toTimestamp(period.periodStart),
      manualBillingLastPeriodEnd: toTimestamp(period.periodEnd),
      manualBillingNextPeriodStart: toTimestamp(period.nextPeriodStart),
      manualBillingNextPeriodEnd: toTimestamp(period.nextPeriodEnd),
      manualBillingNextInvoiceAt: Timestamp.fromDate(period.nextInvoiceAt),
      manualBillingNextDueDate: toTimestamp(dueDateForTerms(subscription.paymentTerms, period.nextInvoiceAt)),
      billingCollectionMethod,
      manualBillingEnabled: true,
      manualBillingStatus: 'invoiceCreated',
      manualBillingReason: subscription.manualBillingReason || 'manualRecurringInvoice',
      manualBillingUpdatedAt: now,
      receiptDeliveryMethod,
      receiptsEnabled,
      lastBillingSource: 'manualRecurringInvoice',
      updatedAt: now,
    }, { merge: true });
  });

  return {
    invoiceId: period.invoiceId,
    invoiceNumber: period.invoiceNumber,
    created,
    period,
  };
};

export const recordManualSalesPayment = async (db, invoiceId, payment = {}, options = {}) => {
  if (!invoiceId) throw new Error('Missing invoice id.');

  const invoiceRef = doc(db, salesCollectionNames.invoices, invoiceId);
  const paymentId = `sp_${uuidv4()}`;
  const paymentRef = doc(db, salesCollectionNames.payments, paymentId);

  let result = null;

  await runTransaction(db, async (transaction) => {
    const invoiceSnap = await transaction.get(invoiceRef);
    if (!invoiceSnap.exists()) throw new Error('Invoice no longer exists.');

    const invoice = { id: invoiceSnap.id, ...invoiceSnap.data() };
    const balanceCents = invoiceBalanceCents(invoice);
    const amountCents = Number(payment.amountCents || balanceCents);

    if (amountCents <= 0) throw new Error('Payment amount must be greater than zero.');
    if (['paid', 'void', 'uncollectible'].includes(normalizeStatus(invoice.status)) && balanceCents <= 0) {
      throw new Error('This invoice is already closed.');
    }

    const previousPaidCents = Number(invoice.amountPaidCents || 0);
    const totalAmountCents = Number(invoice.totalAmountCents || 0);
    const writeOffAmountCents = Number(invoice.writeOffAmountCents || 0);
    const nextPaidCents = previousPaidCents + amountCents;
    const nextDueCents = Math.max(totalAmountCents - nextPaidCents - writeOffAmountCents, 0);
    const isPaid = nextDueCents <= 0;
    const now = serverTimestamp();

    transaction.set(paymentRef, {
      id: paymentId,
      companyId: invoice.companyId || options.companyId || '',
      customerId: invoice.customerId || '',
      customerUserId: invoice.customerUserId || null,
      relationshipId: invoice.relationshipId || invoice.customerCompanyRelationshipId || '',
      customerCompanyRelationshipId: invoice.customerCompanyRelationshipId || invoice.relationshipId || '',
      customerName: invoice.customerName || '',
      email: invoice.email || '',
      invoiceId: invoice.id,
      agreementId: invoice.agreementId || '',
      jobId: invoice.jobId || '',
      billingProfileId: invoice.billingProfileId || '',
      billingSubscriptionId: invoice.billingSubscriptionId || '',
      stripeConnectedAccountId: options.stripeConnectedAccountId || invoice.stripeConnectedAccountId || '',
      billingCollectionMethod: invoice.billingCollectionMethod || SalesBillingCollectionMethod.manualUntilAutopay,
      method: payment.method || 'cash',
      status: SalesPaymentStatus.posted,
      amountCents,
      currency: invoice.currency || 'usd',
      receiptDeliveryMethod: invoice.receiptDeliveryMethod || invoice.deliveryMethod || SalesInvoiceDeliveryMethod.email,
      receiptsEnabled: invoice.receiptsEnabled !== false,
      receiptUrl: String(payment.receiptUrl || '').trim(),
      referenceNumber: String(payment.referenceNumber || '').trim(),
      memo: String(payment.memo || '').trim(),
      recordedByUserId: options.userId || '',
      receivedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    transaction.update(invoiceRef, {
      amountPaidCents: nextPaidCents,
      amountDueCents: nextDueCents,
      status: isPaid ? SalesInvoiceStatus.paid : SalesInvoiceStatus.partiallyPaid,
      paidAt: isPaid ? now : invoice.paidAt || null,
      lastPaymentAt: now,
      lastPaymentId: paymentId,
      lastPaymentMemo: String(payment.memo || '').trim(),
      updatedAt: now,
      updatedByUserId: options.userId || '',
    });

    result = {
      paymentId,
      amountCents,
      invoiceId: invoice.id,
      status: isPaid ? SalesInvoiceStatus.paid : SalesInvoiceStatus.partiallyPaid,
      amountDueCents: nextDueCents,
    };
  });

  return result;
};
