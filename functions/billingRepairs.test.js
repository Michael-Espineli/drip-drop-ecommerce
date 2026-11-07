const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');
const {createCustomerPortalBilling}=require('./customerPortalBilling');
const {createSubscriptionCheckout}=require('./subscriptionCheckout');
const {createSalesSubscriptionCancellation}=require('./salesSubscriptionCancellation');
const {createStripeLifecycle}=require('./stripeLifecycle');
const {createManualRecurringBilling}=require('./manualRecurringBilling');
const {agreementTerms}=require('./billingAgreementTerms');
const now=new Date('2026-11-06T20:00:00Z');
const plan=()=>({companyId:'company',customerId:'customer',customerUserId:'home',stripeConnectedAccountId:'acct_pool',stripeCustomerId:'cus_pool',amountCents:10000,currency:'usd',interval:'month',intervalCount:1,manualBillingEnabled:true,createdAt:now});
function fixture(){
 const db=new MemoryFirestore({'companies/company':{ownerId:'owner',stripeConnectedAccountId:'acct_pool',customerBillingEnabled:true},'salesBillingSubscriptions/sub':plan()});
 const sessions=new Map(),subs=new Map(),calls=[];
 const stripe={accounts:{retrieve:async()=>({charges_enabled:true})},customers:{retrieve:async()=>({id:'cus_pool'}),create:async()=>({id:'cus_pool'})},
  checkout:{sessions:{create:async(params,options)=>{calls.push(['create',options]);if(!sessions.has(options.idempotencyKey))sessions.set(options.idempotencyKey,{...params,id:`cs_${sessions.size}`,status:'open',url:'https://checkout.stripe.com/example',amount_total:params.line_items[0].price_data.unit_amount,currency:'usd',payment_intent:'pi_payment'});return sessions.get(options.idempotencyKey);},retrieve:async id=>[...sessions.values()].find(s=>s.id===id),expire:async id=>{const session=[...sessions.values()].find(s=>s.id===id);calls.push(['expire',id]);session.status='expired';return session;}}},
  subscriptions:{list:async()=>({data:[...subs.values()],has_more:false}),retrieve:async id=>structuredClone(subs.get(id)),cancel:async id=>{calls.push(['cancel',id]);subs.get(id).status='canceled';return structuredClone(subs.get(id));},update:async(id,patch)=>{calls.push(['update',id,patch]);Object.assign(subs.get(id),patch);return structuredClone(subs.get(id));}},
  paymentIntents:{retrieve:async()=>({latest_charge:{id:'ch_payment'}})}};
 return {db,stripe,sessions,subs,calls,checkout:createSubscriptionCheckout(db,stripe,()=>now),cancel:createSalesSubscriptionCancellation(db,stripe,()=>now)};
}
const setupRequest=()=>({auth:{uid:'home'},data:{companyId:'company',billingSubscriptionId:'sub',successUrl:'https://dripdrop-poolapp.com/client/finance',cancelUrl:'https://dripdrop-poolapp.com/client/finance'}});
const cancelArgs={companyId:'company',subscriptionId:'sub',uid:'owner'};

test('a credited invoice settles after the reduced Stripe payment; retries and late failures preserve zero debt',async()=>{
 const f=fixture();f.db.set('salesInvoices/invoice',{companyId:'company',customerUserId:'home',currency:'usd',status:'open',totalAmountCents:10000,creditAmountCents:2000,amountPaidCents:0,amountDueCents:8000});
 const portal=createCustomerPortalBilling(f.db,f.stripe,()=>now);
 await portal.startInvoiceCheckout({auth:{uid:'home'},data:{invoiceId:'invoice',returnUrl:'https://dripdrop-poolapp.com/client/billing/invoices/invoice'}});
 const session=[...f.sessions.values()][0];assert.equal(session.amount_total,8000);
 const event={id:'evt_paid',type:'checkout.session.completed',account:'acct_pool',data:{object:{...session,payment_status:'paid'}}};
 await portal.reconcile(event);await portal.reconcile(event);await portal.reconcile({...event,id:'evt_late',type:'checkout.session.async_payment_failed'});
 const invoice=f.db.records.get('salesInvoices/invoice');assert.equal(invoice.amountPaidCents,8000);assert.equal(invoice.amountDueCents,0);assert.equal(invoice.status,'paid');assert.equal(invoice.paymentReviewRequired,false);
 f.db.set('salesInvoices/invoice',{status:'open',amountDueCents:2000},{merge:true});
 await assert.rejects(portal.startInvoiceCheckout({auth:{uid:'home'},data:{invoiceId:'invoice',returnUrl:'https://dripdrop-poolapp.com/client/billing/invoices/invoice'}}),{code:'failed-precondition'});
 assert.equal(f.sessions.size,1);
});

