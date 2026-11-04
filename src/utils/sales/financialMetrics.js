const key=value=>String(value||'').replace(/[^a-z0-9]/gi,'').toLowerCase();

export const netPaymentCents = (payment={}) => {
  if(['pending','processing','failed','void'].includes(key(payment.status)))return 0;
  const gross=Number(payment.amountCents)||0;
  if(key(payment.status)==='refunded'&&payment.refundedAmountCents==null)return 0;
  if(['reversed','disputed'].includes(key(payment.status))&&payment.reversedAmountCents==null)return 0;
  return Math.max(0,gross-(Number(payment.refundedAmountCents)||0)-(Number(payment.reversedAmountCents)||0));
};
export const hasPostedPayment = payment => payment.grossPosted===true || ['posted','partiallyrefunded','refunded','disputed','reversed'].includes(key(payment.status));

export const monthlyRecurringCents = (subscription={}) => {
  const amount=Number(subscription.amountCents)||0,count=Math.max(1,Number(subscription.intervalCount)||1),interval=key(subscription.interval||'month');
  const months=interval.startsWith('year')?12:interval.startsWith('week')?12/52:interval.startsWith('day')?12/365:1;
  return Math.round(amount/(months*count));
};
export const isRecurringAgreement = agreement => !['onetime','oneoff'].includes(key(agreement.rateType)) &&
  !['onetime','oneoff'].includes(key(agreement.serviceCadence)) && !['oneoffjob','workoffer','lead'].includes(key(agreement.sourceType));
export const needsBillingFollowUp = (agreement,subscriptions,invoices) => isRecurringAgreement(agreement)
  ? !subscriptions.some(subscription=>subscription.agreementId===agreement.id&&['active','trialing'].includes(key(subscription.stripeStatus||subscription.status)))
  : !invoices.some(invoice=>(invoice.agreementId===agreement.id||(agreement.jobId&&invoice.jobId===agreement.jobId))&&!['void','voided','canceled','cancelled'].includes(key(invoice.status)));
