const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');
const {hash}=require('./billingMath');
const {createSavedCustomerPayments}=require('./savedCustomerPayments');
const now=new Date('2026-11-06T22:00:00Z');
function fixture(type='card'){
 const db=new MemoryFirestore({'companies/company':{ownerId:'owner',name:'Pool Company',stripeConnectedAccountId:'acct_pool',customerBillingEnabled:true},'salesInvoices/invoice':{companyId:'company',customerId:'customer',customerName:'Home Owner',email:'home@example.com',currency:'usd',status:'open',totalAmountCents:10000,amountPaidCents:0,amountDueCents:10000}});
 const profileId=hash('company:customer:acct_pool'),profilePath=`salesPaymentProfiles/${profileId}`;
 db.set(profilePath,{companyId:'company',customerId:'customer',stripeConnectedAccountId:'acct_pool',stripeCustomerId:'cus_saved'});
 db.set(`${profilePath}/methods/pm_saved`,{id:'pm_saved',type,status:'ready',mandateId:type==='us_bank_account'?'mandate_bank':''});
 const methods={pm_saved:{id:'pm_saved',type,customer:'cus_saved',[type]:{last4:'6789',brand:'visa',bank_name:'Test Bank'}}};
 const intents=new Map(),calls=[],sessions=new Map();let result='succeeded',lost=false;
 const stripe={paymentMethods:{retrieve:async method=>methods[method]},mandates:{retrieve:async()=>({status:'active',payment_method:'pm_saved'})},
  customers:{create:async()=>({id:'cus_saved'})},checkout:{sessions:{create:async(params,options)=>{calls.push({setup:params,options});const session={id:'cs_setup',status:'open',url:'https://checkout.stripe.com/test'};sessions.set(session.id,session);return session;},retrieve:async id=>sessions.get(id),expire:async id=>{sessions.get(id).status='expired';}}},
  paymentIntents:{create:async(params,options)=>{calls.push({params,options});if(!intents.has(options.idempotencyKey))intents.set(options.idempotencyKey,{...params,id:'pi_saved',status:result,created:Math.floor(now.getTime()/1000),latest_charge:null});if(lost){lost=false;throw Error('Network response lost');}return structuredClone(intents.get(options.idempotencyKey));},retrieve:async id=>structuredClone([...intents.values()].find(i=>i.id===id)),cancel:async id=>{const pi=[...intents.values()].find(i=>i.id===id);pi.status='canceled';return structuredClone(pi);}},setupIntents:{retrieve:async()=>stripe.setupIntent}};
 return {db,stripe,calls,intents,methods,sessions,profileId,profilePath,worker:createSavedCustomerPayments(db,stripe,()=>now),result:value=>{result=value;},lose:()=>{lost=true;}};
}
const request=extra=>({auth:{uid:'owner'},data:{companyId:'company',invoiceId:'invoice',requestId:'charge-once',paymentMethodId:'pm_saved',authorizationConfirmed:true,authorizationReference:'Signed service agreement 1234',...extra}});

