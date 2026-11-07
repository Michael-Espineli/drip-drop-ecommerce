const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');
const {createStripeInvoiceCommands}=require('./stripeInvoiceCommands');
const now=new Date('2026-11-06T22:00:00Z');
function fixture(){
 const db=new MemoryFirestore({'companies/company':{ownerId:'owner',stripeConnectedAccountId:'acct_pool'},'salesInvoices/invoice':{companyId:'company',customerId:'customer',stripeCustomerId:'cus_home',stripeInvoiceId:'in_invoice',stripeConnectedAccountId:'acct_pool',totalAmountCents:10000}});
 const invoice={id:'in_invoice',customer:'cus_home',status:'open',amount_paid:0,amount_remaining:10000,total:10000,auto_advance:false,lines:{data:[{id:'il_one'}],has_more:false}},calls=[],results=new Map();let lost=false,syncLost=false;
 const perform=operation=>async(...args)=>{const options=args.at(-1),params=operation==='credit'?args[0]:args[1];calls.push({operation,params,options});if(!results.has(options.idempotencyKey)){const value={id:operation==='credit'?'cn_one':invoice.id,status:operation==='void'?'void':operation==='pay'?'paid':'open',amount_paid:operation==='pay'?invoice.amount_remaining:0,paid_out_of_band:operation==='pay'};results.set(options.idempotencyKey,value);}if(lost){lost=false;throw Error('Lost Stripe response');}return results.get(options.idempotencyKey);};
 const stripe={invoices:{retrieve:async()=>invoice,update:perform('update'),updateLines:perform('lines'),finalizeInvoice:perform('finalize'),voidInvoice:perform('void'),markUncollectible:perform('writeOff'),pay:perform('pay')},creditNotes:{create:perform('credit')},paymentIntents:{retrieve:async()=>({status:'processing'})}};
 const worker=createStripeInvoiceCommands(db,stripe,()=>now,async()=>{if(syncLost){syncLost=false;throw Error('Ledger unavailable');}return true;});
 return {db,invoice,stripe,calls,results,worker,lose:()=>{lost=true;},loseSync:()=>{syncLost=true;}};
}
const request=extra=>({auth:{uid:'owner'},data:{companyId:'company',invoiceId:'invoice',requestId:'once',action:'credit',amountCents:2500,reason:'Skipped service approved credit',expectedTotalAmountCents:10000,...extra}});
test('unpaid credits use connected Stripe credit notes once and retain their reason and audit',async()=>{
 const f=fixture();const result=await f.worker.manage(request());assert.deepEqual(await f.worker.manage(request()),result);assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.stripeAccount,'acct_pool');assert.equal(f.calls[0].params.amount,2500);assert.equal(f.calls[0].params.refund_amount,undefined);assert.equal(f.db.records.get('salesInvoices/invoice').stripeInvoiceMutation,null);
 assert.equal([...f.db.records.values()].filter(r=>r.action==='credit'&&r.result).length,2);
});
test('lost processor responses and ledger failures do not duplicate credit notes or voids',async()=>{
 for(const kind of ['processor','ledger']){const f=fixture();kind==='processor'?f.lose():f.loseSync();await assert.rejects(f.worker.manage(request()),/Lost Stripe response|Ledger unavailable/);await f.worker.manage(request());assert.equal(f.results.size,1);assert.equal(f.calls.length,kind==='processor'?2:1);}
});
test('paid credit amounts, changed invoice totals, pending payments and unowned customers are blocked before Stripe mutation',async()=>{
 for(const patch of [{amount_remaining:1000},{total:11000},{payment_intent:'pi_pending'},{customer:'cus_foreign'},{status:'paid'}]){const f=fixture();Object.assign(f.invoice,patch);await assert.rejects(f.worker.manage(request()));assert.equal(f.calls.length,0);assert.equal(f.db.records.get('salesInvoices/invoice').stripeInvoiceMutation,null);}
});
test('read-only staff and mismatched companies cannot change Stripe invoices',async()=>{
 const f=fixture();f.db.set('users/reader/userAccess/company',{roleId:'reader',status:'active'});f.db.set('companies/company/roles/reader',{permissionIdList:['400']});await assert.rejects(f.worker.manage({...request(),auth:{uid:'reader'}}),{code:'permission-denied'});await assert.rejects(f.worker.manage(request({companyId:'foreign'})));assert.equal(f.calls.length,0);
});
test('external recording requires a full unpaid balance and preserves date, method and reference without charging',async()=>{
 const f=fixture(),payment={amountCents:10000,method:'check',referenceNumber:'Check 123',memo:'Received by office',receivedAtMillis:now.getTime()-86400000};await f.worker.manage(request({action:'recordExternalPayment',payment}));assert.equal(f.calls[0].operation,'pay');assert.deepEqual(f.calls[0].params,{paid_out_of_band:true});assert.equal(f.db.records.get('salesInvoices/invoice').externalPaymentDetails.referenceNumber,'Check 123');
 for(const patch of [{amountCents:5000},{amountCents:10001}]){const next=fixture();await assert.rejects(next.worker.manage(request({action:'recordExternalPayment',payment:{...payment,...patch}})));assert.equal(next.calls.length,0);}
});
test('draft edits require paused finalization and only known Stripe lines; voids reject recorded money',async()=>{
 const f=fixture();Object.assign(f.invoice,{status:'draft',auto_advance:true});const req=request({action:'updateDraftLines',lines:[{id:'il_one',amount:9000,description:'Adjusted service'}]});await assert.rejects(f.worker.manage(req),/Pause draft/);assert.equal(f.calls.length,0);
 f.invoice.auto_advance=false;await f.worker.manage({...req,data:{...req.data,requestId:'edit-paused'}});assert.equal(f.calls[0].operation,'lines');assert.equal(f.calls[0].params.lines[0].amount,9000);
 const paid=fixture();paid.invoice.amount_paid=100;await assert.rejects(paid.worker.manage(request({action:'void'})),/unpaid/);assert.equal(paid.calls.length,0);
});
test('another mutation and changed retry cannot override an uncertain Stripe request',async()=>{
 const f=fixture();f.lose();await assert.rejects(f.worker.manage(request()));await assert.rejects(f.worker.manage(request({requestId:'other',action:'void'})),/original request/);await assert.rejects(f.worker.manage(request({amountCents:2000})),{code:'already-exists'});assert.equal(f.calls.length,1);
});
test('out-of-band paid confirmation accepts Stripe zero payment fields without creating a false balance review',async()=>{
 const f=fixture();f.stripe.invoices.pay=async()=>({id:'in_invoice',status:'paid',paid_out_of_band:true,amount_paid:0,amount_remaining:10000});
 await f.worker.manage(request({action:'recordExternalPayment',payment:{amountCents:10000,method:'check',referenceNumber:'Check 123',receivedAtMillis:now.getTime()}}));
 assert.equal(f.db.records.get('salesInvoices/invoice').paymentReviewRequired,undefined);
 assert.equal(f.db.records.get('salesInvoices/invoice').externalPaymentDetails.amountCents,10000);
});
