const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const admin=require('firebase-admin');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');
const db=new MemoryFirestore({'companies/company':{ownerId:'owner',stripeConnectedAccountId:'acct_company'},'companies/new':{ownerId:'owner',name:'Pool Company'}});
admin.initializeApp({projectId:'demo-billing-readiness'});const adminDb=admin.firestore();adminDb.collection=(...args)=>db.collection(...args);adminDb.runTransaction=(...args)=>db.runTransaction(...args);
let key='sk_live_fixture',created;
const stripe={accounts:{retrieve:async()=>({id:'acct_company',charges_enabled:true,payouts_enabled:true,details_submitted:true,capabilities:{card_payments:'active',transfers:'active',us_bank_account_ach_payments:'pending'},requirements:{},settings:{},external_accounts:{data:[]}}),create:async params=>{created=params;return {id:'acct_new'};}}};
const clientPath=require.resolve('./stripe/stripeClient');require.cache[clientPath]={id:clientPath,filename:clientPath,loaded:true,exports:{createStripeProxy:()=>stripe,getStripe:()=>stripe,getStripeApiKey:()=>key}};
const connected=require('./stripe/stripeCallableForConnectedAccounts'),platform=require('./stripe/stripeCallableGeneral');
test('Accounts v1 without a livemode field report the actual key mode and distinguish pending ACH from active cards',async()=>{
 const request={companyId:'company'},context={auth:{uid:'owner',token:{}}};const live=await connected.verifyConnectedAccountBillingReadiness.run(request,context);assert.equal(live.livemode,true);assert.equal(live.cardPaymentsEnabled,true);assert.equal(live.achPaymentsEnabled,false);assert.equal(live.capabilities.achPayments,'pending');key='sk_test_fixture';const sandbox=await connected.verifyConnectedAccountBillingReadiness.run(request,context);assert.equal(sandbox.livemode,false);assert.equal(sandbox.canRunLiveBilling,false);
});
test('new owner-created US accounts request bank debit capability during onboarding',async()=>{
 await platform.createNewStripeAccount.run({companyId:'new'},{auth:{uid:'owner',token:{email:'owner@example.test'}}});assert.equal(created.country,'US');assert.equal(created.capabilities.us_bank_account_ach_payments.requested,true);assert.equal(db.records.get('companies/new').stripeConnectedAccountId,'acct_new');
});
after(async()=>admin.app().delete());