test('office payment uses the invoice balance, company account and authorization, and retries without double collection',async()=>{
 const f=fixture(),first=await f.worker.charge(request());assert.equal(first.status,'succeeded');assert.equal(f.calls[0].params.amount,10000);assert.equal(f.calls[0].options.stripeAccount,'acct_pool');assert.equal(f.calls[0].params.off_session,true);
 assert.equal(f.db.records.get('salesInvoices/invoice').amountDueCents,0);assert.equal(f.db.records.get('salesInvoices/invoice').paymentProcessing,false);
 assert.deepEqual(await f.worker.charge(request()),first);assert.equal(f.calls.length,1);
 assert.equal([...f.db.records.values()].find(v=>v.type==='officePaymentStatus').authorizationReference,'Signed service agreement 1234');
 await assert.rejects(f.worker.charge(request({authorizationReference:'A different authorization'})),{code:'already-exists'});
});
test('lost responses keep the balance reserved and reuse exactly the original Stripe charge',async()=>{
 const f=fixture();f.lose();await assert.rejects(f.worker.charge(request()),/Network response lost/);
 assert.equal(f.db.records.get('salesInvoices/invoice').paymentProcessing,true);
 await assert.rejects(f.worker.charge(request({requestId:'second-charge'})),{code:'failed-precondition'});
 await f.worker.charge(request());assert.equal(f.intents.size,1);assert.deepEqual(f.calls[0],f.calls[1]);
});
test('ACH remains processing until confirmed and posts once despite duplicate callbacks',async()=>{
 const f=fixture('us_bank_account');f.result('processing');const first=await f.worker.charge(request());assert.equal(first.status,'processing');assert.equal(f.db.records.get('salesInvoices/invoice').amountPaidCents,0);assert.equal(f.db.records.get('salesInvoices/invoice').paymentProcessing,true);
 [...f.intents.values()][0].status='succeeded';await f.worker.syncPayment('pi_saved','acct_pool');await f.worker.syncPayment('pi_saved','acct_pool');
 assert.equal(f.db.records.get('salesInvoices/invoice').amountPaidCents,10000);assert.equal(f.db.records.get('salesInvoices/invoice').paymentProcessing,false);
 assert.equal([...f.db.records.values()].find(v=>v.stripePaymentIntentId==='pi_saved').method,'stripeAch');
});
test('authentication-required collection cancels its unpaid intent before permitting customer checkout',async()=>{
 const f=fixture();f.result('requires_action');const first=await f.worker.charge(request());assert.equal(first.status,'customerActionRequired');assert.equal([...f.intents.values()][0].status,'canceled');assert.equal(f.db.records.get('salesInvoices/invoice').paymentProcessing,false);assert.equal(f.db.records.get('salesInvoices/invoice').amountPaidCents,0);
});
test('other companies, finance readers, missing authorization and mismatched bank mandate cannot charge',async()=>{
 for(const patch of [{authorizationConfirmed:false},{authorizationReference:'short'},{companyId:'foreign'}]){const f=fixture();await assert.rejects(f.worker.charge(request(patch)));assert.equal(f.calls.length,0);}
 const f=fixture();f.db.set('users/reader/userAccess/company',{roleId:'reader',status:'active'});f.db.set('companies/company/roles/reader',{permissionIdList:['400']});await assert.rejects(f.worker.charge({...request(),auth:{uid:'reader'}}),{code:'permission-denied'});
 const bank=fixture('us_bank_account');bank.stripe.mandates.retrieve=async()=>({status:'inactive'});await assert.rejects(bank.worker.charge(request()),/no longer active/);assert.equal(bank.calls.length,0);assert.equal(bank.db.records.get('salesInvoices/invoice').paymentProcessing,false);
});
test('Stripe invoices, stale profiles, reviewed invoices, and an active portal checkout never cause a second collection',async()=>{
 for(const patch of [{stripeInvoiceId:'in_invoice'},{paymentReviewRequired:true},{paymentProcessing:true},{status:'paid'},{billingMutation:{id:'other',startedAt:now}}]){const f=fixture();f.db.set('salesInvoices/invoice',patch,{merge:true});await assert.rejects(f.worker.charge(request()));assert.equal(f.calls.length,0);}
 const f=fixture();f.db.set('salesInvoices/invoice',{portalPaymentAttemptId:'portal'},{merge:true});f.db.set('salesInvoices/invoice/portalPaymentAttempts/portal',{sessionId:'cs_portal',status:'open'});f.sessions.set('cs_portal',{id:'cs_portal',status:'complete'});await assert.rejects(f.worker.charge(request()),/already completed checkout/);assert.equal(f.calls.length,0);
});
test('old uncertain requests cannot recreate a charge after Stripe idempotency retention',async()=>{
 const f=fixture();f.lose();await assert.rejects(f.worker.charge(request()));const later=createSavedCustomerPayments(f.db,f.stripe,()=>new Date(now.getTime()+25*3600000));await assert.rejects(later.charge(request()),/Review Stripe/);assert.equal(f.calls.length,1);
});
test('a hostile payment callback cannot change another company or customer balance',async()=>{
 const f=fixture();f.result('processing');await f.worker.charge(request());await assert.rejects(f.worker.syncPayment('pi_saved','acct_foreign'),{code:'permission-denied'});[...f.intents.values()][0].customer='cus_foreign';await assert.rejects(f.worker.syncPayment('pi_saved','acct_pool'),{code:'permission-denied'});assert.equal(f.db.records.get('salesInvoices/invoice').amountPaidCents,0);
});
test('independent ACH setup is Stripe hosted, off-session, auditable, and never stores raw bank details',async()=>{
 const f=fixture('us_bank_account'),setupRequest=request({requestId:'setup',paymentMethodType:'ach',returnUrl:'https://dripdrop-poolapp.com/company/sales/invoices/invoice'});
 const first=await f.worker.setup(setupRequest);assert.equal(first.url,'https://checkout.stripe.com/test');const params=f.calls[0].setup;
 assert.equal(params.mode,'setup');assert.deepEqual(params.payment_method_types,['us_bank_account']);assert.equal(params.setup_intent_data.usage,undefined); // Checkout setup mode creates an off-session SetupIntent by default.assert.match(params.custom_text.submit.message,/does not pay an invoice today/);
 assert.equal(new URL(params.success_url).pathname,'/customer/payment-method-setup');assert.equal(new URL(params.cancel_url).pathname,'/customer/payment-method-setup');
 f.stripe.setupIntent={id:'seti_saved',metadata:params.setup_intent_data.metadata,customer:'cus_saved',payment_method:'pm_saved',mandate:'mandate_bank',usage:'off_session',status:'succeeded',created:Math.floor(now.getTime()/1000)};
 f.methods.pm_saved.us_bank_account.account_number='should-not-be-saved';await f.worker.syncSetup('seti_saved','acct_pool');
 const saved=f.db.records.get(`${f.profilePath}/methods/pm_saved`);assert.equal(saved.last4,'6789');assert.equal(saved.account_number,undefined);assert.match(saved.consentText,/authorize Pool Company/);
 const list=await f.worker.list(request());assert.equal(list.methods[0].last4,'6789');assert.equal(list.methods[0].mandateId,undefined);
});
test('setup return URLs and changed idempotent setup instructions are rejected',async()=>{
 const f=fixture();await assert.rejects(f.worker.setup(request({paymentMethodType:'card',returnUrl:'https://evil.example/setup'})),{code:'invalid-argument'});
 await f.worker.setup(request({paymentMethodType:'card',returnUrl:'https://dripdrop-poolapp.com/company/invoice'}));await assert.rejects(f.worker.setup(request({paymentMethodType:'ach',returnUrl:'https://dripdrop-poolapp.com/company/invoice'})),{code:'already-exists'});
});
test('refunds that arrive before office settlement are reconciled from Stripe without reopening debt or counting twice',async()=>{
 const f=fixture();f.result('processing');await f.worker.charge(request());
 const intent=[...f.intents.values()][0],charge={id:'ch_saved',payment_intent:intent.id,status:'succeeded',amount:10000,amount_refunded:4000,currency:'usd',created:Math.floor(now.getTime()/1000)};intent.status='succeeded';intent.latest_charge=charge;
 f.stripe.charges={retrieve:async()=>charge};f.stripe.refunds={list:async()=>({data:[{id:'re_saved',amount:4000,status:'succeeded',created:charge.created,balance_transaction:{id:'txn_refund',amount:-4000,currency:'usd',created:charge.created}}],has_more:false})};f.stripe.disputes={list:async()=>({data:[],has_more:false})};
 await f.worker.syncPayment(intent.id,'acct_pool');await f.worker.syncPayment(intent.id,'acct_pool');
 const invoice=f.db.records.get('salesInvoices/invoice');assert.equal(invoice.amountPaidCents,6000);assert.equal(invoice.refundCreditCents,4000);assert.equal(invoice.amountDueCents,0);assert.equal(f.db.records.get('salesPaymentAdjustments/refund_re_saved').cashMovements[0].amountCents,-4000);
});
test('expired setup sessions are acknowledged without entering the subscription checkout lifecycle',async()=>{
 const f=fixture();const response=await f.worker.setup(request({paymentMethodType:'card',returnUrl:'https://dripdrop-poolapp.com/company/invoice'})),meta=f.calls[0].setup.metadata;
 assert.ok(response.url);assert.equal(await f.worker.handle({type:'checkout.session.expired',account:'acct_pool',data:{object:{id:'cs_setup',customer:'cus_saved',status:'expired',metadata:meta}}}),true);
 assert.equal(f.db.records.get(`${f.profilePath}/setupAttempts/${meta.setupAttemptId}`).status,'expired');
});
test('a returned office ACH payment clears processing, reverses net collections and flags its invoice for review',async()=>{
 const f=fixture('us_bank_account');f.result('processing');await f.worker.charge(request());
 const intent=[...f.intents.values()][0],charge={id:'ch_bank',payment_intent:intent.id,payment_method:'pm_saved',status:'succeeded',amount:10000,amount_refunded:0,currency:'usd',created:Math.floor(now.getTime()/1000)};intent.status='succeeded';intent.latest_charge=charge;f.stripe.charges={retrieve:async()=>charge};f.stripe.refunds={list:async()=>({data:[],has_more:false})};f.stripe.disputes={list:async()=>({data:[],has_more:false})};
 await f.worker.syncPayment(intent.id,'acct_pool');charge.status='failed';charge.failure_balance_transaction={id:'txn_return',amount:-10000,currency:'usd',created:Math.floor(now.getTime()/1000)};intent.latest_charge=charge;intent.status='requires_payment_method';intent.payment_method=null;await f.worker.syncPayment(intent.id,'acct_pool');
 const invoice=f.db.records.get('salesInvoices/invoice');assert.equal(invoice.paymentProcessing,false);assert.equal(invoice.paymentReviewRequired,true);assert.equal(invoice.amountPaidCents,0);assert.equal(invoice.amountDueCents,10000);assert.equal((await f.worker.charge(request())).status,'paymentReview');assert.equal(f.calls.length,1);assert.equal(f.db.records.get('salesPaymentAdjustments/bankreturn_ch_bank').cashMovements[0].id,'txn_return');
});