test('one-time ACH waits for bank confirmation and retires a previously offered card session',async()=>{
 const f=fixture();f.db.set('salesInvoices/invoice',{companyId:'company',customerUserId:'home',currency:'usd',status:'open',totalAmountCents:10000,amountPaidCents:0,amountDueCents:10000});
 const portal=createCustomerPortalBilling(f.db,f.stripe,()=>now),req={auth:{uid:'home'},data:{invoiceId:'invoice',returnUrl:'https://dripdrop-poolapp.com/client/billing/invoices/invoice'}};
 await portal.startInvoiceCheckout(req);const card=[...f.sessions.values()][0];await portal.startInvoiceCheckout({...req,data:{...req.data,paymentMethodType:'ach'}});assert.equal(card.status,'expired');
 const bank=[...f.sessions.values()][1];assert.deepEqual(bank.payment_method_types,['us_bank_account']);assert.equal(bank.payment_intent_data.application_fee_amount,19);
 const event={id:'evt_bank_pending',type:'checkout.session.completed',account:'acct_pool',data:{object:{...bank,payment_status:'unpaid'}}};await portal.reconcile(event);
 assert.equal(f.db.records.get('salesInvoices/invoice').amountDueCents,10000);assert.equal(f.db.records.get('salesInvoices/invoice').paymentProcessing,true);
 await assert.rejects(portal.startInvoiceCheckout(req),{code:'failed-precondition'});
 await portal.reconcile({...event,id:'evt_bank_success',type:'checkout.session.async_payment_succeeded',data:{object:{...bank,payment_status:'paid'}}});
 assert.equal(f.db.records.get('salesInvoices/invoice').amountDueCents,0);assert.equal([...f.db.records.values()].find(v=>v.stripePaymentIntentId==='pi_payment' && v.grossPosted).method,'stripeAch');
});

test('cancel retires the open recurring Checkout, is retry-safe, and prevents another setup',async()=>{
 const f=fixture();await f.checkout.start(setupRequest());const session=[...f.sessions.values()][0];
 await f.cancel.cancelPending(cancelArgs);await f.cancel.cancelPending(cancelArgs);
 assert.equal(session.status,'expired');assert.equal(f.calls.filter(c=>c[0]==='expire').length,1);
 const saved=f.db.records.get('salesBillingSubscriptions/sub');assert.equal(saved.status,'canceled');assert.equal(saved.manualBillingEnabled,false);assert.equal(saved.checkoutHold,false);
 await assert.rejects(f.checkout.start(setupRequest()),{code:'failed-precondition'});
});

test('cancel recovers an ambiguous session create with its original idempotency key',async()=>{
 const f=fixture();await f.checkout.start(setupRequest());const record=f.db.records.get('salesBillingSubscriptions/sub'),attempt=f.db.records.get(`salesBillingSubscriptions/sub/checkoutAttempts/${record.checkoutAttemptId}`);
 delete record.checkoutSessionId;delete attempt.sessionId;
 await f.cancel.cancelPending(cancelArgs);assert.equal(f.sessions.size,1);assert.equal([...f.sessions.values()][0].status,'expired');
 assert.equal(f.calls.filter(c=>c[0]==='create').at(-1)[1].idempotencyKey,record.checkoutAttemptId);
});

test('a completed setup is canceled in Stripe; its collected money remains flagged for review',async()=>{
 const f=fixture();await f.checkout.start(setupRequest());const session=[...f.sessions.values()][0];session.status='complete';session.payment_status='paid';session.subscription='sub_stripe';
 f.subs.set('sub_stripe',{id:'sub_stripe',customer:'cus_pool',status:'active',metadata:{companyId:'company',salesBillingSubscriptionId:'sub',paymentAttemptId:session.metadata.paymentAttemptId},items:{data:[]}});
 const result=await f.cancel.cancelPending(cancelArgs);assert.equal(result.paymentReviewRequired,true);assert.equal(f.subs.get('sub_stripe').status,'canceled');
 await createStripeLifecycle(f.db,f.stripe,()=>now).handle({id:'evt_late_checkout',type:'checkout.session.completed',account:'acct_pool',data:{object:{id:session.id}}});
 assert.equal(f.db.records.get('salesBillingSubscriptions/sub').status,'canceled');assert.equal(f.db.records.get('salesBillingSubscriptions/sub').autopayEnabled,false);
});

test('failed expiration retains the setup fence and a later retry finishes cancellation',async()=>{
 const f=fixture();await f.checkout.start(setupRequest());const expire=f.stripe.checkout.sessions.expire;
 f.stripe.checkout.sessions.expire=async()=>{throw Error('Stripe unavailable');};
 await assert.rejects(f.cancel.cancelPending(cancelArgs),/Stripe unavailable/);
 assert.equal(f.db.records.get('salesBillingSubscriptions/sub').status,'cancellationPending');await assert.rejects(f.checkout.start(setupRequest()));
 f.stripe.checkout.sessions.expire=expire;await f.cancel.cancelPending(cancelArgs);assert.equal(f.db.records.get('salesBillingSubscriptions/sub').status,'canceled');
});

test('a creator racing cancellation cannot publish its Checkout',async()=>{
 const f=fixture(),create=f.stripe.checkout.sessions.create;let cancel=true;
 f.stripe.checkout.sessions.create=async(...args)=>{const session=await create(...args);if(cancel){cancel=false;await f.cancel.cancelPending(cancelArgs);}return session;};
 await assert.rejects(f.checkout.start(setupRequest()),error=>['aborted','failed-precondition'].includes(error.code));assert.equal([...f.sessions.values()][0].status,'expired');assert.equal(f.db.records.get('salesBillingSubscriptions/sub').status,'canceled');
});

