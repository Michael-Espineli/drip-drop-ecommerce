const {test} = require('node:test');
const assert = require('node:assert/strict');
const {MemoryFirestore} = require('./testSupport/memoryFirestore');
const {createSalesInvoiceCommands} = require('./salesInvoiceCommands');
const {createCustomerPortalBilling} = require('./customerPortalBilling');
const {requireBillingActor,hasActiveCompanyPermission} = require('./billingAccess');

const now = new Date('2026-11-02T18:00:00Z');
const auth = {uid:'manager',token:{email_verified:true}};
const records = () => ({
  'companies/company':{ownerId:'owner',stripeConnectedAccountId:'acct_company',customerBillingEnabled:true},
  'users/manager/userAccess/company':{roleId:'billing',status:'active'},
  'companies/company/roles/billing':{permissionIdList:['400','404']},
  'users/reader/userAccess/company':{roleId:'reader'},
  'companies/company/roles/reader':{permissionIdList:['400']},
  'users/tech/userAccess/company':{roleId:'tech'},
  'companies/company/roles/tech':{permissionIdList:['72']},
  'salesInvoices/invoice':{companyId:'company',customerId:'customer',customerUserId:'homeowner',email:'homeowner@example.test',
    status:'open',currency:'usd',totalAmountCents:10000,amountPaidCents:0,amountDueCents:10000,writeOffAmountCents:0,
    updatedAt:now,lineItems:[{id:'service',name:'Pool service',quantity:1,unitAmountCents:10000,totalAmountCents:10000,metadata:{source:'accepted'}}]},
});
const request = extra => ({auth,data:{companyId:'company',invoiceId:'invoice',requestId:'receipt-once',action:'recordPayment',
  payment:{amountCents:2500,method:'check',referenceNumber:'CHECK-1',memo:'Received offline',receivedAtMillis:now.getTime()-86400000},...extra}});
function fixture(seed=records()) {
  const db=new MemoryFirestore(seed), sessions=new Map(),calls=[];
  const stripe={accounts:{retrieve:async()=>({charges_enabled:true})},checkout:{sessions:{
    create:async(params,options)=>{calls.push({type:'create',params,options});if(sessions.has(options.idempotencyKey))return sessions.get(options.idempotencyKey);
      const session={...params,id:`cs_${sessions.size+1}`,url:'https://checkout.stripe.com/local',status:'open',payment_status:'unpaid',amount_total:params.line_items[0].price_data.unit_amount,currency:'usd',payment_intent:`pi_${sessions.size+1}`};sessions.set(options.idempotencyKey,session);return session;},
    retrieve:async id=>{calls.push({type:'retrieve',id});return [...sessions.values()].find(s=>s.id===id);},
    expire:async id=>{calls.push({type:'expire',id});const s=[...sessions.values()].find(s=>s.id===id);if(s.status==='complete')throw Error('Payment already completed');s.status='expired';return s;},
  }},paymentIntents:{retrieve:async()=>({latest_charge:{receipt_url:'https://pay.stripe.com/local'}})}};
  return {db,stripe,sessions,calls,worker:createSalesInvoiceCommands(db,()=>stripe,()=>now),portal:createCustomerPortalBilling(db,stripe,()=>now)};
}
const paymentRows = f => [...f.db.records].filter(([p])=>p.startsWith('salesPayments/'));
const invoice = f => f.db.records.get('salesInvoices/invoice');
const start = f => f.portal.startInvoiceCheckout({auth:{uid:'homeowner',token:{email_verified:true}},data:{invoiceId:'invoice',returnUrl:'https://dripdrop-poolapp.com/client/billing/invoices/invoice'}});

