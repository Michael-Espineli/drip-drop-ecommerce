const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');
const {createSalesPaymentCommands}=require('./salesPaymentCommands');
const now=new Date('2026-11-06T20:00:00Z');
function fixture(){
 const db=new MemoryFirestore({'companies/company':{ownerId:'owner',stripeConnectedAccountId:'acct_pool'},
  'salesInvoices/invoice':{companyId:'company',customerId:'customer',customerUserId:'home',status:'paid',currency:'usd',totalAmountCents:10000,amountPaidCents:10000,amountDueCents:0},
  'salesPayments/payment':{companyId:'company',customerId:'customer',customerUserId:'home',invoiceId:'invoice',stripeConnectedAccountId:'acct_pool',stripePaymentIntentId:'pi_payment',stripeChargeId:'ch_payment',currency:'usd',amountCents:10000,status:'posted',grossPosted:true}});
 const charge={id:'ch_payment',payment_intent:'pi_payment',status:'succeeded',amount:10000,amount_refunded:0,currency:'usd',application_fee:'fee_platform'},refunds=new Map(),calls=[];
 const stripe={paymentIntents:{retrieve:async()=>({id:'pi_payment',latest_charge:structuredClone(charge)})},charges:{retrieve:async()=>structuredClone(charge)},
  refunds:{create:async(params,options)=>{calls.push({params,options});if(!refunds.has(options.idempotencyKey)){const refund={id:`re_${refunds.size+1}`,charge:charge.id,currency:'usd',amount:params.amount,status:'succeeded',created:Math.floor(now.getTime()/1000)};refunds.set(options.idempotencyKey,refund);charge.amount_refunded+=params.amount;}return structuredClone(refunds.get(options.idempotencyKey));},retrieve:async id=>structuredClone([...refunds.values()].find(r=>r.id===id)),list:async()=>({data:[...refunds.values()],has_more:false})},disputes:{list:async()=>({data:[],has_more:false})}};
 return {db,charge,refunds,calls,stripe,worker:createSalesPaymentCommands(db,stripe,()=>now)};
}
const request=extra=>({auth:{uid:'owner'},data:{companyId:'company',paymentId:'payment',requestId:'refund-once',action:'refund',amountCents:4000,reason:'Customer returned the unused part',...extra}});

test('partial and full Stripe refunds retain gross receipts and audit, reduce net cash, and never recreate debt',async()=>{
 const f=fixture(),first=await f.worker.manage(request());assert.equal(first.status,'succeeded');assert.equal(f.calls[0].options.stripeAccount,'acct_pool');assert.equal(f.calls[0].params.refund_application_fee,true);
 const payment=()=>f.db.records.get('salesPayments/payment'),invoice=()=>f.db.records.get('salesInvoices/invoice');
 assert.equal(payment().amountCents,10000);assert.equal(payment().netAmountCents,6000);assert.equal(payment().status,'partiallyRefunded');assert.equal(invoice().amountDueCents,0);
 assert.deepEqual(await f.worker.manage(request()),first);assert.equal(f.refunds.size,1);assert.equal(f.calls.length,1);
 await f.worker.manage(request({requestId:'refund-rest',amountCents:6000}));assert.equal(payment().status,'refunded');assert.equal(payment().netAmountCents,0);assert.equal(invoice().amountDueCents,0);
 assert.equal([...f.db.records.keys()].filter(p=>p.startsWith('salesPaymentAdjustments/')).length,2);
});

test('a lost Stripe response retries its frozen request without returning the money twice',async()=>{
 const f=fixture(),create=f.stripe.refunds.create;let fail=true;
 f.stripe.refunds.create=async(...args)=>{const refund=await create(...args);if(fail){fail=false;throw Error('Response lost');}return refund;};
 await assert.rejects(f.worker.manage(request()),/Response lost/);await f.worker.manage(request());
 assert.equal(f.refunds.size,1);assert.equal(f.charge.amount_refunded,4000);assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.db.records.get('salesPayments/payment').netAmountCents,6000);
});

