const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const admin=require('firebase-admin');
const {initializeApp,deleteApp}=require('firebase/app');
const {getFirestore,connectFirestoreEmulator,doc,getDoc,getDocs,setDoc,updateDoc,deleteDoc,collection,query,where,terminate,writeBatch}=require('firebase/firestore');
const projectId='demo-billing-hardening';
if(!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT!==projectId)throw Error('Disposable local billing emulator required.');
admin.initializeApp({projectId});const db=admin.firestore(),clients=[];
function client(uid){const app=initializeApp({projectId,apiKey:'local-test'},uid),store=getFirestore(app);const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');connectFirestoreEmulator(store,host,Number(port),{mockUserToken:{sub:uid,user_id:uid,email:'homeowner@example.test',email_verified:true}});clients.push({app,store});return store;}
const manager=client('manager'),reader=client('reader'),tech=client('tech'),owner=client('owner'),revoked=client('revoked'),homeowner=client('homeowner'),master=client('yRV5Ie18rrUSxT6UkWctPc99lMJ2');
const unpaid={companyId:'company',customerId:'customer',customerUserId:'homeowner',email:'homeowner@example.test',status:'open',totalAmountCents:10000,amountPaidCents:0,amountDueCents:10000,writeOffAmountCents:0,paidAt:null,lastPaymentAt:null,stripeInvoiceId:'',stripePaymentIntentId:'',stripeHostedInvoiceUrl:''};
const seeded=(async()=>{const records={
 'companies/company':{ownerId:'owner'},'companies/foreign':{ownerId:'other-owner'},
 'companies/company/roles/billing':{permissionIdList:['404']},'companies/company/roles/reader':{permissionIdList:['400']},'companies/company/roles/tech':{permissionIdList:['72']},
 'users/manager/userAccess/company':{roleId:'billing',status:'active'},'users/reader/userAccess/company':{roleId:'reader'},'users/tech/userAccess/company':{roleId:'tech'},'users/revoked/userAccess/company':{roleId:'billing',status:'Revoked'},
 'salesInvoices/invoice':unpaid,'salesInvoices/unlinked':{...unpaid,customerUserId:''},
 'salesPayments/payment':{companyId:'company',invoiceId:'invoice',customerUserId:'homeowner',status:'posted',amountCents:10000,stripePaymentIntentId:'pi_example'},
 'salesPaymentEvents/event':{companyId:'company',customerUserId:'homeowner',status:'posted',amountCents:10000},
 'salesInvoiceEvents/change':{companyId:'company',invoiceId:'invoice',action:'update'},
 'salesInvoices/invoice/portalPaymentAttempts/attempt':{status:'open'},'salesInvoices/invoice/companyCommands/command':{status:'complete'},
 'salesBillingSubscriptions/sub':{companyId:'company',customerId:'customer',customerUserId:'homeowner',stripeSubscriptionId:'sub_live',stripeCustomerId:'cus_live',stripeStatus:'active',autopayEnabled:true,manualBillingEnabled:false,billingCollectionMethod:'automaticStripe',amountCents:10000},
 'salesBillingProfiles/profile':{companyId:'company',customerId:'customer',customerUserId:'homeowner',stripeCustomerId:'cus_live'},
};const batch=db.batch();Object.entries(records).forEach(([p,v])=>batch.set(db.doc(p),v));await batch.commit();})();
const denied=work=>assert.rejects(work,error=>error.code==='permission-denied');
test('finance reader, manager, owner and homeowner can read their authorized financial records',async()=>{await seeded;for(const store of [reader,manager,owner,homeowner])await getDoc(doc(store,'salesInvoices/invoice'));await getDoc(doc(homeowner,'salesInvoices/unlinked'));await denied(()=>getDoc(doc(tech,'salesInvoices/invoice')));await denied(()=>getDoc(doc(revoked,'salesInvoices/invoice')));});
test('only a current billing manager can create a consistent unpaid invoice',async()=>{await seeded;await setDoc(doc(manager,'salesInvoices/new-manager'),unpaid);await setDoc(doc(owner,'salesInvoices/new-owner'),unpaid);for(const store of [reader,tech,revoked,homeowner])await denied(()=>setDoc(doc(store,`salesInvoices/new-${clients.indexOf(store)}`),unpaid));});
test('paid balances, processor references, mismatched IDs and forged locks cannot be fabricated on invoice creation',async()=>{await seeded;for(const patch of [{id:'other-invoice'},{status:'paid'},{amountPaidCents:100},{amountDueCents:1},{writeOffAmountCents:1},{stripeInvoiceId:'in_forged'},{stripePaymentIntentId:'pi_forged'},{billingMutation:null},{paidAt:new Date()},{portalPaymentAttemptId:'forged'}])await denied(()=>setDoc(doc(manager,'salesInvoices/forged'),{...unpaid,...patch}));});
test('all invoice balance, ownership, edit, void and delete writes require the server command',async()=>{await seeded;for(const store of [manager,reader,tech,owner,homeowner,master]){await denied(()=>updateDoc(doc(store,'salesInvoices/invoice'),{status:'paid',amountDueCents:0}));await denied(()=>updateDoc(doc(store,'salesInvoices/invoice'),{companyId:'foreign',customerUserId:'other'}));await denied(()=>deleteDoc(doc(store,'salesInvoices/invoice')));}});
test('processor payments and audit events cannot be fabricated, rewritten or deleted even by owners/master',async()=>{await seeded;for(const store of [manager,reader,tech,owner,homeowner,master]){await denied(()=>setDoc(doc(store,'salesPayments/fabricated'),{companyId:'company',status:'posted',amountCents:100000}));for(const path of ['salesPayments/payment','salesPaymentEvents/event','salesInvoiceEvents/change']){await denied(()=>updateDoc(doc(store,path),{amountCents:1}));await denied(()=>deleteDoc(doc(store,path)));}}});
test('private payment attempts and command receipts remain server-only for normal billing users',async()=>{await seeded;for(const store of [manager,owner,homeowner])for(const path of ['salesInvoices/invoice/portalPaymentAttempts/attempt','salesInvoices/invoice/companyCommands/command']){await denied(()=>getDoc(doc(store,path)));await denied(()=>setDoc(doc(store,path),{status:'complete'}));}});
test('manual billing cannot be re-enabled against a Stripe-owned subscription',async()=>{await seeded;await denied(()=>updateDoc(doc(manager,'salesBillingSubscriptions/sub'),{manualBillingEnabled:true,billingCollectionMethod:'manualUntilAutopay'}));await denied(()=>updateDoc(doc(manager,'salesBillingSubscriptions/sub'),{status:'active',amountCents:1}));await denied(()=>updateDoc(doc(manager,'salesBillingSubscriptions/sub'),{companyId:'foreign'}));await denied(()=>updateDoc(doc(manager,'salesBillingProfiles/profile'),{stripeCustomerId:'cus_other'}));await updateDoc(doc(manager,'salesBillingSubscriptions/sub'),{manualInvoiceMemo:'Internal billing note'});});
test('verified unlinked financial queries still work after the write restrictions',async()=>{await seeded;const result=await getDocs(query(collection(homeowner,'salesInvoices'),where('email','==','homeowner@example.test'),where('customerUserId','in',['',null])));assert.equal(result.size,1);assert.equal(result.docs[0].id,'unlinked');});
test('a stale manual-generation batch rolls back its invoice when autopay already owns collection',async()=>{await seeded;const batch=writeBatch(manager);batch.set(doc(manager,'salesInvoices/stale-manual'),unpaid);batch.update(doc(manager,'salesBillingSubscriptions/sub'),{manualBillingEnabled:true,billingCollectionMethod:'manualUntilAutopay'});await denied(()=>batch.commit());assert.equal((await db.doc('salesInvoices/stale-manual').get()).exists,false);});
test('Checkout holds, private attempts, synchronization receipts, and invoice credits cannot be forged',async()=>{
 await seeded;await db.doc('salesBillingSubscriptions/pending').set({companyId:'company',customerId:'customer',customerUserId:'homeowner',checkoutHold:true,checkoutAttemptId:'attempt',amountCents:10000});
 for(const store of [manager,owner,homeowner,master]){
  await denied(()=>updateDoc(doc(store,'salesBillingSubscriptions/pending'),{checkoutHold:false}));
  await denied(()=>updateDoc(doc(store,'salesBillingSubscriptions/pending'),{amountCents:1}));
  for(const path of ['salesBillingSubscriptions/pending/checkoutAttempts/attempt','stripeSyncLocks/lock','stripeSyncEvents/event','salesPaymentAdjustments/forged','billingEmailQueue/forged'])await denied(()=>setDoc(doc(store,path),{companyId:'company',status:'complete'}));
 }
});
test('payouts, transaction reconciliation, and platform subscriptions are readable but server-owned',async()=>{
 await seeded;
 const paths=['companies/company/stripePayouts/po_test','companies/company/stripeBalanceTransactions/txn_test','companies/company/subscriptions/app'];
 for(const path of paths)await db.doc(path).set({companyId:'company',status:'paid',amountCents:10000});
 await getDoc(doc(reader,paths[0]));await getDoc(doc(manager,paths[1]));
 for(const store of [manager,reader,owner,homeowner,master])for(const path of paths){await denied(()=>updateDoc(doc(store,path),{status:'paid',amountCents:1}));await denied(()=>deleteDoc(doc(store,path)));}
 for(const store of [owner,master])await denied(()=>updateDoc(doc(store,'companies/company'),{checkoutHold:false,stripeCustomerId:'cus_forged'}));
});
after(async()=>{for(const {app,store}of clients){await terminate(store);await deleteApp(app);}await admin.app().delete();});