test('manual receipt reversal preserves original gross and audit history; retries cannot reverse twice',async()=>{
 const f=fixture(),posted=await f.worker.manage(request());
 const req=request({requestId:'reverse-once',action:'reversePayment',adjustment:{paymentId:posted.paymentId,reason:'Check was entered on the wrong invoice'}});
 await Promise.all([f.worker.manage(req),f.worker.manage(req)]);
 const row=f.db.records.get(`salesPayments/${posted.paymentId}`);
 assert.equal(row.amountCents,2500);assert.equal(row.netAmountCents,0);assert.equal(row.status,'reversed');assert.equal(invoice(f).amountPaidCents,0);assert.equal(invoice(f).amountDueCents,10000);
 await assert.rejects(f.worker.manage(request({...req.data,requestId:'second-reversal'})),{code:'failed-precondition'});
});
test('explicit credits lower collectible debt without inventing received cash and survive later receipts',async()=>{
 const f=fixture(),req=request({requestId:'credit-once',action:'applyCredit',adjustment:{amountCents:2000,reason:'Service credit approved by the owner'}});
 await Promise.all([f.worker.manage(req),f.worker.manage(req)]);assert.equal(invoice(f).amountDueCents,8000);assert.equal(invoice(f).amountPaidCents,0);assert.equal(paymentRows(f).length,0);
 await f.worker.manage(request());assert.equal(invoice(f).amountDueCents,5500);assert.equal(invoice(f).creditAmountCents,2000);
 await assert.rejects(f.worker.manage(request({requestId:'over-credit',action:'applyCredit',adjustment:{amountCents:6000,reason:'Cannot exceed the unpaid balance'}})),{code:'failed-precondition'});
});
test('a processor receipt cannot be reversed as a manual accounting correction',async()=>{
 const f=fixture();f.db.set('salesPayments/stripe',{companyId:'company',invoiceId:'invoice',source:'stripe',amountCents:2500,status:'posted',stripePaymentIntentId:'pi_card'});
 await assert.rejects(f.worker.manage(request({requestId:'reverse-stripe',action:'reversePayment',adjustment:{paymentId:'stripe',reason:'Must use an actual processor refund'}})),{code:'failed-precondition'});
});

