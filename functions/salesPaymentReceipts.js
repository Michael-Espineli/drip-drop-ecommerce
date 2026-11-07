const admin=require('firebase-admin');
const {onCall}=require('firebase-functions/v2/https');
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {billingActor}=require('./billingAccess');
const {documentId,fail}=require('./companyActor');
const {hash,millis}=require('./billingMath');
const {randomUUID}=require('node:crypto');
const posted=row=>row && (row.grossPosted===true || ['posted','partiallyRefunded','refunded','disputed','reversed'].includes(row.status));
const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function createSalesPaymentReceipts(db,{now=()=>new Date(),send,resolveDelivery}={}) {
  async function queue({paymentId,automatic=false,uid,companyId,requestId}) {
    documentId(paymentId,'Payment');
    if(!automatic)documentId(requestId,'Request');
    const paymentRef=db.collection('salesPayments').doc(paymentId);
    return db.runTransaction(async tx=>{
      if(!automatic)await billingActor(db,tx,documentId(companyId,'Company'),uid);
      const paymentSnap=await tx.get(paymentRef),payment=paymentSnap.data();
      if(!posted(payment))return {status:'skipped',reason:'paymentNotPosted'};
      if(!automatic && payment.companyId!==companyId)fail('permission-denied','This payment belongs to another company.');
      const invoiceSnap=await tx.get(db.collection('salesInvoices').doc(documentId(payment.invoiceId,'Invoice'))),invoice=invoiceSnap.data();
      if(!invoice || invoice.companyId!==payment.companyId || invoice.customerId!==payment.customerId)fail('failed-precondition','Payment and invoice ownership need review.');
      const settings=await tx.get(db.collection('companies').doc(payment.companyId).collection('settings').doc('emailConfiguration'));
      if(settings.data()?.emailIsOn===false || invoice.receiptsEnabled===false || payment.receiptsEnabled===false)return {status:'skipped',reason:'emailDisabled'};
      if(automatic && invoice.stripeInvoiceId)return {status:'skipped',reason:'stripeHostedReceipt'};
      if(automatic && !['email',''].includes(payment.receiptDeliveryMethod || invoice.receiptDeliveryMethod || invoice.deliveryMethod || 'email'))return {status:'skipped',reason:'receiptAvailableInPortal'};
      const email=invoice.email || invoice.billingEmail || invoice.customerEmail;
      if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('failed-precondition','Add the customer’s billing email before sending a receipt.');
      const deliveryId=automatic?'automatic':hash(`${uid}:${requestId}`),ref=paymentRef.collection('receiptDeliveries').doc(deliveryId),existing=await tx.get(ref);
      if(existing.exists)return {status:existing.data().status,paymentId,deliveryId};
      if(['pending','sending'].includes(payment.receiptEmailStatus) && payment.receiptEmailDeliveryId)return {status:payment.receiptEmailStatus,paymentId,deliveryId:payment.receiptEmailDeliveryId};
      if(!invoice.emailDelivery?.reviewAccessToken)tx.set(invoiceSnap.ref,{emailDelivery:{...(invoice.emailDelivery || {}),reviewAccessToken:randomUUID()}},{merge:true});
      tx.set(ref,{companyId:payment.companyId,paymentId,invoiceId:payment.invoiceId,status:'pending',automatic,requestedByUserId:uid || 'paymentReceiptAutomation',createdAt:now()});
      tx.set(paymentRef,{receiptEmailStatus:'pending',receiptEmailDeliveryId:deliveryId},{merge:true});
      return {status:'queued',paymentId,deliveryId};
    });
  }
  async function deliver(paymentId,deliveryId) {
    const paymentRef=db.collection('salesPayments').doc(documentId(paymentId,'Payment')),ref=paymentRef.collection('receiptDeliveries').doc(documentId(deliveryId,'Delivery'));
    const job=await db.runTransaction(async tx=>{
      const [delivery,paymentSnap]=await Promise.all([tx.get(ref),tx.get(paymentRef)]),value=delivery.data(),payment=paymentSnap.data();
      if(!value)return null;
      if(value.status==='sending' && now().getTime()-millis(value.startedAt)>600000){tx.set(ref,{status:'reviewRequired',error:'Delivery outcome is uncertain. Review before sending another receipt.',updatedAt:now()},{merge:true});tx.set(paymentRef,{receiptEmailStatus:'reviewRequired'},{merge:true});return null;}
      if(value.status!=='pending')return null;
      const invoice=await tx.get(db.collection('salesInvoices').doc(value.invoiceId)),company=await tx.get(db.collection('companies').doc(value.companyId)),settings=await tx.get(company.ref.collection('settings').doc('emailConfiguration'));
      if(!posted(payment) || !invoice.exists || !company.exists || payment.companyId!==value.companyId || invoice.data().companyId!==value.companyId || payment.invoiceId!==value.invoiceId || invoice.data().customerId!==payment.customerId)fail('failed-precondition','Receipt ownership changed before delivery.');
      if(settings.data()?.emailIsOn===false || invoice.data().receiptsEnabled===false || payment.receiptsEnabled===false){tx.set(ref,{status:'canceled',updatedAt:now()},{merge:true});tx.set(paymentRef,{receiptEmailStatus:'canceled'},{merge:true});return null;}
      tx.set(ref,{status:'sending',startedAt:now()},{merge:true});tx.set(paymentRef,{receiptEmailStatus:'sending'},{merge:true});
      return {payment,invoice:invoice.data(),company:company.data(),settings:settings.data() || {}};
    });
    if(!job)return;
    try {
      const email=job.invoice.email || job.invoice.billingEmail || job.invoice.customerEmail;
      if(!email)throw Error('The customer billing email is missing.');
      const delivery=await (resolveDelivery || require('./emailDelivery').resolveEmailDeliveryRecipient)(email);
      const currency=job.payment.currency || job.invoice.currency || 'usd',money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency}).format(cents/100);
      const gross=Number(job.payment.amountCents),returned=Number(job.payment.refundedAmountCents || 0),reversed=Number(job.payment.reversedAmountCents || 0),net=Math.max(0,gross-returned-reversed);
      const companyName=job.company.name || job.company.companyName || 'Your pool company',number=job.invoice.invoiceNumber || job.payment.invoiceId;
      const base=process.env.APP_BASE_URL || process.env.SALES_INVOICE_BASE_URL || (process.env.GCLOUD_PROJECT==='the-pool-app-dev'?'https://the-pool-app-dev.web.app':'https://dripdrop-poolapp.com');
      const url=new URL(`/customer/invoices/${encodeURIComponent(job.payment.invoiceId)}`,base);
      if(job.invoice.emailDelivery?.reviewAccessToken)url.searchParams.set('accessToken',job.invoice.emailDelivery.reviewAccessToken);
      else url.pathname=`/client/billing/invoices/${encodeURIComponent(job.payment.invoiceId)}`;
      const lines=[`${companyName} payment receipt`,`Invoice ${number}`,`Original payment: ${money(gross)}`,`Refunded: ${money(returned)}`,`Reversed / disputed: ${money(reversed)}`,`Net payment: ${money(net)}`,`Payment status: ${job.payment.status}`,`Method: ${job.payment.method || 'other'}`,`Invoice: ${url}`];
      const fromEmail=process.env.SEND_GRID_FROM_EMAIL || job.settings.fromEmail || 'mespineli@dripdrop-poolapp.com';
      const message={to:delivery.actualTo,from:{email:fromEmail,name:companyName},replyTo:job.settings.replyToEmail || job.company.email || fromEmail,subject:`${companyName} payment receipt — ${number}`,text:lines.join('\n'),html:`<h1>${escape(companyName)} payment receipt</h1>${lines.slice(1,-1).map(line=>`<p>${escape(line)}</p>`).join('')}<p><a href="${escape(url.toString())}">View invoice and payment history</a></p>`};
      const provider=send || (async message=>{if(!process.env.SEND_GRID_API_KEY?.startsWith('SG.'))throw Error('SendGrid is not configured.');const mail=require('@sendgrid/mail');mail.setApiKey(process.env.SEND_GRID_API_KEY);return mail.send(message);});
      const response=await provider(message);
      await db.runTransaction(async tx=>{const saved=await tx.get(ref);if(saved.data()?.status!=='sending')return;tx.set(ref,{status:'sent',sentAt:now(),to:delivery.actualTo,intendedTo:delivery.intendedTo,testMode:delivery.testMode,messageId:response?.[0]?.headers?.['x-message-id'] || ''},{merge:true});tx.set(paymentRef,{receiptEmailStatus:'sent',receiptEmailSentAt:now()},{merge:true});});
    } catch(error) {
      await ref.set({status:'reviewRequired',error:String(error.message).slice(0,1000),updatedAt:now()},{merge:true});await paymentRef.set({receiptEmailStatus:'reviewRequired'},{merge:true});
    }
  }
  async function reviewStalled(){
    let cursor=null,reviewed=0;
    do {
      let query=db.collection('salesPayments').where('receiptEmailStatus','==','sending').orderBy('__name__').limit(200);
      if(cursor)query=query.startAfter(cursor);
      const page=await query.get();
      for(const row of page.docs)await db.runTransaction(async tx=>{
        const paymentSnap=await tx.get(row.ref),payment=paymentSnap.data();
        if(payment?.receiptEmailStatus!=='sending')return;
        const deliveryId=payment.receiptEmailDeliveryId,delivery=deliveryId?await tx.get(row.ref.collection('receiptDeliveries').doc(deliveryId)):null,value=delivery?.data();
        if(value?.status==='sending' && now().getTime()-millis(value.startedAt)<=600000)return;
        const status=value && !['sending','pending'].includes(value.status)?value.status:'reviewRequired';
        if(delivery?.exists && value.status==='sending')tx.set(delivery.ref,{status,error:'Delivery was interrupted. Review the outcome before sending another receipt.',updatedAt:now()},{merge:true});
        tx.set(row.ref,{receiptEmailStatus:status},{merge:true});reviewed++;
      });
      cursor=page.size===200?page.docs.at(-1).id:null;
    } while(cursor);
    return {reviewed};
  }
  return {queue,process:deliver,reviewStalled};
}
exports.createSalesPaymentReceipts=createSalesPaymentReceipts;
exports.sendSalesPaymentReceipt=onCall({cors:true},request=>createSalesPaymentReceipts(admin.firestore()).queue({paymentId:request.data?.paymentId,companyId:request.data?.companyId,requestId:request.data?.requestId,uid:request.auth?.uid}));
exports.queueSalesPaymentReceipt=onDocumentWritten({document:'salesPayments/{paymentId}',retry:true},event=>{
  const before=event.data?.before?.data(),after=event.data?.after?.data();
  if(!posted(after) || posted(before) || after.status!=='posted')return;
  return createSalesPaymentReceipts(admin.firestore()).queue({paymentId:event.params.paymentId,automatic:true});
});
exports.deliverSalesPaymentReceipt=onDocumentWritten({document:'salesPayments/{paymentId}/receiptDeliveries/{deliveryId}',retry:true},event=>createSalesPaymentReceipts(admin.firestore()).process(event.params.paymentId,event.params.deliveryId));
exports.reviewSalesReceiptDeliveries=onSchedule('every 15 minutes',()=>createSalesPaymentReceipts(admin.firestore()).reviewStalled());
