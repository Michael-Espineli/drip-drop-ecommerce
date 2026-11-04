const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');
const {createHomeownerRequests}=require('./homeownerRequests');
const {createHomeownerServicePublishing,linkedId}=require('./homeownerServicePublishing');
const {createCustomerPortalBilling}=require('./customerPortalBilling');
const now=new Date('2026-11-02T18:00:00Z');
const auth={uid:'homeowner',token:{email:'homeowner@example.test',email_verified:true}};
const base=()=>({
 'users/homeowner':{firstName:'Jordan',lastName:'Rivera'},
 'companies/company':{name:'Pool Company',customerBillingEnabled:true,stripeConnectedAccountId:'acct_pool'},
 'companies/company/customers/customer':{linkedCustomerIds:['homeowner']},
 'customerCompanyRelationships/relation':{companyId:'company',companyCustomerId:'customer',homeownerUserId:'homeowner',status:'active'},
 'homeownerServiceLocations/site':{userId:'homeowner',linkedCompanyId:'company',linkedCompanyServiceLocationId:'company-site'},
 'homeownerBodiesOfWater/pool':{userId:'homeowner',serviceLocationId:'site'},
 'homeownerEquipment/pump':{userId:'homeowner',serviceLocationId:'site',bodyOfWaterId:'pool'},
 'salesInvoices/invoice':{companyId:'company',customerId:'customer',customerUserId:'homeowner',email:'homeowner@example.test',status:'open',currency:'usd',totalAmountCents:17500,amountPaidCents:2500,amountDueCents:15000,emailDelivery:{reviewAccessToken:'email-token'}},
});
const request=extra=>({auth,data:{companyId:'company',locationId:'site',bodyOfWaterId:'pool',equipmentId:'pump',submissionId:'request-once',description:'The pump is noisy.',...extra}});
test('repair submission delivers to the linked company once and preserves homeowner property IDs',async()=>{
 const db=new MemoryFirestore(base()),worker=createHomeownerRequests(db,()=>now);
 const first=await worker.submit(request());const second=await worker.submit(request());
 assert.equal(first.requestId,second.requestId);assert.equal(second.alreadySubmitted,true);
 const saved=db.records.get(`homeownerRepairRequests/${first.requestId}`);
 assert.equal(saved.companyId,'company');assert.equal(saved.customerId,'customer');assert.equal(saved.relationshipId,'relation');assert.equal(saved.locationId,'site');assert.equal(saved.companyServiceLocationId,'company-site');assert.equal(saved.requesterName,'Jordan Rivera');
 assert.equal([...db.records.keys()].filter(p=>p.startsWith('companies/company/alerts/')).length,1);
 assert.equal([...db.records.keys()].filter(p=>p.startsWith('homeownerRepairRequests/')).length,1);
});
test('repair submission rejects unverified, foreign, revoked, mismatched and unlinked requests without writes',async()=>{
 for(const scenario of ['unverified','foreign-site','foreign-pool','foreign-equipment','revoked','unlinked','wrong-company']){
  const records=base(),req=request();
  if(scenario==='unverified')req.auth={...auth,token:{...auth.token,email_verified:false}};
  if(scenario==='foreign-site')records['homeownerServiceLocations/site'].userId='other';
  if(scenario==='foreign-pool')records['homeownerBodiesOfWater/pool'].serviceLocationId='other';
  if(scenario==='foreign-equipment')records['homeownerEquipment/pump'].userId='other';
  if(scenario==='revoked')records['customerCompanyRelationships/relation'].status='revoked';
  if(scenario==='unlinked')records['companies/company/customers/customer'].linkedCustomerIds=[];
  if(scenario==='wrong-company')req.data.companyId='other';
  const db=new MemoryFirestore(records);await assert.rejects(createHomeownerRequests(db,()=>now).submit(req));assert.deepEqual(Object.fromEntries(db.records),records,scenario);
 }
});
test('a reused repair submission cannot silently create a different request',async()=>{
 const db=new MemoryFirestore(base()),worker=createHomeownerRequests(db,()=>now);await worker.submit(request());await assert.rejects(worker.submit(request({description:'A different issue.'})),{code:'already-exists'});
});
function serviceRecords(){return {...base(),
 'companies/company/serviceLocations/company-site':{customerId:'customer',nickName:'Home',address:{streetAddress:'Example address'}},
 'companies/company/bodiesOfWater/company-pool':{serviceLocationId:'company-site',name:'Backyard'},
 'companies/company/serviceStops/stop':{customerId:'customer',serviceLocationId:'company-site',bodyOfWaterId:'company-pool',serviceDate:new Date('2026-11-05T18:00:00Z'),operationStatus:'Not Finished',techName:'Taylor',notes:'Next visit',internalNotes:'Private',payrollAmount:99900},
 'companies/company/stopData/readings':{serviceStopId:'stop',bodyOfWaterId:'company-pool',date:now,readings:[{name:'pH',amount:'7.4',cost:999}],dosages:[{name:'Chlorine',amount:'2',UOM:'oz',price:999}],testerStripScans:[{private:true}]},
 'companies/company/serviceStops/stop/tasks/task':{name:'Clean filter',status:'Finished',contractedRate:10000},
};}
test('future visits publish after linking and completion updates the same sanitized report',async()=>{
 const db=new MemoryFirestore(serviceRecords()),worker=createHomeownerServicePublishing(db,()=>now);
 await worker.syncRelationship(db.records.get('customerCompanyRelationships/relation'));
 const path=`homeownerServiceStops/${linkedId('hoss','company','stop')}`;let stop=db.records.get(path);
 assert.equal(stop.status,'Scheduled');assert.equal(stop.userId,'homeowner');assert.equal(stop.serviceLocationId,linkedId('hosl','company','company-site'));
 assert.equal(stop.internalNotes,undefined);assert.equal(stop.payrollAmount,undefined);assert.equal(stop.tasks[0].contractedRate,undefined);
 db.set('companies/company/serviceStops/stop',{operationStatus:'Finished',completedAt:now,notes:'Pool cleaned'},{merge:true});await worker.syncStop('company','stop');
 stop=db.records.get(path);assert.equal(stop.status,'Finished');assert.equal(stop.notes,'Pool cleaned');assert.equal([...db.records.keys()].filter(p=>p.startsWith('homeownerServiceStops/')).length,1);
 const data=db.records.get(`stopData/${linkedId('hostop','company','readings')}`);assert.equal(data.userId,'homeowner');assert.equal(data.readings[0].amount,'7.4');assert.equal(data.readings[0].cost,undefined);assert.equal(data.dosages[0].price,undefined);assert.equal(data.testerStripScans,undefined);
});
test('service projections cannot adopt another homeowner property or a revoked relationship',async()=>{
 const records=serviceRecords(),path=`homeownerServiceLocations/${linkedId('hosl','company','company-site')}`;records[path]={userId:'other'};
 const db=new MemoryFirestore(records);await assert.rejects(createHomeownerServicePublishing(db,()=>now).syncStop('company','stop'),/ownership mismatch/);assert.deepEqual(Object.fromEntries(db.records),records);
 delete records[path];const second=new MemoryFirestore(records),worker=createHomeownerServicePublishing(second,()=>now);await worker.syncStop('company','stop');second.set('customerCompanyRelationships/relation',{status:'revoked'},{merge:true});await worker.syncStop('company','stop');assert.equal(second.records.get(`homeownerServiceStops/${linkedId('hoss','company','stop')}`).userId,'');
});
test('a deleted or canceled visit never remains scheduled',async()=>{
 const db=new MemoryFirestore(serviceRecords()),worker=createHomeownerServicePublishing(db,()=>now);await worker.syncStop('company','stop');const old=db.records.get('companies/company/serviceStops/stop');db.records.delete('companies/company/serviceStops/stop');await worker.syncStop('company','stop',old);assert.equal(db.records.get(`homeownerServiceStops/${linkedId('hoss','company','stop')}`).status,'Cancelled');
});
function paymentFixture(records=base()){
 const db=new MemoryFirestore(records),sessions=new Map(),calls=[];
 const stripe={accounts:{retrieve:async()=>({charges_enabled:true})},checkout:{sessions:{create:async(params,options)=>{
   calls.push({params,options});if(sessions.has(options.idempotencyKey))return sessions.get(options.idempotencyKey);
   const session={...params,id:`cs_${sessions.size+1}`,url:'https://checkout.stripe.com/test',status:'open',amount_total:params.line_items[0].price_data.unit_amount,currency:'usd',payment_intent:`pi_${sessions.size+1}`,payment_status:'unpaid'};sessions.set(options.idempotencyKey,session);return session;
 },retrieve:async id=>[...sessions.values()].find(s=>s.id===id),expire:async id=>{const session=[...sessions.values()].find(s=>s.id===id);session.status='expired';return session;}}},paymentIntents:{retrieve:async()=>({latest_charge:{receipt_url:'https://pay.stripe.com/receipt'}})},billingPortal:{configurations:{create:async()=>({id:'bpc_config'})},sessions:{create:async(params,options)=>{calls.push({params,options});return {url:'https://billing.stripe.com/test'};}}}};
 return {db,sessions,calls,worker:createCustomerPortalBilling(db,stripe,()=>now)};
}
const payRequest=()=>({auth,data:{invoiceId:'invoice',amountCents:1,returnUrl:'https://dripdrop-poolapp.com/client/billing/invoices/invoice'}});
const eventFor=(session,type='checkout.session.completed',id='evt_first')=>({id,type,account:'acct_pool',data:{object:{...session,payment_status:'paid'}}});
test('invoice checkout uses the trusted remaining balance, connected account and idempotent attempt',async()=>{
 const f=paymentFixture();await Promise.all([f.worker.startInvoiceCheckout(payRequest()),f.worker.startInvoiceCheckout(payRequest())]);assert.equal(f.sessions.size,1);
 const call=f.calls[0];assert.equal(call.params.line_items[0].price_data.unit_amount,15000);assert.equal(call.params.mode,'payment');assert.equal(call.options.stripeAccount,'acct_pool');assert.equal(call.params.payment_intent_data.application_fee_amount,12);assert.equal(call.params.metadata.flow,'customer_invoice_payment');
});
test('invoice checkout rejects foreign accounts, unverified email matches, closed invoices and unsafe return URLs',async()=>{
 for(const scenario of ['foreign','unverified','closed','unsafe','disabled']){
  const records=base(),req=payRequest();if(scenario==='foreign')req.auth={uid:'other',token:{email_verified:true,email:'other@example.test'}};
  if(scenario==='unverified'){records['salesInvoices/invoice'].customerUserId='';req.auth={uid:'new',token:{email:'homeowner@example.test',email_verified:false}};}
  if(scenario==='closed')records['salesInvoices/invoice'].status='void';if(scenario==='unsafe')req.data.returnUrl='https://attacker.example/client/invoice';if(scenario==='disabled')records['companies/company'].customerBillingEnabled=false;
  const f=paymentFixture(records);await assert.rejects(f.worker.startInvoiceCheckout(req));assert.equal(f.calls.length,0,scenario);
 }
});
test('a changed invoice expires the prior checkout before offering the new balance',async()=>{
 const f=paymentFixture();await f.worker.startInvoiceCheckout(payRequest());const previous=[...f.sessions.values()][0];
 f.db.set('salesInvoices/invoice',{amountPaidCents:7500,amountDueCents:10000},{merge:true});
 await f.worker.startInvoiceCheckout(payRequest());assert.equal(previous.status,'expired');assert.equal(f.sessions.size,2);assert.equal([...f.sessions.values()][1].amount_total,10000);
});
test('a payment arriving after an invoice is voided preserves the void and flags review',async()=>{
 const f=paymentFixture();await f.worker.startInvoiceCheckout(payRequest());const session=[...f.sessions.values()][0];
 f.db.set('salesInvoices/invoice',{status:'void',amountDueCents:0},{merge:true});await f.worker.reconcile(eventFor(session));
 const invoice=f.db.records.get('salesInvoices/invoice');assert.equal(invoice.status,'void');assert.equal(invoice.amountDueCents,0);assert.equal(invoice.amountPaidCents,17500);assert.equal(invoice.paymentReviewRequired,true);
});
test('a signed invoice email link can open one-time payment without creating an account',async()=>{
 const f=paymentFixture(),req=payRequest();delete req.auth;req.data.accessToken='email-token';assert.ok((await f.worker.startInvoiceCheckout(req)).url);req.data.accessToken='wrong';await assert.rejects(f.worker.startInvoiceCheckout(req),{code:'permission-denied'});
});
test('signed payment reconciliation posts once, preserves manual payments and ignores late failure',async()=>{
 const f=paymentFixture();await f.worker.startInvoiceCheckout(payRequest());const session=[...f.sessions.values()][0];await f.worker.reconcile(eventFor(session));await f.worker.reconcile(eventFor(session,'checkout.session.completed','evt_duplicate'));await f.worker.reconcile(eventFor(session,'checkout.session.async_payment_failed','evt_late'));
 const invoice=f.db.records.get('salesInvoices/invoice');assert.equal(invoice.amountPaidCents,17500);assert.equal(invoice.amountDueCents,0);assert.equal(invoice.status,'paid');const payments=[...f.db.records].filter(([p])=>p.startsWith('salesPayments/'));assert.equal(payments.length,1);assert.equal(payments[0][1].receiptUrl,'https://pay.stripe.com/receipt');
});
test('processing and failed payments do not mark invoices paid and mismatched webhook amounts are rejected',async()=>{
 const f=paymentFixture();await f.worker.startInvoiceCheckout(payRequest());const session=[...f.sessions.values()][0],processing=eventFor(session);processing.data.object.payment_status='unpaid';await f.worker.reconcile(processing);assert.equal(f.db.records.get('salesInvoices/invoice').paymentProcessing,true);assert.equal(f.db.records.get('salesInvoices/invoice').amountPaidCents,2500);
 await f.worker.reconcile(eventFor(session,'checkout.session.async_payment_failed','evt_failed'));assert.equal(f.db.records.get('salesInvoices/invoice').paymentProcessing,false);assert.equal(f.db.records.get('salesInvoices/invoice').amountDueCents,15000);
 const changed=eventFor(session);changed.data.object.amount_total=1;await assert.rejects(f.worker.reconcile(changed),{code:'permission-denied'});
});
test('billing management uses the subscription customer on its verified connected account',async()=>{
 const records=base();records['salesBillingSubscriptions/sub']={companyId:'company',customerUserId:'homeowner',stripeCustomerId:'cus_pool',stripeConnectedAccountId:'acct_pool'};
 const f=paymentFixture(records);const req={auth,data:{billingSubscriptionId:'sub',returnUrl:'https://dripdrop-poolapp.com/client/finance'}};assert.ok((await f.worker.billingPortal(req)).url);assert.equal(f.calls[0].params.customer,'cus_pool');assert.equal(f.calls[0].options.stripeAccount,'acct_pool');req.auth={uid:'other',token:{email_verified:true}};await assert.rejects(f.worker.billingPortal(req),{code:'permission-denied'});
});