test('manual receipt posts atomically once with actual received date, actor and immutable events',async()=>{
 const f=fixture(),req=request(),first=await f.worker.manage(req),saved=paymentRows(f)[0][1];
 const again=await f.worker.manage(req);
 assert.deepEqual(again,first);assert.equal(paymentRows(f).length,1);assert.equal(invoice(f).amountPaidCents,2500);assert.equal(invoice(f).amountDueCents,7500);
 assert.equal(saved.recordedByUserId,'manager');assert.equal(saved.receivedAt.getTime(),now.getTime()-86400000);assert.equal(saved.recordedAt.getTime(),now.getTime());
 assert.equal([...f.db.records.keys()].filter(p=>p.startsWith('salesPaymentEvents/')).length,1);
 assert.equal([...f.db.records.keys()].filter(p=>p.startsWith('salesInvoiceEvents/')).length,1);
 assert.equal(invoice(f).billingMutation,null);
});
test('two tabs retrying one request post one receipt',async()=>{
 const f=fixture();await Promise.all([f.worker.manage(request()),f.worker.manage(request())]);assert.equal(paymentRows(f).length,1);assert.equal(invoice(f).amountPaidCents,2500);
});
test('a request ID cannot be reused for a changed receipt',async()=>{
 const f=fixture();await f.worker.manage(request());const req=request();req.data.payment.amountCents=5000;
 await assert.rejects(f.worker.manage(req),{code:'already-exists'});assert.equal(paymentRows(f).length,1);assert.equal(invoice(f).amountPaidCents,2500);
});
test('reusing a request ID on another invoice cannot overwrite the first payment',async()=>{
 const f=fixture();f.db.set('salesInvoices/other',{...invoice(f)});await f.worker.manage(request());await f.worker.manage(request({invoiceId:'other'}));
 assert.equal(paymentRows(f).length,2);assert.equal(invoice(f).amountPaidCents,2500);assert.equal(f.db.records.get('salesInvoices/other').amountPaidCents,2500);
});
test('ordinary staff, readers, other companies, revoked memberships and profile admins cannot manage billing',async()=>{
 for(const who of ['tech','reader','outsider','revoked','missing-role','profile-admin']){
  const seed=records();seed['users/revoked/userAccess/company']={roleId:'billing',status:'Revoked'};seed['users/missing-role/userAccess/company']={roleId:'missing'};
  seed['users/profile-admin']={accountType:'Admin'};
  const f=fixture(seed),req=request();req.auth={uid:who};await assert.rejects(f.worker.manage(req),{code:'permission-denied'});assert.equal(paymentRows(f).length,0);assert.equal(invoice(f).amountDueCents,10000);
 }
 const f=fixture();await assert.rejects(f.worker.manage({...request(),auth:null}),{code:'unauthenticated'});
 await assert.rejects(f.worker.manage(request({companyId:'other-company'})),{code:'permission-denied'});
});
test('owner and managers with a matching trusted role can manage billing',async()=>{
 for(const who of ['owner','named-manager']){
  const seed=records();seed['users/named-manager/userAccess/company']={roleId:'manager-role',roleName:'Manager',status:'active'};
  seed['companies/company/roles/manager-role']={name:'Manager',permissionIdList:[]};
  const f=fixture(seed),req=request();req.auth={uid:who};await f.worker.manage(req);assert.equal(invoice(f).amountPaidCents,2500);
 }
});
test('a self-written manager label without a trusted matching role cannot grant billing authority',async()=>{
 const seed=records();seed['users/forged-manager/userAccess/company']={roleName:'Manager',status:'active'};
 const f=fixture(seed),req=request();req.auth={uid:'forged-manager'};
 await assert.rejects(f.worker.manage(req),{code:'permission-denied'});
});
test('finance reading and field permissions stay distinct from billing management',async()=>{
 const f=fixture();await requireBillingActor(f.db,'company','reader',{manage:false});
 await assert.rejects(requireBillingActor(f.db,'company','reader'),{code:'permission-denied'});
 assert.equal(await hasActiveCompanyPermission(f.db,'company','tech',['72']),true);assert.equal(await hasActiveCompanyPermission(f.db,'company','tech',['404']),false);
});
test('payment validation rejects zero, negative, fractional, nonfinite, overflow, Stripe methods and invalid dates',async()=>{
 for(const change of [{amountCents:0},{amountCents:-1},{amountCents:1.5},{amountCents:NaN},{amountCents:Infinity},{amountCents:Number.MAX_SAFE_INTEGER},{method:'stripeCard'},{receivedAtMillis:NaN},{receivedAtMillis:Date.UTC(2100,0,1)}]){
  const f=fixture(),req=request();Object.assign(req.data.payment,change);await assert.rejects(f.worker.manage(req),{code:'invalid-argument'});assert.equal(paymentRows(f).length,0);
 }
});
test('excess money and closed/draft invoices cannot receive manual payments',async()=>{
 for(const status of ['paid','void','uncollectible','draft']){
  const f=fixture();f.db.set('salesInvoices/invoice',{status},{merge:true});await assert.rejects(f.worker.manage(request()),{code:'failed-precondition'});assert.equal(paymentRows(f).length,0);
 }
 const f=fixture(),req=request();req.data.payment.amountCents=12500;await assert.rejects(f.worker.manage(req),{code:'failed-precondition'});assert.equal(paymentRows(f).length,0);assert.equal(invoice(f).amountPaidCents,0);
});
test('corrupt saved balances require review instead of silently posting',async()=>{
 const f=fixture();f.db.set('salesInvoices/invoice',{amountDueCents:9999},{merge:true});await assert.rejects(f.worker.manage(request()),{code:'failed-precondition'});assert.equal(paymentRows(f).length,0);
});
test('linked Stripe invoices reject local payment/edit/void/delete operations and independent Checkout',async()=>{
 for(const action of ['recordPayment','void','delete']){
  const f=fixture();f.db.set('salesInvoices/invoice',{stripeInvoiceId:'in_managed'},{merge:true});await assert.rejects(f.worker.manage(request({action})),{code:'failed-precondition'});await assert.rejects(start(f),{code:'failed-precondition'});assert.equal(f.calls.length,0);
 }
});
test('an outstanding checkout is expired before a manual receipt commits',async()=>{
 const f=fixture();await start(f);const session=[...f.sessions.values()][0];await f.worker.manage(request());
 assert.equal(session.status,'expired');assert.equal(invoice(f).amountPaidCents,2500);assert.equal(f.calls.filter(c=>c.type==='expire').length,1);
 await start(f);assert.equal([...f.sessions.values()].at(-1).amount_total,7500);
});
test('completed or processing checkout blocks offline recording until authoritative confirmation',async()=>{
 const f=fixture();await start(f);[...f.sessions.values()][0].status='complete';await assert.rejects(f.worker.manage(request()),{code:'failed-precondition'});
 assert.equal(paymentRows(f).length,0);assert.equal(invoice(f).billingMutation,null);
 f.db.set('salesInvoices/invoice',{paymentProcessing:true},{merge:true});await assert.rejects(f.worker.manage(request()),{code:'failed-precondition'});
});
test('a failed Stripe expiration cannot post a receipt or void the invoice',async()=>{
 const f=fixture();await start(f);f.stripe.checkout.sessions.expire=async()=>{throw Error('offline');};
 await assert.rejects(f.worker.manage(request()),/offline/);assert.equal(paymentRows(f).length,0);assert.equal(invoice(f).billingMutation,null);
 f.stripe.checkout.sessions.expire=async id=>{const s=[...f.sessions.values()].find(s=>s.id===id);s.status='expired';return s;};
 await f.worker.manage(request());assert.equal(paymentRows(f).length,1);
});
test('new Checkout cannot start while a company mutation owns the invoice',async()=>{
 const f=fixture();f.db.set('salesInvoices/invoice',{billingMutation:{id:'another',startedAt:now}},{merge:true});
 await assert.rejects(start(f),{code:'aborted'});await assert.rejects(f.worker.manage(request()),{code:'aborted'});assert.equal(f.calls.length,0);
});
test('Checkout created while a company takes its reservation is not published as payable',async()=>{
 const f=fixture(),original=f.stripe.checkout.sessions.create;
 f.stripe.checkout.sessions.create=async(...args)=>{const s=await original(...args);f.db.set('salesInvoices/invoice',{billingMutation:{id:'company-change',startedAt:now}},{merge:true});return s;};
 await assert.rejects(start(f),{code:'aborted'});assert.equal([...f.sessions.values()][0].status,'expired');
});
const edit = f => request({action:'update',requestId:'edit-once',expectedRevision:invoice(f).billingRevision || 0,expectedUpdatedAtMillis:invoice(f).updatedAt.toMillis?.() ?? invoice(f).updatedAt.getTime(),changes:{invoiceNumber:'INV-1',customerName:'Homeowner',email:'homeowner@example.test',status:'open',deliveryMethod:'email',dueDateMillis:null,discountAmountCents:500,taxAmountCents:100,writeOffAmountCents:0,memo:'Updated',lineItems:[{id:'service',name:'Pool service',quantity:2,unitAmountCents:5000}]}});
test('invoice edits derive totals from lines and preserve saved money/provenance',async()=>{
 const f=fixture();await f.worker.manage(request());const req=edit(f);await f.worker.manage(req);assert.equal(invoice(f).totalAmountCents,9600);assert.equal(invoice(f).amountPaidCents,2500);assert.equal(invoice(f).amountDueCents,7100);assert.equal(invoice(f).status,'partiallyPaid');assert.equal(invoice(f).lineItems[0].metadata.source,'accepted');
 await f.worker.manage(req);assert.equal(invoice(f).billingRevision,2);
});
test('stale edits, closed invoices, protected fields and receipt-destroying totals are rejected',async()=>{
 for(const scenario of ['revision','timestamp','closed','identity','too-low']){
  const f=fixture();await f.worker.manage(request());const req=edit(f);
  if(scenario==='revision')req.data.expectedRevision=0;if(scenario==='timestamp')req.data.expectedUpdatedAtMillis=1;
  if(scenario==='closed')f.db.set('salesInvoices/invoice',{status:'paid'},{merge:true});
  if(scenario==='identity')req.data.changes.customerUserId='other';if(scenario==='too-low')req.data.changes.lineItems[0].unitAmountCents=100;
  await assert.rejects(f.worker.manage(req));assert.equal(invoice(f).amountPaidCents,2500);assert.equal(invoice(f).totalAmountCents,10000);
 }
});
test('voiding expires Checkout and preserves an audit record; paid money cannot be voided',async()=>{
 const f=fixture();await start(f);const req=request({action:'void'});await f.worker.manage(req);await f.worker.manage(req);
 assert.equal(invoice(f).status,'void');assert.equal(invoice(f).amountDueCents,0);assert.equal([...f.sessions.values()][0].status,'expired');
 const paid=fixture();await paid.worker.manage(request());await assert.rejects(paid.worker.manage(request({action:'void',requestId:'void-paid'})),{code:'failed-precondition'});
});
test('deletion is limited to unsent invoices without receipts or payment attempts and remains idempotent',async()=>{
 const f=fixture(),req=request({action:'delete'});await f.worker.manage(req);assert.equal(f.db.records.has('salesInvoices/invoice'),false);assert.deepEqual(await f.worker.manage(req),{invoiceId:'invoice',deleted:true});assert.equal([...f.db.records.keys()].filter(p=>p.startsWith('salesInvoiceEvents/')).length,1);
 for(const patch of [{sentAt:now},{emailDelivery:{reviewAccessToken:'token'}},{portalPaymentAttemptId:'prior'}]){
  const f=fixture();f.db.set('salesInvoices/invoice',patch,{merge:true});await assert.rejects(f.worker.manage(request({action:'delete'})));assert.equal(f.db.records.has('salesInvoices/invoice'),true);
 }
});
test('commit failure cannot partially post payment or erase another worker reservation',async()=>{
 const f=fixture();f.db.commitError=Error('commit failed');await assert.rejects(f.worker.manage(request()),/commit failed/);assert.equal(paymentRows(f).length,0);assert.equal(invoice(f).amountPaidCents,0);
 delete f.db.commitError;await f.worker.manage(request());assert.equal(paymentRows(f).length,1);
});

