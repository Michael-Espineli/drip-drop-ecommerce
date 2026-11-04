import {hasPostedPayment,netPaymentCents,monthlyRecurringCents,needsBillingFollowUp} from './financialMetrics';
test('net collections retain partially refunded and disputed receipts without counting failed payments',()=>{
 expect(netPaymentCents({status:'partiallyRefunded',amountCents:10000,refundedAmountCents:2500})).toBe(7500);
 expect(netPaymentCents({status:'disputed',amountCents:10000,reversedAmountCents:10000})).toBe(0);
 expect(netPaymentCents({status:'refunded',amountCents:10000})).toBe(0);
 expect(netPaymentCents({status:'failed',amountCents:10000})).toBe(0);
 expect(hasPostedPayment({status:'partiallyRefunded'})).toBe(true);
});
test('MRR normalizes weekly, quarterly and annual cadences',()=>{
 expect(monthlyRecurringCents({amountCents:120000,interval:'year'})).toBe(10000);
 expect(monthlyRecurringCents({amountCents:30000,interval:'month',intervalCount:3})).toBe(10000);
 expect(monthlyRecurringCents({amountCents:3000,interval:'week'})).toBe(13000);
});
test('one-time accepted estimates leave follow-up once invoiced; recurring agreements require an active setup',()=>{
 const estimate={id:'estimate',rateType:'oneTime'};
 expect(needsBillingFollowUp(estimate,[],[{agreementId:'estimate',status:'open'}])).toBe(false);
 expect(needsBillingFollowUp(estimate,[],[{agreementId:'estimate',status:'void'}])).toBe(true);
 expect(needsBillingFollowUp({id:'agreement'},[{agreementId:'agreement',status:'active'}],[])).toBe(false);
 expect(needsBillingFollowUp({id:'agreement'},[],[{agreementId:'agreement',status:'paid'}])).toBe(true);
});