test('homeowner-started and multi-pool visits keep the original homeowner pool IDs',async()=>{
 const records=serviceRecords();records['companies/company/serviceLocations/company-site'].sourceHomeownerServiceLocationId='site';records['companies/company/bodiesOfWater/company-pool'].sourceHomeownerBodyOfWaterId='pool';
 records['homeownerBodiesOfWater/spa']={userId:'homeowner',serviceLocationId:'site'};records['companies/company/bodiesOfWater/company-spa']={customerId:'customer',serviceLocationId:'company-site',sourceHomeownerBodyOfWaterId:'spa',name:'Spa'};
 records['companies/company/stopData/spa-readings']={serviceStopId:'stop',bodyOfWaterId:'company-spa',readings:[{name:'pH',amount:'7.5'}]};
 const db=new MemoryFirestore(records);await createHomeownerServicePublishing(db,()=>now).syncStop('company','stop');
 assert.equal(db.records.get(`homeownerServiceStops/${linkedId('hoss','company','stop')}`).serviceLocationId,'site');
 assert.equal(db.records.get(`stopData/${linkedId('hostop','company','readings')}`).bodyOfWaterId,'pool');assert.equal(db.records.get(`stopData/${linkedId('hostop','company','spa-readings')}`).bodyOfWaterId,'spa');
});
