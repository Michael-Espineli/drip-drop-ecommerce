const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');
const {createPartApprovalBilling}=require('./partApprovalBilling');
const {createRecurringPartCharges,selectSubscription}=require('./recurringPartCharges');
const {createManualRecurringBilling}=require('./manualRecurringBilling');
const {createStripeLifecycle}=require('./stripeLifecycle');
const at=new Date('2026-11-06T19:00:00Z'),c='companies/company',a='customerPartApprovals/approval',s=`${c}/shoppingList/shopping`;
function fixture(stripeMode=false){
 const plan={companyId:'company',customerId:'customer',customerUserId:'homeowner',status:'active',currency:'usd',amountCents:8500,lineItems:[{id:'service',name:'Pool service',quantity:1,unitAmountCents:10000,totalAmountCents:10000}],discountAmountCents:2000,taxAmountCents:500,interval:'month',intervalCount:1,manualBillingEnabled:!stripeMode,manualBillingNextPeriodStart:new Date('2026-11-01'),manualBillingNextInvoiceAt:new Date('2026-11-01'),createdAt:new Date('2026-11-01'),...(stripeMode?{stripeSubscriptionId:'sub_stripe',stripeCustomerId:'cus_customer',stripeConnectedAccountId:'acct_company',stripeStatus:'active',billingCollectionMethod:'automaticStripe',paymentMethodType:'ach'}:{})};
 const db=new MemoryFirestore({[c]:{ownerId:'owner',stripeConnectedAccountId:'acct_company'},[`${c}/customers/customer`]:{customerUserId:'homeowner'},[a]:{companyId:'company',customerId:'customer',customerUserId:'homeowner',approvalStatus:'approved',status:'approved',paymentPreference:'nextBill',nextBillSubscriptionId:'plan',shoppingListItemId:'shopping',itemName:'Seal kit',quantity:'2',plannedUnitPriceCents:1250,plannedTotalPriceCents:2500,approvedPricingSnapshot:{quantity:'2',plannedUnitPriceCents:1250,plannedTotalPriceCents:2500}},[s]:{partApprovalRequestId:'approval',customerId:'customer',status:'Delivered'},'salesBillingSubscriptions/plan':plan});
 const part=createPartApprovalBilling(db,{now:()=>at}),recurring=createRecurringPartCharges(db,null,()=>at);
 return {db,plan,part,recurring,stage:()=>part.ensure({companyId:'company',approvalId:'approval'}),row:path=>db.records.get(path),charges:()=>[...db.records].filter(([path])=>path.startsWith('recurringPartCharges/'))};
}
const request={subscriptionId:'plan',companyId:'company',expectedPeriodStartMillis:new Date('2026-11-01').getTime(),uid:'owner'};
test('next bill waits for delivery, then queues one approved-price charge without a separate invoice or email',async()=>{
 const f=fixture();f.db.set(s,{status:'Purchased'},{merge:true});assert.equal((await f.stage()).status,'waiting');assert.equal(f.charges().length,0);
 f.db.set(s,{status:'Delivered'},{merge:true});const first=await f.stage();await f.stage();assert.equal(first.status,'queued');assert.equal(f.charges().length,1);assert.equal(f.charges()[0][1].amountCents,2500);assert.equal(f.row(s).billingAutomationStatus,'awaitingNextBill');assert.equal([...f.db.records.keys()].filter(p=>p.startsWith('salesInvoices/')).length,0);
 assert.equal(f.row(a).fulfillmentStatus,'delivered');f.db.set(s,{status:'Installed'},{merge:true});await f.stage();assert.equal(f.row(a).fulfillmentStatus,'installed');assert.equal(f.charges().length,1);
});
test('manual recurring generation includes parts once, preserves base discounts/tax and does not change future rate',async()=>{
 const f=fixture();await f.stage();const worker=createManualRecurringBilling(f.db,()=>at);
 const [one,two]=await Promise.all([worker.generate(request),worker.generate(request)]);assert.equal(one.invoiceId,two.invoiceId);
 const bill=f.row(`salesInvoices/${one.invoiceId}`);assert.equal(bill.totalAmountCents,11000);assert.equal(bill.subtotalAmountCents,12500);assert.equal(bill.discountAmountCents,2000);assert.equal(bill.taxAmountCents,500);assert.equal(bill.lineItems.length,2);
 assert.equal(f.row('salesBillingSubscriptions/plan').amountCents,8500);await f.recurring.syncInvoice(one.invoiceId);assert.equal(f.row(a).invoiceId,one.invoiceId);assert.equal(f.row(s).status,'Delivered');
 const nextStart=f.row('salesBillingSubscriptions/plan').manualBillingNextPeriodStart.getTime();const next=await worker.generate({...request,expectedPeriodStartMillis:nextStart});assert.equal(f.row(`salesInvoices/${next.invoiceId}`).totalAmountCents,8500);
});
test('a failed manual transaction consumes no charge and retry includes it once',async()=>{
 const f=fixture();await f.stage();const worker=createManualRecurringBilling(f.db,()=>at);f.db.commitError=Error('offline');await assert.rejects(worker.generate(request),/offline/);assert.equal(f.charges()[0][1].status,'pending');delete f.db.commitError;await worker.generate(request);assert.equal(f.charges()[0][1].status,'invoiced');
});
test('missing, ambiguous, foreign and location-mismatched plans cannot silently become separate invoices',async()=>{
 for(const setup of [f=>f.db.records.delete('salesBillingSubscriptions/plan'),f=>{f.db.set('salesBillingSubscriptions/second',f.plan);f.db.set(a,{nextBillSubscriptionId:''},{merge:true});},f=>f.db.set('salesBillingSubscriptions/plan',{customerId:'other'},{merge:true}),f=>{f.db.set(a,{serviceLocationId:'site'},{merge:true});f.db.set('salesBillingSubscriptions/plan',{serviceLocationIds:['different']},{merge:true});}]){
  const f=fixture();setup(f);assert.equal((await f.stage()).status,'needsReview');assert.equal(f.charges().length,0);
 }
});
test('a returned or externally invoiced part is withheld before manual billing',async()=>{
 for(const change of [{returned:true},{manuallyInvoiced:true,invoiceType:'manual'}]){
  const f=fixture();await f.stage();f.db.set(s,change,{merge:true});const bill=await createManualRecurringBilling(f.db,()=>at).generate(request);assert.equal(f.row(`salesInvoices/${bill.invoiceId}`).totalAmountCents,8500);assert.equal(f.charges()[0][1].status,'needsReview');
 }
});
function stripeFixture(){
 const f=fixture(true),items=[];let creates=0,failAfterCreate=false;
 const invoice={id:'in_bill',subscription:'sub_stripe',customer:'cus_customer',billing_reason:'subscription_cycle',currency:'usd',status:'draft',created:at.getTime()/1000+10,total:8500,subtotal:8500,amount_due:8500,amount_remaining:8500,amount_paid:0,lines:{data:[{id:'service',description:'Pool service',quantity:1,amount:8500}]}},sub={id:'sub_stripe',customer:'cus_customer',status:'active',metadata:{salesBillingSubscriptionId:'plan'},items:{data:[{id:'service',current_period_start:at.getTime()/1000,current_period_end:at.getTime()/1000+2592000,price:{id:'price',product:'product'}}]},latest_invoice:'in_bill'};
 const stripe={subscriptions:{retrieve:async()=>structuredClone(sub)},invoices:{retrieve:async()=>structuredClone(invoice)},invoiceItems:{list:async()=>({data:structuredClone(items),has_more:false}),create:async(params,options)=>{
  creates++;assert.equal(options.stripeAccount,'acct_company');assert.ok(options.idempotencyKey);assert.equal(params.invoice,'in_bill');assert.equal(params.discountable,false);assert.equal(params.tax_behavior,'inclusive');
  const item={...params,id:'ii_part'};items.push(item);invoice.lines.data.push({id:'il_part',description:params.description,quantity:1,amount:params.amount,metadata:params.metadata});invoice.total+=params.amount;invoice.subtotal+=params.amount;invoice.amount_due+=params.amount;invoice.amount_remaining+=params.amount;
  if(failAfterCreate){failAfterCreate=false;throw Error('Unknown provider response');}return structuredClone(item);
 }}};
 return {...f,invoice,sub,stripe,items,created:()=>creates,failOnce:()=>{failAfterCreate=true;},event:{id:'evt_created',type:'invoice.created',account:'acct_company',data:{object:{id:'in_bill'}}},worker:createRecurringPartCharges(f.db,stripe,()=>at)};
}
test('Stripe draft recurring invoice receives one part with existing collection method; duplicate events cannot duplicate it',async()=>{
 const f=stripeFixture();await f.stage();const lifecycle=createStripeLifecycle(f.db,f.stripe,()=>at);await lifecycle.handle(f.event);await lifecycle.handle({...f.event,id:'evt_duplicate'});assert.equal(f.created(),1);
 const invoiceId='sinv_in_bill';assert.equal(f.row(`salesInvoices/${invoiceId}`).status,'draft');assert.equal(f.row(`salesInvoices/${invoiceId}`).totalAmountCents,11000);await f.worker.syncInvoice(invoiceId);assert.equal(f.row(a).invoiceStatus,'draft');
 Object.assign(f.invoice,{status:'paid',amount_paid:11000,amount_remaining:0,status_transitions:{paid_at:at.getTime()/1000+20}});await lifecycle.handle({...f.event,id:'evt_paid',type:'invoice.paid'});await f.worker.syncInvoice(invoiceId);assert.equal(f.row(a).invoiceStatus,'paid');assert.equal(f.row('salesPayments/spay_in_bill').method,'stripeAch');assert.equal(f.row('salesBillingSubscriptions/plan').amountCents,8500);
});
test('a Stripe success followed by lost response recovers invoice-item metadata instead of charging twice',async()=>{
 const f=stripeFixture();await f.stage();f.failOnce();await assert.rejects(f.worker.applyStripeInvoice(f.event),/Unknown/);assert.equal(f.charges()[0][1].status,'attaching');await f.worker.applyStripeInvoice(f.event);assert.equal(f.created(),1);assert.equal(f.charges()[0][1].status,'attached');
});
test('parts beyond the first Stripe invoice line page retain their approved-price invoice linkage',async()=>{
 const f=stripeFixture();await f.stage();await f.worker.applyStripeInvoice(f.event);const partLine=structuredClone(f.invoice.lines.data[1]);
 f.invoice.lines={data:[f.invoice.lines.data[0]],has_more:true};let pages=0;
 f.stripe.invoices.listLineItems=async(invoiceId,params,options)=>{pages++;assert.equal(invoiceId,'in_bill');assert.equal(params.starting_after,'service');assert.equal(options.stripeAccount,'acct_company');return{data:[partLine],has_more:false};};
 await createStripeLifecycle(f.db,f.stripe,()=>at).handle(f.event);await f.worker.syncInvoice('sinv_in_bill');
 assert.equal(pages,1);assert.equal(f.row('salesInvoices/sinv_in_bill').lineItems.length,2);assert.equal(f.row(a).invoiceId,'sinv_in_bill');assert.equal(f.row(a).billingAutomationStatus,'nextBillAttached');assert.equal(f.created(),1);
});
test('finalization recovery refreshes invoice items before releasing a reservation',async()=>{
 const f=stripeFixture();await f.stage();f.failOnce();await assert.rejects(f.worker.applyStripeInvoice(f.event),/Unknown/);f.invoice.status='open';
 let lists=0;f.stripe.invoiceItems.list=async()=>({data:++lists===1?[]:structuredClone(f.items),has_more:false});
 await f.worker.applyStripeInvoice(f.event);assert.equal(lists,2);assert.equal(f.created(),1);assert.equal(f.charges()[0][1].status,'attached');assert.equal(f.charges()[0][1].stripeInvoiceId,'in_bill');
});
test('an issued invoice without the approved-price part line cannot mark a reserved part invoiced',async()=>{
 const f=stripeFixture();await f.stage();const [path,charge]=f.charges()[0];f.db.set(path,{...charge,status:'attaching',invoiceId:'sinv_in_bill',stripeInvoiceId:'in_bill'});
 f.db.set('salesInvoices/sinv_in_bill',{companyId:'company',customerId:'customer',billingSubscriptionId:'plan',status:'paid',currency:'usd',lineItems:[{id:'service',totalAmountCents:8500}]});
 await f.worker.syncInvoice('sinv_in_bill');assert.equal(f.charges()[0][1].status,'needsReview');assert.equal(f.row(a).billingAutomationStatus,'needsReview');assert.equal(f.row(a).invoiceId,undefined);assert.equal(f.row(a).invoiced,undefined);assert.equal(f.row(s).invoiceId,undefined);
});
test('finalized, unrelated-customer, proration and cancelled-plan invoices cannot pick up a part',async()=>{
 const f=stripeFixture();await f.stage();f.invoice.status='open';await f.worker.applyStripeInvoice(f.event);assert.equal(f.created(),0);assert.equal(f.charges()[0][1].status,'pending');
 f.invoice.status='draft';f.invoice.customer='cus_wrong';await assert.rejects(f.worker.applyStripeInvoice(f.event),/customer/);assert.equal(f.created(),0);
 f.invoice.customer='cus_customer';f.invoice.billing_reason='subscription_update';assert.equal(await f.worker.applyStripeInvoice(f.event),false);assert.equal(f.created(),0);
 f.invoice.billing_reason='subscription_cycle';f.sub.status='canceled';await assert.rejects(f.worker.applyStripeInvoice(f.event),/collection changed/);assert.equal(f.created(),0);
});
test('a part becoming ready after invoice creation is left for the next recurring invoice',async()=>{
 const f=stripeFixture();await f.stage();f.invoice.created=at.getTime()/1000-10;await f.worker.applyStripeInvoice(f.event);assert.equal(f.created(),0);assert.equal(f.charges()[0][1].status,'pending');
});
test('selection is customer/location scoped and an explicit choice resolves multiple plans',async()=>{
 const f=fixture();f.db.set('salesBillingSubscriptions/second',{...f.plan,agreementSnapshot:{title:'Second pool'}});
 const chosen=await selectSubscription({get:ref=>ref.get()},f.db,{companyId:'company',customerId:'customer'},'second');assert.equal(chosen.id,'second');
});

