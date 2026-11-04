import { httpsCallable } from 'firebase/functions';
import { functions } from '../config';
import { billingPeriod } from './billingCalendar';
import { manageSalesInvoice } from './invoiceCommands';

export const invoiceBalanceCents = (invoice = {}) => {
  if (invoice.amountDueCents !== undefined && invoice.amountDueCents !== null) return Number(invoice.amountDueCents) || 0;

  const total = Number(invoice.totalAmountCents || invoice.totalCents) || 0;
  const paid = Number(invoice.amountPaidCents) || 0;
  const writtenOff = Number(invoice.writeOffAmountCents) || 0;

  return Math.max(total - paid - writtenOff - Number(invoice.refundCreditCents || 0) - Number(invoice.creditAmountCents || 0), 0);
};

export const getSubscriptionBillingPeriodPreview = (subscription = {}) => billingPeriod(subscription);

export const createManualSubscriptionInvoice = async (_db, subscription = {}, options = {}) => {
  const period = getSubscriptionBillingPeriodPreview(subscription);
  const response = await httpsCallable(functions, 'createManualSalesSubscriptionInvoice')({
    companyId: subscription.companyId, billingSubscriptionId: subscription.id,
    expectedPeriodStartMillis: (() => {
      const value=subscription.manualBillingNextPeriodStart||subscription.currentPeriodStart||subscription.agreementSnapshot?.acceptedAt||subscription.createdAt;
      return value?.toMillis?.() ?? value?.getTime?.() ?? (typeof value==='number'?value:Date.parse(value));
    })(), memo: options.memo || '',
  });
  return {...response.data, period};
};

export const recordManualSalesPayment = async (_db, invoiceId, payment = {}, options = {}) => {
  if (!invoiceId || !options.companyId || !options.requestId) throw new Error('An invoice, company, and saved receipt request are required.');
  return manageSalesInvoice({
    action: 'recordPayment', invoiceId, companyId: options.companyId, requestId: options.requestId,
    payment: { amountCents: payment.amountCents, method: payment.method, referenceNumber: payment.referenceNumber || '',
      memo: payment.memo || '', receivedAtMillis: payment.receivedAtMillis },
  });
};
