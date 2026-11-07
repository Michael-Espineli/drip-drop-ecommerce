const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const admin=require('firebase-admin');
const {initializeApp,deleteApp}=require('firebase/app');
const {getFirestore,connectFirestoreEmulator,doc,setDoc,getDoc,updateDoc,terminate}=require('firebase/firestore');
if(!process.env.FIRESTORE_EMULATOR_HOST||process.env.GCLOUD_PROJECT!=='demo-billing-completion')throw Error('Disposable billing-completion emulator required.');
admin.initializeApp({projectId:'demo-billing-completion'});const db=admin.firestore();
const app=initializeApp({projectId:'demo-billing-completion',apiKey:'test'},'billing-completion'),store=getFirestore(app),[host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');connectFirestoreEmulator(store,host,Number(port),{mockUserToken:{sub:'owner',user_id:'owner'}});
const {createSavedCustomerPayments}=require('./savedCustomerPayments'),{createBillingReconciliation}=require('./billingReconciliation'),{createCollectionReminders}=require('./collectionReminders'),{hash}=require('./billingMath');
const profileId=hash('company:customer:acct_pool'),now=new Date();
const seed=(async()=>{await db.doc('companies/company').set({ownerId:'owner',customerBillingEnabled:true,stripeConnectedAccountId:'acct_pool'});await db.doc('salesInvoices/invoice').set({companyId:'company',customerId:'customer',status:'open',currency:'usd',totalAmountCents:10000,amountDueCents:10000});await db.doc(`salesPaymentProfiles/${profileId}`).set({companyId:'company',customerId:'customer',stripeConnectedAccountId:'acct_pool',stripeCustomerId:'cus_home'});await db.doc(`salesPaymentProfiles/${profileId}/methods/pm_card`).set({type:'card',status:'ready'});})();
test('actual Firestore transactions reserve and settle one office charge across concurrent retries',async()=>{
 await seed;let intent,attempts=0;const stripe={paymentMethods:{retrieve:async()=>({customer:'cus_home',type:'card'})},paymentIntents:{create:async params=>{attempts++;return intent || (intent={...params,id:'pi_once',status:'succeeded',created:Math.floor(now.getTime()/1000)});},retrieve:async()=>intent}};
 const request={auth:{uid:'owner'},data:{companyId:'company',invoiceId:'invoice',requestId:'one',paymentMethodId:'pm_card',authorizationConfirmed:true,authorizationReference:'Signed agreement dated today'}};
 const worker=createSavedCustomerPayments(db,stripe);await Promise.all([worker.charge(request),worker.charge(request)]);assert.ok(attempts>=1);assert.equal((await db.doc('salesInvoices/invoice').get()).data().amountPaidCents,10000);assert.equal((await db.collection('salesPayments').where('invoiceId','==','invoice').get()).size,1);
});
test('client owners cannot forge saved methods, charge commands, reminder settings or bank confirmations',async()=>{
 await seed;for(const path of [`salesPaymentProfiles/${profileId}`,`salesPaymentProfiles/${profileId}/methods/pm_card`,'salesInvoices/invoice/officePaymentAttempts/forged','salesInvoices/invoice/stripeCommands/forged','salesInvoices/invoice/collectionReminders/forged','billingReminderPolicies/company','companies/company/stripePayouts/po_paid/bankDepositConfirmations/forged'])await assert.rejects(setDoc(doc(store,path),{status:'complete'}),error=>error.code==='permission-denied',path);
 await assert.rejects(getDoc(doc(store,`salesPaymentProfiles/${profileId}/methods/pm_card`)),error=>error.code==='permission-denied');
 const draft={id:'forged',companyId:'company',customerId:'customer',status:'open',totalAmountCents:10000,amountDueCents:10000};
 await setDoc(doc(store,'salesInvoices/allowed-draft'),{...draft,id:'allowed-draft'});
 for(const patch of [{stripeCreditAmountCents:10000},{officePaymentAttemptId:'forged'},{externalPaymentDetails:{method:'check'}},{collectionReminderCount:100}])await assert.rejects(setDoc(doc(store,'salesInvoices/forged'),{...draft,...patch}),error=>error.code==='permission-denied');
});
test('bank verification is server-owned, exact and transactionally idempotent',async()=>{
 await seed;await db.doc('companies/company/stripePayouts/po_paid').set({companyId:'company',status:'paid',amountCents:10000,currency:'usd'});const worker=createBillingReconciliation(db),request={auth:{uid:'owner'},data:{companyId:'company',payoutId:'po_paid',requestId:'confirm',amountCents:10000,currency:'usd',receivedAtMillis:Date.now(),bankStatementReference:'Statement deposit 123',bankStatementChecked:true}};
 await Promise.all([worker.confirmDeposit(request),worker.confirmDeposit(request)]);assert.equal((await db.doc('companies/company/stripePayouts/po_paid').get()).data().bankDepositVerification.status,'confirmed');await assert.rejects(updateDoc(doc(store,'companies/company/stripePayouts/po_paid'),{bankDepositVerification:{status:'forged'}}),error=>error.code==='permission-denied');
});
test('reminder jobs run real transactions and preserve customer-facing invoice status',async()=>{
 await seed;await db.doc('salesInvoices/reminder').set({companyId:'company',customerId:'customer',status:'partiallyPaid',currency:'usd',totalAmountCents:10000,amountPaidCents:1000,amountDueCents:9000,email:'home@example.test',sentAt:new Date('2026-01-01'),dueDate:new Date('2026-01-02')});let sends=0;
 const worker=createCollectionReminders(db,{send:async()=>{sends++;return [];},resolveDelivery:async intendedTo=>({intendedTo,actualTo:'internal@example.test',testMode:true})});await worker.configure({auth:{uid:'owner'},data:{companyId:'company',enabled:true}});await worker.run();const invoice=(await db.doc('salesInvoices/reminder').get()).data();await worker.process('reminder',invoice.collectionReminderState.jobId);assert.equal(sends,1);assert.equal((await db.doc('salesInvoices/reminder').get()).data().status,'partiallyPaid');
});
after(async()=>{await terminate(store);await deleteApp(app);await admin.app().delete();});