test('late purchase matching inherits the already issued recurring invoice even after the plan ends',async()=>{
 const f=fixture();await f.stage();const bill=await createManualRecurringBilling(f.db,()=>at).generate(request);await f.recurring.syncInvoice(bill.invoiceId);
 f.db.set('salesBillingSubscriptions/plan',{status:'canceled'},{merge:true});f.db.set(`${c}/purchasedItems/purchase`,{shoppingListItemId:'shopping',customerId:'customer'});f.db.set(s,{purchasedItem:'purchase'},{merge:true});await f.stage();assert.equal(f.row(`${c}/purchasedItems/purchase`).invoiceId,bill.invoiceId);
});
test('stopping a service plan surfaces pending approved parts for review without a substitute charge',async()=>{
 const f=fixture();await f.stage();f.db.set('salesBillingSubscriptions/plan',{status:'canceled'},{merge:true});await f.recurring.reviewStoppedPlan('plan');assert.equal(f.charges()[0][1].status,'needsReview');assert.equal(f.row(a).billingAutomationStatus,'needsReview');
});

test('an edited or missing part line is reviewed without requeuing a second charge',async()=>{
 const f=fixture();await f.stage();const bill=await createManualRecurringBilling(f.db,()=>at).generate(request);
 const invoice=f.row(`salesInvoices/${bill.invoiceId}`);invoice.lineItems[1].totalAmountCents=1;f.db.set(`salesInvoices/${bill.invoiceId}`,invoice);await f.recurring.syncInvoice(bill.invoiceId);
 assert.equal(f.row(a).billingAutomationStatus,'needsReview');assert.equal(f.charges()[0][1].status,'needsReview');assert.equal(f.charges()[0][1].invoiceId,bill.invoiceId);
});

test('removing a recurring invoice leaves its part for review and never silently bills it twice',async()=>{
 const f=fixture();await f.stage();const bill=await createManualRecurringBilling(f.db,()=>at).generate(request);await f.recurring.syncInvoice(bill.invoiceId);
 f.db.records.delete(`salesInvoices/${bill.invoiceId}`);await f.recurring.syncInvoice(bill.invoiceId);assert.equal(f.row(a).billingAutomationStatus,'needsReview');assert.equal(f.charges()[0][1].invoiceId,bill.invoiceId);
});
