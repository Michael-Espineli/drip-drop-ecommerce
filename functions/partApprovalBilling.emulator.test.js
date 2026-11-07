const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Requires a demo Firestore emulator. Never run against live data.');
admin.initializeApp({ projectId: 'demo-part-invoices' });
const db = admin.firestore();
const { createPartApprovalBilling } = require('./partApprovalBilling');
const { respondToCustomerPartApproval } = require('./callableFunctions/general');
after(() => admin.app().delete());
const req = (approvalId, preference='payNow', uid='homeowner') => ({ data: { approvalId, action:'approved', paymentPreference:preference }, auth: { uid, token: { email:'homeowner@example.test', email_verified:true } }, rawRequest:{} });
async function seed(id, paymentPreference='payNow') {
  const companyId=`company-${id}`, approvalId=`approval-${id}`;
  await db.doc(`companies/${companyId}`).set({ownerId:'owner',name:'Pool Company'});
  await db.doc(`companies/${companyId}/customers/customer`).set({email:'homeowner@example.test',customerUserId:'homeowner'});
  await db.doc(`customerPartApprovals/${approvalId}`).set({companyId,customerId:'customer',customerUserId:'homeowner',status:'pending',itemName:'Seal kit',quantity:'2',plannedUnitPriceCents:2250,plannedTotalPriceCents:4500,paymentPreference});
  return {companyId,approvalId};
}
test('actual customer-response transaction preserves one shopping identity under concurrency and retries after installation', async()=>{
  const {companyId,approvalId}=await seed('responses');
  const results=await Promise.all([respondToCustomerPartApproval.run(req(approvalId)),respondToCustomerPartApproval.run(req(approvalId))]);
  assert.equal(results[0].shoppingListItemId,results[1].shoppingListItemId);
  assert.equal((await db.doc(`customerPartApprovals/${approvalId}`).get()).data().approvedPricingSnapshot.plannedTotalPriceCents,4500);
  const shoppingId=results[0].shoppingListItemId,shopping=db.doc(`companies/${companyId}/shoppingList/${shoppingId}`);
  await shopping.set({status:'Installed',purchasedItem:'purchase'},{merge:true});
  await respondToCustomerPartApproval.run(req(approvalId));assert.equal((await shopping.get()).data().status,'Installed');assert.equal((await shopping.get()).data().purchasedItem,'purchase');
  assert.equal((await db.collection(`companies/${companyId}/shoppingList`).get()).size,1);
});
test('real transactions create one invoice across approval/shopping events, and later sending synchronizes purchase links', async()=>{
  const {companyId,approvalId}=await seed('invoice');const response=await respondToCustomerPartApproval.run(req(approvalId));
  const shoppingItemId=response.shoppingListItemId, shopping=db.doc(`companies/${companyId}/shoppingList/${shoppingItemId}`);
  await shopping.set({purchasedItem:'purchase'},{merge:true});await db.doc(`companies/${companyId}/purchasedItems/purchase`).set({shoppingListItemId:shoppingItemId,customerId:'customer'});
  await db.doc(`companies/${companyId}/settings/companyWide`).set({partApprovalAutoSendInvoices:true});
  let sends=0;const service=createPartApprovalBilling(db,{sendInvoice:async({invoiceId})=>{sends++;await db.doc(`salesInvoices/${invoiceId}`).set({status:'open',sentAt:new Date()},{merge:true});}});
  const results=await Promise.all([service.ensure({companyId,approvalId}),service.ensure({companyId,shoppingItemId})]);
  assert.equal(results[0].invoiceId,results[1].invoiceId);assert.equal((await db.collection('salesInvoices').where('companyId','==',companyId).get()).size,1);
  await Promise.all(results.map(r=>service.processEmail(r.queueId)));assert.equal(sends,1);
  assert.equal((await db.doc(`companies/${companyId}/purchasedItems/purchase`).get()).data().invoiceStatus,'open');
  assert.equal((await shopping.get()).data().status,'Need to Purchase');
});
test('Request invoice waits for delivery and an outsider cannot approve or create a draft',async()=>{
  const {companyId,approvalId}=await seed('delivery');
  await assert.rejects(respondToCustomerPartApproval.run(req(approvalId,'sendInvoice','outsider')),{code:'permission-denied'});
  const response=await respondToCustomerPartApproval.run(req(approvalId,'sendInvoice'));
  const service=createPartApprovalBilling(db);
  assert.equal((await service.ensure({companyId,approvalId})).status,'waiting');
  await db.doc(`companies/${companyId}/shoppingList/${response.shoppingListItemId}`).set({status:'Delivered'},{merge:true});
  assert.equal((await service.ensure({companyId,approvalId})).status,'created');
  await assert.rejects(service.ensure({companyId,approvalId,manualDraft:true,auth:{uid:'outsider'}}),{code:'permission-denied'});
});

test('an invalid shopping approval link surfaces for review without an endless trigger retry',async()=>{
 const {companyId}=await seed('conflict'),shopping=db.doc(`companies/${companyId}/shoppingList/bad-link`);
 await shopping.set({customerId:'customer',partApprovalRequestId:'approval-responses',status:'Installed'});
 const {reconcileShoppingItemInvoice}=require('./partApprovalBilling');
 await reconcileShoppingItemInvoice.run({params:{companyId,shoppingItemId:'bad-link'},data:{before:null,after:await shopping.get()}});
 assert.equal((await shopping.get()).data().billingAutomationStatus,'needsReview');
 assert.equal((await db.collection('salesInvoices').where('companyId','==',companyId).get()).size,0);
});
