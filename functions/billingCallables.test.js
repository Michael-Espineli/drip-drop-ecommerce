const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const admin=require('firebase-admin');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');
const db=new MemoryFirestore({
 'companies/company':{ownerId:'owner',stripeConnectedAccountId:'acct_company'},
 'companies/company/roles/reader':{permissionIdList:['400']},'companies/company/roles/tech':{permissionIdList:['72']},'companies/company/roles/billing':{permissionIdList:['404','890']},
 'users/reader/userAccess/company':{roleId:'reader'},'users/tech/userAccess/company':{roleId:'tech'},'users/revoked/userAccess/company':{roleId:'billing',status:'revoked'},
 'salesBillingSubscriptions/sub':{companyId:'company',stripeConnectedAccountId:'acct_company',stripeSubscriptionId:'sub_stripe'},
 'users/profile-admin':{accountType:'Admin'},
});
admin.initializeApp({projectId:'demo-billing-callables'});const adminDb=admin.firestore();adminDb.collection=(...args)=>db.collection(...args);adminDb.collectionGroup=(...args)=>db.collectionGroup(...args);adminDb.runTransaction=(...args)=>db.runTransaction(...args);
const connected=require('./stripe/stripeCallableForConnectedAccounts');
const platform=require('./stripe/stripeCallableGeneral');
const mail=require('./sendGrid/general');
test('actual connected-account financial commands reject readers, technicians and revoked members before calling Stripe',async()=>{
 for(const uid of ['reader','tech','revoked'])for(const name of ['cancelSalesBillingSubscription','resumeSalesBillingSubscription','updateSalesBillingSubscriptionStripeItems']){
  await assert.rejects(connected[name].run({companyId:'company',billingSubscriptionId:'sub'},{auth:{uid,token:{}}}),{code:'permission-denied'});
 }
 for(const uid of ['reader','tech','revoked'])await assert.rejects(connected.acceptContract.run({companyId:'company',connectedAccount:'acct_company',customerId:'cus_other',priceId:'price_other'},{auth:{uid,token:{}}}),{code:'permission-denied'});
});
test('actual invoice-email callable does not let finance viewers send invoices',async()=>{
 for(const uid of ['reader','tech','revoked'])await assert.rejects(mail.sendSalesInvoiceEmail.run({companyId:'company',invoiceId:'invoice'},{auth:{uid,token:{}}}),{code:'permission-denied'});
});
test('platform subscription billing requires active subscription-management access rather than finance viewing',async()=>{
 for(const uid of ['reader','tech','revoked'])await assert.rejects(platform.createSubscriptionCheckoutSession.run({auth:{uid,token:{}},data:{companyId:'company',stripePriceId:'price_test',successUrl:'https://dripdrop-poolapp.com/company/settings',cancelUrl:'https://dripdrop-poolapp.com/company/settings'}}),{code:'permission-denied'});
});
test('a self-editable Admin profile cannot create platform Stripe plans',async()=>{
 await assert.rejects(platform.createStripeSubscription.run({name:'Forged plan',amountCents:1},{auth:{uid:'profile-admin',token:{}}}),{code:'permission-denied'});
});
after(async()=>admin.app().delete());
