const {test,after}=require('node:test');const assert=require('node:assert/strict');const admin=require('firebase-admin');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');let memory;
admin.initializeApp({projectId:'demo-billing-acceptance'});const db=admin.firestore();db.collection=(...args)=>memory.collection(...args);db.collectionGroup=(...args)=>memory.collectionGroup(...args);db.runTransaction=(...args)=>memory.runTransaction(...args);
const handlers=require('./stripe/stripeCallableForConnectedAccounts');
function seed(){memory=new MemoryFirestore({'companies/company':{ownerId:'owner',customerBillingEnabled:true,stripeConnectedAccountId:'acct_pool',billingTimeZone:'America/Los_Angeles'},'salesAgreements/agreement':{companyId:'company',customerId:'customer',customerUserId:'home',email:'home@example.test',status:'sent',sourceType:'recurringService',rateType:'perMonth',billingFrequency:'monthly',startDate:new Date('2026-12-01T08:00:00Z'),endDate:new Date('2026-12-31T08:00:00Z'),atWill:false,totalAmountCents:8500,discountAmountCents:2000,taxAmountCents:500,lineItems:[{id:'service',name:'Service',quantity:1,unitAmountCents:10000,totalAmountCents:10000}],emailDelivery:{reviewAccessToken:'secure-link'}},'salesBillingSubscriptions/sbs_agreement':{companyId:'company',customerId:'customer',amountCents:5000,taxAmountCents:99,discountAmountCents:99,billingTimeZone:'UTC',status:'manual'}});}
const payload=()=>({agreementId:'agreement',acceptedTerms:true,acceptedPricing:true,acceptedAutopayNotice:true,signatureName:'Home Owner',createBillingSubscription:true,accessToken:'secure-link',email:'home@example.test'});
test('signed-in acceptance persists the exact new tax/discount snapshot and the company-calendar end date',async()=>{seed();await handlers.acceptSalesServiceAgreement.run(payload(),{auth:{uid:'home',token:{email:'home@example.test',email_verified:true}},rawRequest:{headers:{}}});const sub=memory.records.get('salesBillingSubscriptions/sbs_agreement');assert.equal(sub.taxAmountCents,500);assert.equal(sub.discountAmountCents,2000);assert.equal(sub.billingTimeZone,'America/Los_Angeles');assert.equal(sub.billingEndAt.toMillis(),Date.parse('2027-01-01T08:00:00Z'));assert.equal(require('./billingMath').pricing(sub).totalAmountCents,8500);});
test('signed email acceptance uses the same complete pricing and calendar snapshot',async()=>{seed();await handlers.acceptPublicSalesServiceAgreement.run(payload(),{rawRequest:{headers:{}}});const sub=memory.records.get('salesBillingSubscriptions/sbs_agreement');assert.equal(sub.taxAmountCents,500);assert.equal(sub.discountAmountCents,2000);assert.equal(sub.billingTimeZone,'America/Los_Angeles');assert.equal(require('./billingMath').pricing(sub).totalAmountCents,8500);});
test('acceptance cannot revise a price beneath an already-open Checkout',async()=>{seed();memory.set('salesBillingSubscriptions/sbs_agreement',{checkoutHold:true},{merge:true});await assert.rejects(handlers.acceptSalesServiceAgreement.run(payload(),{auth:{uid:'home',token:{email:'home@example.test',email_verified:true}},rawRequest:{headers:{}}}),{code:'failed-precondition'});assert.equal(memory.records.get('salesAgreements/agreement').status,'sent');});
test('customers cannot accept or decline an unpublished agreement through signed-in or email APIs',async()=>{
 for(const status of ['draft','',undefined])for(const customerUserId of ['home','']){
  seed();memory.set('salesAgreements/agreement',{status,customerUserId},{merge:true});
  const context={auth:{uid:'home',token:{email:'home@example.test',email_verified:true}},rawRequest:{headers:{}}};
  for(const name of ['acceptSalesServiceAgreement','rejectSalesServiceAgreement','acceptPublicSalesServiceAgreement','rejectPublicSalesServiceAgreement']){
   await assert.rejects(handlers[name].run(payload(),context),{code:'permission-denied'});
   assert.equal(memory.records.get('salesAgreements/agreement').status,status,name);
  }
 }
});
test('company owners can still record offline acceptance of a draft',async()=>{
 seed();memory.set('salesAgreements/agreement',{status:'draft'},{merge:true});
 await handlers.acceptSalesServiceAgreement.run({...payload(),acceptanceSource:'customerOffline'},{auth:{uid:'owner',token:{}},rawRequest:{headers:{}}});
 assert.equal(memory.records.get('salesAgreements/agreement').status,'accepted');
});
test('customer acceptance rechecks draft visibility when the agreement changes during the transaction',async()=>{
 seed();memory.beforeCommit=()=>memory.set('salesAgreements/agreement',{status:'draft'},{merge:true});
 await assert.rejects(handlers.acceptSalesServiceAgreement.run(payload(),{auth:{uid:'home',token:{email:'home@example.test',email_verified:true}},rawRequest:{headers:{}}}),{code:'permission-denied'});
 assert.equal(memory.records.get('salesAgreements/agreement').status,'draft');
 assert.equal(memory.records.get('salesAgreements/agreement').acceptedAt,undefined);
});
test('email review and inspection-report links cannot reveal drafts, even with the correct token',async()=>{
 const mail=require('./sendGrid/general');
 for(const status of ['draft','',undefined]){
  seed();memory.set('salesAgreements/agreement',{status},{merge:true});
  for(const name of ['getPublicServiceAgreement','getPublicServiceAgreementInspectionReport'])await assert.rejects(mail[name].run(payload(),{}),{code:'failed-precondition'});
 }
 seed();const result=await mail.getPublicServiceAgreement.run(payload(),{});
 assert.equal(result.agreement.status,'sent');
});
test('signed-in homeowners can request changes with the same response audit as private email review',async()=>{
 seed();const result=await handlers.rejectSalesServiceAgreement.run({agreementId:'agreement',responseType:'changesRequested',rejectionNote:'Please quote service every other week.'},{auth:{uid:'home',token:{email:'home@example.test',email_verified:true}}});
 const agreement=memory.records.get('salesAgreements/agreement');
 assert.equal(result.customerResponseType,'changesRequested');
 assert.equal(agreement.customerResponseType,'changesRequested');
 assert.equal(agreement.rejectedNote,'Please quote service every other week.');
 assert.equal(agreement.rejectedSource,'customerPortal');
 assert.ok(agreement.changesRequestedAt);
 const review=await require('./sendGrid/general').getPublicServiceAgreement.run(payload(),{});
 assert.equal(review.agreement.customerResponseType,'changesRequested');
 assert.equal(review.agreement.rejectedNote,'Please quote service every other week.');
});
test('change requests need an explanatory note, while an ordinary decline still works',async()=>{
 seed();const context={auth:{uid:'home',token:{email:'home@example.test',email_verified:true}}};
 await assert.rejects(handlers.rejectSalesServiceAgreement.run({agreementId:'agreement',responseType:'changesRequested',rejectionNote:' '},context),{code:'invalid-argument'});
 assert.equal(memory.records.get('salesAgreements/agreement').status,'sent');
 await handlers.rejectSalesServiceAgreement.run({agreementId:'agreement'},context);
 assert.equal(memory.records.get('salesAgreements/agreement').customerResponseType,'rejected');
 assert.equal(memory.records.get('salesAgreements/agreement').changesRequestedAt,null);
});
after(async()=>admin.app().delete());
