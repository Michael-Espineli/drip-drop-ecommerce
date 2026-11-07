const {test,after}=require('node:test');const assert=require('node:assert/strict');const admin=require('firebase-admin');
if(!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT!=='demo-billing-hardening')throw Error('Disposable billing emulator required.');
admin.initializeApp({projectId:'demo-billing-hardening'});const db=admin.firestore();
const {createSalesSubscriptionCancellation}=require('./salesSubscriptionCancellation');const {createSubscriptionCheckout}=require('./subscriptionCheckout');
const {createSalesPaymentCommands}=require('./salesPaymentCommands');
const {initializeApp,deleteApp}=require('firebase/app');const {getFirestore,connectFirestoreEmulator,doc,updateDoc,setDoc,deleteDoc,getDoc,terminate}=require('firebase/firestore');
const app=initializeApp({projectId:'demo-billing-hardening',apiKey:'test'},'repair-owner'),store=getFirestore(app);const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');connectFirestoreEmulator(store,host,Number(port),{mockUserToken:{sub:'repair-owner',user_id:'repair-owner'}});
const seed=(async()=>{await db.doc('companies/repair-company').set({ownerId:'repair-owner',stripeConnectedAccountId:'acct_pool',customerBillingEnabled:true});await db.doc('salesBillingSubscriptions/repair-sub').set({companyId:'repair-company',customerId:'customer',customerUserId:'home',stripeConnectedAccountId:'acct_pool',stripeCustomerId:'cus_pool',amountCents:10000,currency:'usd',interval:'month',intervalCount:1});})();
test('real transaction cancellation retires one pending Checkout and fences later setup',async()=>{
 await seed;let session;const stripe={accounts:{retrieve:async()=>({charges_enabled:true})},customers:{retrieve:async()=>({id:'cus_pool'})},subscriptions:{list:async()=>({data:[],has_more:false})},checkout:{sessions:{create:async params=>session || (session={...params,id:'cs_repair',status:'open',url:'https://checkout.stripe.com/example'}),retrieve:async()=>session,expire:async()=>{session.status='expired';return session;}}}};
 const start=createSubscriptionCheckout(db,stripe),request={auth:{uid:'home'},data:{companyId:'repair-company',billingSubscriptionId:'repair-sub',successUrl:'https://dripdrop-poolapp.com/client/finance',cancelUrl:'https://dripdrop-poolapp.com/client/finance'}};
 await start.start(request);await createSalesSubscriptionCancellation(db,stripe).cancelPending({companyId:'repair-company',subscriptionId:'repair-sub',uid:'repair-owner'});
 assert.equal(session.status,'expired');assert.equal((await db.doc('salesBillingSubscriptions/repair-sub').get()).data().status,'canceled');await assert.rejects(start.start(request),{code:'failed-precondition'});
});
test('owners cannot forge cancellation/end-date state or write refund-command receipts from the client',async()=>{
 await seed;
 for(const patch of [{checkoutCancellationRequested:false},{checkoutCancellationStatus:'forged'},{billingEndAt:new Date()},{stripeCancelAt:new Date()}])await assert.rejects(updateDoc(doc(store,'salesBillingSubscriptions/repair-sub'),patch),error=>error.code==='permission-denied',JSON.stringify(patch));
 await assert.rejects(setDoc(doc(store,'salesPayments/repair-payment/companyCommands/forged'),{status:'complete'}),error=>error.code==='permission-denied');
 await db.doc('salesBillingSubscriptions/repair-pending-delete').set({companyId:'repair-company',checkoutHold:true});
 await assert.rejects(deleteDoc(doc(store,'salesBillingSubscriptions/repair-pending-delete')),error=>error.code==='permission-denied');
});
test('real transaction accounting reconciliation preserves the protected money fields',async()=>{
 await seed;await db.doc('salesInvoices/repair-invoice').set({companyId:'repair-company',customerId:'customer',status:'paid',totalAmountCents:10000,amountPaidCents:10000,amountDueCents:0});await db.doc('salesPayments/repair-payment').set({companyId:'repair-company',customerId:'customer',invoiceId:'repair-invoice',status:'posted',amountCents:10000,method:'check',source:'manual'});
 const worker=createSalesPaymentCommands(db,{}),request={auth:{uid:'repair-owner'},data:{companyId:'repair-company',paymentId:'repair-payment',requestId:'reconcile-once',action:'markReconciled'}};
 await Promise.all([worker.manage(request),worker.manage(request)]);const row=(await db.doc('salesPayments/repair-payment').get()).data();assert.equal(row.accountingStatus,'reconciled');assert.equal(row.amountCents,10000);
 assert.equal((await db.collection('salesPaymentEvents').where('paymentId','==','repair-payment').get()).size,1);
});
test('real receipt transactions use the Sales invoice and expose delivery status without allowing client delivery writes',async()=>{
 await seed;await db.doc('salesInvoices/repair-invoice').set({email:'home@example.test'},{merge:true});
 let sends=0;const worker=require('./salesPaymentReceipts').createSalesPaymentReceipts(db,{send:async()=>{sends++;return [];},resolveDelivery:async intendedTo=>({intendedTo,actualTo:'internal@example.test',testMode:true})});
 const job=await worker.queue({companyId:'repair-company',paymentId:'repair-payment',requestId:'receipt-once',uid:'repair-owner'});await worker.process('repair-payment',job.deliveryId);await worker.process('repair-payment',job.deliveryId);assert.equal(sends,1);assert.equal((await db.doc('salesPayments/repair-payment').get()).data().receiptEmailStatus,'sent');
 await assert.rejects(getDoc(doc(store,`salesPayments/repair-payment/receiptDeliveries/${job.deliveryId}`)),error=>error.code==='permission-denied');
});
after(async()=>{await terminate(store);await deleteApp(app);await admin.app().delete();});