test('legacy membership revocation aliases are enforced on every billing command',async()=>{
 for(const patch of [{accessActive:false},{userAccessStatus:'Revoked'},{accessStatus:'Inactive'},{companyUserStatus:'Past'},{userStatus:'Pending'},{isActive:false},{active:false},{revoked:true}]){
  const seed=records();Object.assign(seed['users/manager/userAccess/company'],patch);const f=fixture(seed);
  await assert.rejects(f.worker.manage(request()),{code:'permission-denied'});assert.equal(paymentRows(f).length,0);
 }
});

test('an expired reservation can be recovered without leaving Checkout permanently blocked',async()=>{
 const f=fixture();f.db.set('salesInvoices/invoice',{billingMutation:{id:'abandoned',startedAt:new Date(now.getTime()-180000)}},{merge:true});
 assert.ok((await start(f)).url);assert.equal(invoice(f).billingMutation,null);
});

test('a failed final commit after session expiration can retry without duplicating receipts',async()=>{
 const f=fixture();await start(f);const expire=f.stripe.checkout.sessions.expire;
 f.stripe.checkout.sessions.expire=async(...args)=>{const result=await expire(...args);f.db.commitError=Error('final commit failed');return result;};
 await assert.rejects(f.worker.manage(request()),/final commit failed/);assert.equal(paymentRows(f).length,0);assert.equal(invoice(f).amountPaidCents,0);
 delete f.db.commitError;await f.worker.manage(request());assert.equal(paymentRows(f).length,1);assert.equal(invoice(f).amountPaidCents,2500);
});
test('an older failed worker cannot erase a newer invoice reservation',async()=>{
 const f=fixture();await start(f);
 f.stripe.checkout.sessions.expire=async()=>{f.db.set('salesInvoices/invoice',{billingMutation:{id:'new-worker',startedAt:now}},{merge:true});throw Error('old worker failed');};
 await assert.rejects(f.worker.manage(request()),/old worker failed/);assert.equal(invoice(f).billingMutation.id,'new-worker');assert.equal(paymentRows(f).length,0);
});
test('zero-priced drafts stay editable and positive receipts fully written off remain paid',async()=>{
 const f=fixture(),req=edit(f);Object.assign(req.data.changes,{status:'draft',discountAmountCents:0,taxAmountCents:0,lineItems:[{id:'service',name:'Price pending',quantity:1,unitAmountCents:0}]});
 await f.worker.manage(req);assert.equal(invoice(f).status,'draft');assert.equal(invoice(f).totalAmountCents,0);
 const second=edit(f);second.data.requestId='finish-draft';second.data.changes.status='open';await f.worker.manage(second);assert.equal(invoice(f).status,'open');
 const paid=fixture();await paid.worker.manage(request());const adjustment=edit(paid);adjustment.data.changes.writeOffAmountCents=7100;
 await paid.worker.manage(adjustment);assert.equal(invoice(paid).status,'paid');assert.equal(invoice(paid).amountPaidCents,2500);assert.equal(invoice(paid).amountDueCents,0);
});