test('reconciliation failure after refund acceptance can recover without issuing a second refund',async()=>{
 const f=fixture();let fail=true;const sync=async event=>{if(fail){fail=false;throw Error('Ledger unavailable');}return require('./stripeLifecycle').createStripeLifecycle(f.db,f.stripe,()=>now).handle(event);};
 const worker=createSalesPaymentCommands(f.db,f.stripe,()=>now,sync);
 await assert.rejects(worker.manage(request({amountCents:10000})),/Ledger unavailable/);
 // A webhook may have posted the full refund before the operator retries.
 await require('./stripeLifecycle').createStripeLifecycle(f.db,f.stripe,()=>now).handle({id:'evt_dashboard',type:'charge.refunded',account:'acct_pool',data:{object:{id:'ch_payment'}}});
 assert.equal(f.db.records.get('salesPayments/payment').status,'refunded');await worker.manage(request({amountCents:10000}));assert.equal(f.calls.length,1);assert.equal(f.refunds.size,1);
});

test('a changed retry, over-refund, unsupported receipt, disputed payment, and other-company account cannot move money',async()=>{
 const first=fixture();await first.worker.manage(request());await assert.rejects(first.worker.manage(request({amountCents:2000})),{code:'already-exists'});
 for(const patch of [{amountCents:10001},{amountCents:1.5},{amountCents:-1},{reason:'short'}]){const f=fixture();await assert.rejects(f.worker.manage(request(patch)));assert.equal(f.calls.length,0);}
 for(const patch of [{stripeConnectedAccountId:'acct_foreign'},{status:'processing'},{status:'disputed',reversedAmountCents:10000},{stripePaymentIntentId:'',source:'manual'}]){const f=fixture();f.db.set('salesPayments/payment',patch,{merge:true});await assert.rejects(f.worker.manage(request()),{code:'failed-precondition'});assert.equal(f.calls.length,0);}
});

test('current Stripe refundable balance is checked when a dashboard refund has not synchronized yet',async()=>{
 const f=fixture();f.charge.amount_refunded=9000;await assert.rejects(f.worker.manage(request()),error=>error.code==='failed-precondition' && error.details.safeToRevise===true);assert.equal(f.calls.length,0);assert.equal(f.db.records.get('salesPayments/payment').refundMutation,null);
});

test('readers, revoked users and other companies cannot refund or reconcile payments',async()=>{
 for(const action of ['refund','markReconciled'])for(const uid of ['reader','revoked','outsider']){
  const f=fixture();f.db.set(`users/${uid}/userAccess/company`,{roleId:uid,status:uid==='revoked'?'revoked':'active'});f.db.set(`companies/company/roles/${uid}`,{permissionIdList:uid==='revoked'?['404']:['400']});
  await assert.rejects(f.worker.manage({...request({action}),auth:{uid}}),{code:'permission-denied'});assert.equal(f.calls.length,0);assert.equal(f.db.records.get('salesPayments/payment').accountingStatus,undefined);
 }
});

test('reconciliation is server-authorized, retry-safe, audited, and preserves all receipt amounts',async()=>{
 const f=fixture(),req=request({action:'markReconciled',requestId:'reconcile'});const first=await f.worker.manage(req);assert.deepEqual(await f.worker.manage(req),first);
 const payment=f.db.records.get('salesPayments/payment');assert.equal(payment.accountingStatus,'reconciled');assert.equal(payment.amountCents,10000);assert.equal(payment.reconciledByUserId,'owner');assert.equal(f.calls.length,0);
 assert.equal([...f.db.records.keys()].filter(p=>p.startsWith('salesPaymentEvents/')).length,1);
});

test('refresh repairs an older credited balance using Stripe’s actual receipt without charging or refunding money',async()=>{
 const f=fixture();Object.assign(f.charge,{amount:8000});f.db.set('salesPayments/payment',{amountCents:8000},{merge:true});f.db.set('salesInvoices/invoice',{creditAmountCents:2000,amountPaidCents:8000,amountDueCents:2000,status:'partiallyPaid'},{merge:true});
 await f.worker.manage(request({action:'refreshStripeStatus',requestId:'refresh'}));assert.equal(f.db.records.get('salesInvoices/invoice').amountDueCents,0);assert.equal(f.db.records.get('salesInvoices/invoice').status,'paid');assert.equal(f.refunds.size,0);assert.equal(f.calls.length,0);
});
