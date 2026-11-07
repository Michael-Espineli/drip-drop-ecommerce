const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const admin=require('firebase-admin');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');
admin.initializeApp({projectId:'demo-part-email'});
const db=new MemoryFirestore({});
admin.firestore().collection=(...args)=>db.collection(...args);
admin.firestore().runTransaction=(...args)=>db.runTransaction(...args);
process.env.SEND_GRID_API_KEY='SG.test.test';process.env.SALES_INVOICE_BASE_URL='https://example.test';
const messages=[];let failure=false;
require('@sendgrid/mail').send=async message=>{if(failure)throw Error('Provider rejected request');messages.push(message);return [{headers:{'x-message-id':'sample-message'}}];};
const {sendSalesInvoiceEmailForAutomation:send}=require('./sendGrid/general');
const {createPartApprovalBilling}=require('./partApprovalBilling');
function fixture(extra={}){
 db.records.clear();messages.length=0;failure=false;
 const records={
  'companies/company':{ownerId:'owner',name:'Pool company'},
  'companies/company/settings/companyWide':{partApprovalAutoSendInvoices:true},
  'companies/company/settings/emailConfiguration':{emailIsOn:true},
  'companies/company/customers/customer':{email:'customer@example.test',customerUserId:'homeowner'},
  'customerPartApprovals/approval':{companyId:'company',customerId:'customer',customerUserId:'homeowner',approvalStatus:'approved',status:'approved',shoppingListItemId:'shopping',itemName:'Seal kit',quantity:'2',plannedUnitPriceCents:2000,plannedTotalPriceCents:4000,paymentPreference:'payNow'},
  'companies/company/shoppingList/shopping':{customerId:'customer',partApprovalRequestId:'approval',status:'Need to Purchase'},
  'featureFlags/feature_flag_012':{enabled:false},...extra,
 };Object.entries(records).forEach(([path,row])=>db.set(path,row));
 return createPartApprovalBilling(db,{sendInvoice:send});
}
test('automatic approved-part email uses the real invoice builder and existing test-recipient routing',async()=>{
 const service=fixture(),r=await service.ensure({companyId:'company',approvalId:'approval'});await service.processEmail(r.queueId);
 assert.equal(messages.length,1);assert.equal(messages[0].to,'mespineli@dripdrop-poolapp.com');
 const invoice=db.records.get(`salesInvoices/${r.invoiceId}`);assert.equal(invoice.status,'open');assert.equal(invoice.emailDelivery.testMode,true);assert.equal(invoice.emailDelivery.intendedTo,'customer@example.test');assert.ok(invoice.emailDelivery.reviewAccessToken);
 assert.equal(db.records.get('customerPartApprovals/approval').invoiced,true);
});
test('company email off leaves a draft and a visible recovery state with no outgoing email',async()=>{
 const service=fixture({'companies/company/settings/emailConfiguration':{emailIsOn:false}}),r=await service.ensure({companyId:'company',approvalId:'approval'});await service.processEmail(r.queueId);
 assert.equal(messages.length,0);assert.equal(db.records.get(`salesInvoices/${r.invoiceId}`).status,'draft');assert.equal(db.records.get('customerPartApprovals/approval').billingAutomationStatus,'emailNeedsReview');
});
test('an explicit Sales resend recovers failed email and syncs source state without another invoice',async()=>{
 const service=fixture(),r=await service.ensure({companyId:'company',approvalId:'approval'});failure=true;await service.processEmail(r.queueId);
 failure=false;await send({companyId:'company',invoiceId:r.invoiceId});await service.syncInvoice(r.invoiceId);
 assert.equal(messages.length,1);assert.equal(db.records.get('customerPartApprovals/approval').billingAutomationStatus,'invoiced');assert.equal(db.records.get(`salesInvoices/${r.invoiceId}`).automationEmailError,'');
});
test('manual send cannot race a fresh automatic claim or send a closed invoice',async()=>{
 const service=fixture(),r=await service.ensure({companyId:'company',approvalId:'approval'});
 db.set(`salesInvoices/${r.invoiceId}`,{automationEmailStatus:'sending',automationDeliveryKey:r.queueId,automationEmailStartedAt:new Date()},{merge:true});
 await assert.rejects(send({companyId:'company',invoiceId:r.invoiceId}),/being sent/);
 db.set(`salesInvoices/${r.invoiceId}`,{automationEmailStatus:'needsReview',status:'void'},{merge:true});
 await assert.rejects(send({companyId:'company',invoiceId:r.invoiceId}),/closed invoice/);assert.equal(messages.length,0);
});
after(()=>admin.app().delete());

test('concurrent manual and automatic sends share one invoice delivery claim',async()=>{
 const service=fixture(),r=await service.ensure({companyId:'company',approvalId:'approval'});
 await Promise.allSettled([send({companyId:'company',invoiceId:r.invoiceId}),service.processEmail(r.queueId)]);
 assert.equal(messages.length,1);
 assert.equal(db.records.get(`salesInvoices/${r.invoiceId}`).status,'open');
});

test('a Stripe-owned recurring draft cannot be emailed before finalization',async()=>{
 const service=fixture(),r=await service.ensure({companyId:'company',approvalId:'approval'});
 db.set(`salesInvoices/${r.invoiceId}`,{stripeInvoiceId:'in_recurring',status:'draft'},{merge:true});
 await assert.rejects(send({companyId:'company',invoiceId:r.invoiceId}),/still preparing/);assert.equal(messages.length,0);
});
