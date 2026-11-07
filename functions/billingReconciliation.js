const {onCall}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {billingActor}=require('./billingAccess');
const {documentId,fail}=require('./companyActor');
const {invoiceDue,hash,key}=require('./billingMath');

function invoiceFindings(invoice){
 const findings=[];
 try{
  const due=['void','voided','uncollectible','canceled','cancelled'].includes(key(invoice.status))?0:invoiceDue(invoice);
  if(invoice.amountDueCents!==due)findings.push({kind:'balanceMismatch',savedDueCents:invoice.amountDueCents ?? null,calculatedDueCents:due});
  if(key(invoice.status)==='paid'&&due>0)findings.push({kind:'paidWithOpenBalance'});
 }catch(_){findings.push({kind:'invalidMoney'});}
 if(invoice.paymentReviewRequired)findings.push({kind:'paymentReview',reason:invoice.paymentReviewReason || 'Review payment history'});
 if(invoice.paymentProcessing)findings.push({kind:'processing',reason:'Confirm the original Stripe payment before collecting again'});
 if(invoice.stripeInvoiceMutation)findings.push({kind:'stripeOperationPending',reason:'Confirm the original Stripe invoice operation'});
 if(invoice.collectionReminderState?.status==='reviewRequired')findings.push({kind:'reminderDeliveryReview',reason:'Confirm the original reminder delivery before sending another'});
 return findings;
}
function createBillingReconciliation(db,now=()=>new Date()){
 async function report(request){
  const data=request.data || {},companyId=documentId(data.companyId,'Company');
  await billingActor(db,{get:ref=>ref.get()},companyId,request.auth?.uid,{manage:false});
  let query=db.collection('salesInvoices').where('companyId','==',companyId).orderBy('__name__').limit(100);
  if(data.afterInvoiceId)query=query.startAfter(documentId(data.afterInvoiceId,'Invoice cursor'));
  const [page,payouts,policy]=await Promise.all([query.get(),db.collection('companies').doc(companyId).collection('stripePayouts').orderBy('stripeCreatedAt','desc').limit(20).get(),db.collection('billingReminderPolicies').doc(companyId).get()]);
  return {reminderPolicy:policy.exists?{enabled:policy.data().enabled,minimumOverdueDays:policy.data().minimumOverdueDays,repeatEveryDays:policy.data().repeatEveryDays,maximumReminders:policy.data().maximumReminders}:{enabled:false},scanned:page.size,nextCursor:page.size===100?page.docs.at(-1).id:null,issues:page.docs.map(doc=>({invoiceId:doc.id,invoiceNumber:doc.data().invoiceNumber || doc.id,findings:invoiceFindings(doc.data())})).filter(row=>row.findings.length),payouts:payouts.docs.map(doc=>{const value=doc.data();return {id:doc.id,status:value.status,amountCents:value.amountCents,currency:value.currency || 'usd',reconciliationStatus:value.reconciliationStatus || '',bankDepositVerification:value.bankDepositVerification || null};})};
 }
 async function confirmDeposit(request){
  const data=request.data || {},companyId=documentId(data.companyId,'Company'),payoutId=documentId(data.payoutId,'Payout'),requestId=documentId(data.requestId,'Request');
  const amount=data.amountCents,currency=String(data.currency || '').toLowerCase(),reference=String(data.bankStatementReference || '').trim(),received=data.receivedAtMillis;
  if(data.bankStatementChecked!==true||!Number.isSafeInteger(amount)||amount<=0||!/^[a-z]{3}$/.test(currency)||reference.length<4||reference.length>300||!Number.isSafeInteger(received)||received<Date.UTC(2000,0,1)||received>now().getTime()+86400000)fail('invalid-argument','Confirm the bank statement, matching deposit amount, currency, received date and statement reference.');
  const ref=db.collection('companies').doc(companyId).collection('stripePayouts').doc(payoutId),commandRef=ref.collection('bankDepositConfirmations').doc(hash(requestId)),fingerprint=hash({amount,currency,reference,received});
  return db.runTransaction(async tx=>{
   await billingActor(db,tx,companyId,request.auth?.uid);
   const [saved,command]=await Promise.all([tx.get(ref),tx.get(commandRef)]),payout=saved.data();
   if(command.exists){if(command.data().fingerprint!==fingerprint)fail('already-exists','Retry the original bank confirmation.');return command.data().result;}
   if(!payout||payout.companyId!==companyId||payout.status!=='paid'||payout.amountCents!==amount||(payout.currency || 'usd').toLowerCase()!==currency)fail('failed-precondition','The statement deposit must match a paid Stripe payout’s amount and currency. Refresh the payout before confirming.');
   const verification={status:'confirmed',amountCents:amount,currency,bankStatementReference:reference,receivedAtMillis:received,confirmedAtMillis:now().getTime(),confirmedByUserId:request.auth.uid};
   const result={payoutId,status:'confirmed'};
   tx.set(commandRef,{fingerprint,verification,result,createdAt:now()});tx.set(ref,{bankDepositVerification:verification},{merge:true});return result;
  });
 }
 return {report,confirmDeposit};
}
exports.invoiceFindings=invoiceFindings;
exports.createBillingReconciliation=createBillingReconciliation;
exports.getBillingReconciliationReport=onCall({cors:true},request=>createBillingReconciliation(admin.firestore()).report(request));
exports.confirmStripePayoutDeposit=onCall({cors:true},request=>createBillingReconciliation(admin.firestore()).confirmDeposit(request));