test('missing setup evidence and unauthorized cancellation fail without pretending Stripe was canceled',async()=>{
 const f=fixture();f.db.set('salesBillingSubscriptions/sub',{checkoutHold:true,checkoutAttemptId:'missing'},{merge:true});
 await assert.rejects(f.cancel.cancelPending({...cancelArgs,uid:'reader'}),{code:'permission-denied'});
 await assert.rejects(f.cancel.cancelPending(cancelArgs),{code:'failed-precondition'});await assert.rejects(f.cancel.cancelPending(cancelArgs),{code:'failed-precondition'});
 assert.equal(f.db.records.get('salesBillingSubscriptions/sub').status,'cancellationPending');
});

test('a pending cancellation cannot be reactivated by a subscription update',async()=>{
 const f=fixture();f.db.set('salesBillingSubscriptions/sub',{checkoutCancellationRequested:true,status:'cancellationPending'},{merge:true});
 f.subs.set('sub_stripe',{id:'sub_stripe',customer:'cus_pool',status:'active',metadata:{companyId:'company',salesBillingSubscriptionId:'sub'},items:{data:[]}});
 await createStripeLifecycle(f.db,f.stripe,()=>now).handle({id:'evt_active',type:'customer.subscription.updated',account:'acct_pool',data:{object:{id:'sub_stripe'}}});
 assert.equal(f.db.records.get('salesBillingSubscriptions/sub').status,'cancellationPending');assert.equal(f.db.records.get('salesBillingSubscriptions/sub').autopayEnabled,false);
});

test('fixed-term agreement ends on the company calendar; manual/autopay cannot bill a later period',async()=>{
 const f=fixture(),start=new Date('2026-11-06T08:00:00Z');
 f.db.set('salesAgreements/agreement',{companyId:'company',customerId:'customer',status:'accepted',endDate:new Date('2026-11-01T08:00:00Z'),atWill:false});
 f.db.set('salesBillingSubscriptions/sub',{agreementId:'agreement',billingTimeZone:'America/Los_Angeles',manualBillingNextPeriodStart:start,manualBillingNextInvoiceAt:start},{merge:true});
 assert.equal(agreementTerms(plan(),{endDate:new Date('2026-11-01T08:00:00Z'),atWill:false},{timeZone:'America/Los_Angeles'}).endAt,Date.parse('2026-11-02T08:00:00Z'));
 await assert.rejects(f.checkout.start(setupRequest()),{code:'failed-precondition'});
 const worker=createManualRecurringBilling(f.db,()=>now);await assert.rejects(worker.generate({subscriptionId:'sub',companyId:'company',uid:'owner',expectedPeriodStartMillis:start.getTime()}),{code:'failed-precondition'});
 assert.deepEqual(await worker.generate({subscriptionId:'sub',scheduled:true}),{skipped:'agreementEnded'});assert.equal((await f.db.collection('salesInvoices').get()).size,0);
});

test('a shortened final manual period requires review rather than charging a full extra period',async()=>{
 const f=fixture(),start=new Date('2026-11-01');f.db.set('salesAgreements/agreement',{companyId:'company',customerId:'customer',status:'accepted',endDate:new Date('2026-11-15'),atWill:false});
 f.db.set('salesBillingSubscriptions/sub',{agreementId:'agreement',manualBillingNextPeriodStart:start,manualBillingNextInvoiceAt:start},{merge:true});
 const worker=createManualRecurringBilling(f.db,()=>now);assert.equal((await worker.generate({subscriptionId:'sub',scheduled:true})).skipped,'finalPeriodReview');assert.equal((await f.db.collection('salesInvoices').get()).size,0);
});

test('Stripe synchronization schedules the agreed end and preserves an earlier requested cancellation',async()=>{
 const f=fixture();f.db.set('salesAgreements/agreement',{companyId:'company',customerId:'customer',status:'accepted',endDate:new Date('2026-12-31'),atWill:false});f.db.set('salesBillingSubscriptions/sub',{agreementId:'agreement'},{merge:true});
 f.subs.set('sub_stripe',{id:'sub_stripe',customer:'cus_pool',status:'active',metadata:{companyId:'company',salesBillingSubscriptionId:'sub'},items:{data:[]}});
 const worker=createStripeLifecycle(f.db,f.stripe,()=>now);await worker.handle({id:'evt_term',type:'customer.subscription.updated',account:'acct_pool',data:{object:{id:'sub_stripe'}}});
 assert.equal(f.subs.get('sub_stripe').cancel_at,Date.parse('2027-01-01')/1000);
 f.subs.get('sub_stripe').cancel_at=Date.parse('2026-12-01')/1000;
 await worker.handle({id:'evt_earlier',type:'customer.subscription.updated',account:'acct_pool',data:{object:{id:'sub_stripe'}}});assert.equal(f.subs.get('sub_stripe').cancel_at,Date.parse('2026-12-01')/1000);
});
