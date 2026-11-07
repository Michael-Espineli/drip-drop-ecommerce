const {test,after}=require('node:test');const assert=require('node:assert/strict');const admin=require('firebase-admin');
if(!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT!=='demo-next-bill-parts')throw Error('An isolated demo emulator is required.');
admin.initializeApp({projectId:'demo-next-bill-parts'});const db=admin.firestore();
const {respondToCustomerPartApproval,getPartApprovalRecurringOptions}=require('./callableFunctions/general');
const {createPartApprovalBilling}=require('./partApprovalBilling');const {createRecurringPartCharges}=require('./recurringPartCharges');const {createManualRecurringBilling}=require('./manualRecurringBilling');
const {initializeApp,deleteApp}=require('firebase/app');const {getFirestore,connectFirestoreEmulator,doc,setDoc,getDoc,terminate}=require('firebase/firestore');
const clients=[];function client(uid){const app=initializeApp({projectId:'demo-next-bill-parts',apiKey:'test'},uid),store=getFirestore(app);const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');connectFirestoreEmulator(store,host,Number(port),{mockUserToken:{sub:uid,user_id:uid,email:'home@example.test',email_verified:true}});clients.push({app,store});return store;}
const at=new Date('2026-11-06T20:00:00Z');const auth=uid=>({uid,token:{email:'home@example.test',email_verified:true}});
async function seed(name){
 const companyId=`company-${name}`,approvalId=`approval-${name}`,planId=`plan-${name}`,start=new Date('2026-11-01');
 const batch=db.batch();
 for(const [path,data]of Object.entries({[`companies/${companyId}`]:{ownerId:'owner'},[`companies/${companyId}/customers/customer`]:{customerUserId:'homeowner'},[`customerPartApprovals/${approvalId}`]:{companyId,customerId:'customer',customerUserId:'homeowner',status:'pending',itemName:'Pump seal',quantity:'2',plannedUnitPriceCents:1250,plannedTotalPriceCents:2500},[`salesBillingSubscriptions/${planId}`]:{companyId,customerId:'customer',customerUserId:'homeowner',status:'active',manualBillingEnabled:true,currency:'usd',amountCents:10000,lineItems:[{name:'Service',quantity:1,unitAmountCents:10000,totalAmountCents:10000}],interval:'month',intervalCount:1,manualBillingNextPeriodStart:start,manualBillingNextInvoiceAt:start,createdAt:start}}))batch.set(db.doc(path),data);
 await batch.commit();return{companyId,approvalId,planId,start};
}
test('actual customer choice persists the selected recurring plan, waits for delivery and atomically joins one service bill',async()=>{
 const f=await seed('cycle');const options=await getPartApprovalRecurringOptions.run({auth:auth('homeowner'),data:{approvalId:f.approvalId},rawRequest:{}});assert.equal(options.options.length,1);
 const response=await respondToCustomerPartApproval.run({auth:auth('homeowner'),data:{approvalId:f.approvalId,action:'approved',paymentPreference:'nextBill',nextBillSubscriptionId:f.planId},rawRequest:{}});
 const part=createPartApprovalBilling(db,{now:()=>at});assert.equal((await part.ensure({companyId:f.companyId,approvalId:f.approvalId})).status,'waiting');
 const shopping=db.doc(`companies/${f.companyId}/shoppingList/${response.shoppingListItemId}`);await shopping.set({status:'Delivered'},{merge:true});await Promise.all([part.ensure({companyId:f.companyId,approvalId:f.approvalId}),part.ensure({companyId:f.companyId,shoppingItemId:response.shoppingListItemId})]);
 const charges=await db.collection('recurringPartCharges').where('companyId','==',f.companyId).get();assert.equal(charges.size,1);
 const worker=createManualRecurringBilling(db,()=>at),args={companyId:f.companyId,subscriptionId:f.planId,expectedPeriodStartMillis:f.start.getTime(),uid:'owner'};
 const bills=await Promise.all([worker.generate(args),worker.generate(args)]);assert.equal(bills[0].invoiceId,bills[1].invoiceId);const invoice=(await db.doc(`salesInvoices/${bills[0].invoiceId}`).get()).data();assert.equal(invoice.totalAmountCents,12500);
 await createRecurringPartCharges(db,null,()=>at).syncInvoice(bills[0].invoiceId);assert.equal((await shopping.get()).data().invoiceId,bills[0].invoiceId);assert.equal((await db.doc(`customerPartApprovals/${f.approvalId}`).get()).data().nextBillSubscriptionId,f.planId);
});
test('foreign/missing plan selection and unauthorized options fail before approving the customer request',async()=>{
 const f=await seed('access');await assert.rejects(getPartApprovalRecurringOptions.run({auth:auth('outsider'),data:{approvalId:f.approvalId},rawRequest:{}}),{code:'permission-denied'});
 await assert.rejects(respondToCustomerPartApproval.run({auth:auth('homeowner'),data:{approvalId:f.approvalId,action:'approved',paymentPreference:'nextBill',nextBillSubscriptionId:'foreign'},rawRequest:{}}),{code:'failed-precondition'});
 assert.equal((await db.doc(`customerPartApprovals/${f.approvalId}`).get()).data().status,'pending');
});
test('actual rules keep charge amount, customer, state and invoice assignment server-owned, including owner and master accounts',async()=>{
 const f=await seed('rules');await db.doc('recurringPartCharges/protected').set({companyId:f.companyId,customerId:'customer',customerUserId:'homeowner',amountCents:2500,status:'pending'});
 for(const uid of ['owner','homeowner','outsider','yRV5Ie18rrUSxT6UkWctPc99lMJ2']){const store=client(uid);await assert.rejects(setDoc(doc(store,'recurringPartCharges/protected'),{amountCents:1,status:'invoiced',invoiceId:'fake'},{merge:true}),error=>error.code==='permission-denied');}
 await getDoc(doc(clients[1].store,'recurringPartCharges/protected'));await assert.rejects(getDoc(doc(clients[2].store,'recurringPartCharges/protected')),error=>error.code==='permission-denied');
});
after(async()=>{for(const {app,store}of clients){await terminate(store);await deleteApp(app);}await admin.app().delete();});
