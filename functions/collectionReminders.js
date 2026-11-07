const {onCall}=require('firebase-functions/v2/https');
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const admin=require('firebase-admin');
const {randomUUID}=require('node:crypto');
const {billingActor}=require('./billingAccess');
const {documentId,fail}=require('./companyActor');
const {millis,invoiceDue,hash,key}=require('./billingMath');
const day=86400000;
const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function eligible(invoice,policy,now){
 if(!policy?.enabled||!invoice||!['open','overdue','partiallypaid'].includes(key(invoice.status))||invoice.stripeInvoiceId||invoice.stripeSubscriptionId||!invoice.sentAt||!invoice.email||!millis(invoice.dueDate)||invoice.paymentProcessing||invoice.billingMutation||invoice.paymentReviewRequired||['pending','sending','reviewRequired'].includes(invoice.collectionReminderState?.status))return false;
 if(now.getTime()-millis(invoice.dueDate)<policy.minimumOverdueDays*day||Number(invoice.collectionReminderCount || 0)>=policy.maximumReminders||invoice.lastCollectionReminderAt&&now.getTime()-millis(invoice.lastCollectionReminderAt)<policy.repeatEveryDays*day)return false;
 try{return invoiceDue(invoice)>0;}catch(_){return false;}
}
function createCollectionReminders(db,{now=()=>new Date(),send,resolveDelivery}={}){
 async function configure(request){
  const data=request.data || {},companyId=documentId(data.companyId,'Company');
  if(typeof data.enabled!=='boolean')fail('invalid-argument','Choose whether collection reminders are enabled.');
  const minimumOverdueDays=data.minimumOverdueDays ?? 7,repeatEveryDays=data.repeatEveryDays ?? 7,maximumReminders=data.maximumReminders ?? 3;
  if(!Number.isInteger(minimumOverdueDays)||minimumOverdueDays<1||minimumOverdueDays>90||!Number.isInteger(repeatEveryDays)||repeatEveryDays<7||repeatEveryDays>90||!Number.isInteger(maximumReminders)||maximumReminders<1||maximumReminders>12)fail('invalid-argument','Choose 1–90 overdue days, at least 7 days between reminders, and 1–12 reminders per invoice.');
  return db.runTransaction(async tx=>{await billingActor(db,tx,companyId,request.auth?.uid);const policy={companyId,enabled:data.enabled,minimumOverdueDays,repeatEveryDays,maximumReminders,updatedAt:now(),updatedByUserId:request.auth.uid};tx.set(db.collection('billingReminderPolicies').doc(companyId),policy);return {enabled:policy.enabled,minimumOverdueDays,repeatEveryDays,maximumReminders};});
 }
 async function reserve(invoiceRef,policy){
  return db.runTransaction(async tx=>{
   const snap=await tx.get(invoiceRef),invoice=snap.data();
   if(invoice?.collectionReminderState?.status==='sending'&&now().getTime()-millis(invoice.collectionReminderState.startedAt)>600000){tx.set(invoiceRef,{collectionReminderState:{...invoice.collectionReminderState,status:'reviewRequired',error:'Delivery outcome is uncertain. Review before sending again.'}},{merge:true});return false;}
   if(invoice?.companyId!==policy.companyId||!eligible(invoice,policy,now()))return false;
   const sequence=Number(invoice.collectionReminderCount || 0)+1,jobId=`reminder_${hash(`${invoiceRef.id}:${sequence}`)}`,jobRef=invoiceRef.collection('collectionReminders').doc(jobId),saved=await tx.get(jobRef);
   if(saved.exists)return false;
   tx.set(jobRef,{companyId:policy.companyId,invoiceId:invoiceRef.id,status:'pending',sequence,createdAt:now()});
   tx.set(invoiceRef,{collectionReminderState:{jobId,status:'pending'}},{merge:true});return true;
  });
 }
 async function run(){
  let policyCursor=null,queued=0,scanned=0;
  do{
   let query=db.collection('billingReminderPolicies').where('enabled','==',true).orderBy('__name__').limit(100);if(policyCursor)query=query.startAfter(policyCursor);
   const policies=await query.get();
   for(const policy of policies.docs){let cursor=null;do{
    let invoices=db.collection('salesInvoices').where('companyId','==',policy.id).orderBy('__name__').limit(200);if(cursor)invoices=invoices.startAfter(cursor);
    const page=await invoices.get();for(const invoice of page.docs){scanned++;if(await reserve(invoice.ref,policy.data()))queued++;}cursor=page.size===200?page.docs.at(-1).id:null;
   }while(cursor);}
   policyCursor=policies.size===100?policies.docs.at(-1).id:null;
  }while(policyCursor);return {queued,scanned};
 }
 async function deliver(invoiceId,jobId){
  const invoiceRef=db.collection('salesInvoices').doc(documentId(invoiceId,'Invoice')),jobRef=invoiceRef.collection('collectionReminders').doc(documentId(jobId,'Reminder'));
  const job=await db.runTransaction(async tx=>{
   const [saved,invoiceSnap]=await Promise.all([tx.get(jobRef),tx.get(invoiceRef)]),value=saved.data(),invoice=invoiceSnap.data();
   if(value?.status!=='pending')return null;
   const [policy,company,settings]=await Promise.all([tx.get(db.collection('billingReminderPolicies').doc(value.companyId)),tx.get(db.collection('companies').doc(value.companyId)),tx.get(db.collection('companies').doc(value.companyId).collection('settings').doc('emailConfiguration'))]);
   const forEligibility={...invoice,collectionReminderState:null};
   if(!company.exists||invoice?.companyId!==value.companyId||invoice.collectionReminderState?.jobId!==jobId||settings.data()?.emailIsOn===false||!eligible(forEligibility,policy.data(),now())){tx.set(jobRef,{status:'canceled',updatedAt:now()},{merge:true});if(invoice?.collectionReminderState?.jobId===jobId)tx.set(invoiceRef,{collectionReminderState:{jobId,status:'canceled'}},{merge:true});return null;}
   const token=invoice.emailDelivery?.reviewAccessToken || randomUUID();
   tx.set(jobRef,{status:'sending',startedAt:now()},{merge:true});tx.set(invoiceRef,{emailDelivery:{...(invoice.emailDelivery || {}),reviewAccessToken:token},collectionReminderState:{jobId,status:'sending',startedAt:now()}},{merge:true});
   return {invoice:{...invoice,token},company:company.data(),settings:settings.data() || {},value};
  });
  if(!job)return;
  try{
   const delivery=await (resolveDelivery || require('./emailDelivery').resolveEmailDeliveryRecipient)(job.invoice.email);
   const base=process.env.APP_BASE_URL || process.env.SALES_INVOICE_BASE_URL || (process.env.GCLOUD_PROJECT==='the-pool-app-dev'?'https://the-pool-app-dev.web.app':'https://dripdrop-poolapp.com');
   const url=new URL(`/customer/invoices/${encodeURIComponent(invoiceId)}`,base);url.searchParams.set('accessToken',job.invoice.token);
   const companyName=job.company.name || 'Your pool company',number=job.invoice.invoiceNumber || invoiceId,amount=new Intl.NumberFormat('en-US',{style:'currency',currency:job.invoice.currency || 'usd'}).format(invoiceDue(job.invoice)/100),fromEmail=process.env.SEND_GRID_FROM_EMAIL || job.settings.fromEmail || 'mespineli@dripdrop-poolapp.com';
   const lines=[`${companyName} payment reminder`,`Invoice ${number} has an outstanding balance of ${amount}.`,'If you have already paid, thank you. Your balance may have changed; view the invoice for current payment status.',`View invoice: ${url}`];
   const message={to:delivery.actualTo,from:{email:fromEmail,name:companyName},replyTo:job.settings.replyToEmail || job.company.email || fromEmail,subject:`Payment reminder — invoice ${number}`,text:lines.join('\n'),html:`<h1>${escape(lines[0])}</h1><p>${escape(lines[1])}</p><p>${escape(lines[2])}</p><a href="${escape(url.toString())}">View invoice</a>`};
   const provider=send || (async message=>{if(!process.env.SEND_GRID_API_KEY?.startsWith('SG.'))throw Error('SendGrid is not configured.');const mail=require('@sendgrid/mail');mail.setApiKey(process.env.SEND_GRID_API_KEY);return mail.send(message);});
   const response=await provider(message);
   await db.runTransaction(async tx=>{const [current,invoice]=await Promise.all([tx.get(jobRef),tx.get(invoiceRef)]);if(current.data()?.status!=='sending')return;tx.set(jobRef,{status:'sent',sentAt:now(),to:delivery.actualTo,intendedTo:delivery.intendedTo,testMode:delivery.testMode,messageId:response?.[0]?.headers?.['x-message-id'] || ''},{merge:true});if(invoice.data()?.collectionReminderState?.jobId===jobId)tx.set(invoiceRef,{collectionReminderCount:job.value.sequence,lastCollectionReminderAt:now(),collectionReminderState:{jobId,status:'sent'}},{merge:true});});
  }catch(error){await jobRef.set({status:'reviewRequired',error:String(error.message).slice(0,1000),updatedAt:now()},{merge:true});await db.runTransaction(async tx=>{const invoice=await tx.get(invoiceRef);if(invoice.data()?.collectionReminderState?.jobId===jobId)tx.set(invoiceRef,{collectionReminderState:{jobId,status:'reviewRequired',error:'Reminder delivery failed or its outcome is uncertain.'}},{merge:true});});}
 }
 return {configure,run,process:deliver};
}
exports.eligible=eligible;
exports.createCollectionReminders=createCollectionReminders;
exports.configureCollectionReminders=onCall({cors:true},request=>createCollectionReminders(admin.firestore()).configure(request));
exports.queueCollectionReminders=onSchedule({schedule:'every day 10:00',timeZone:'America/Los_Angeles',timeoutSeconds:540},()=>createCollectionReminders(admin.firestore()).run());
exports.deliverCollectionReminder=onDocumentWritten({document:'salesInvoices/{invoiceId}/collectionReminders/{jobId}',retry:true},event=>createCollectionReminders(admin.firestore()).process(event.params.invoiceId,event.params.jobId));
