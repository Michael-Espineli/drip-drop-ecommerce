const {onCall}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {billingActor}=require('./billingAccess');
const {documentId,fail}=require('./companyActor');
const {pricing,key,millis,hash}=require('./billingMath');
const {billingPeriod}=require('./billingCalendar');

function eligibility(subscription,now,scheduled=false){
  if(subscription.manualBillingEnabled!==true||subscription.autopayEnabled===true||subscription.billingCollectionMethod==='automaticStripe'||subscription.stripeSubscriptionId||subscription.checkoutHold)
    return 'Collection is owned by Stripe or a pending autopay setup. Resolve that setup before manual billing.';
  if(!['active','notstarted','pastdue','pendingpaymentmethod','pendingstripe','pending','manual','draft',''].includes(key(subscription.status)))return 'This subscription is not billable.';
  const date=millis(subscription.manualBillingNextInvoiceAt||subscription.manualBillingNextPeriodStart||subscription.currentPeriodStart||subscription.createdAt);
  if(!date||!Number.isFinite(date))return 'Choose the first billing date before generating invoices.';
  if(scheduled&&date>now.getTime())return 'notDue';
  return '';
}
function createManualRecurringBilling(db,now=()=>new Date(),stripeProvider=()=>require('./stripe/stripeClient').getStripe()){
  async function generate({subscriptionId,companyId,expectedPeriodStartMillis,uid,scheduled=false,memo=''}){
    documentId(subscriptionId,'Billing subscription');
    const ref=db.collection('salesBillingSubscriptions').doc(subscriptionId);
    return db.runTransaction(async tx=>{
      const snap=await tx.get(ref);if(!snap.exists)fail('not-found','Billing subscription not found.');
      const subscription={...snap.data(),id:snap.id};
      if(companyId&&companyId!==subscription.companyId)fail('permission-denied','This subscription belongs to another company.');
      const actor=scheduled?null:await billingActor(db,tx,subscription.companyId,uid);
      const companySnap=await tx.get(db.collection('companies').doc(subscription.companyId));
      const company=companySnap.data()||{};
      if(!companySnap.exists)fail('failed-precondition','Company is unavailable.');
      const period=billingPeriod(subscription,company,now());
      // An operator retries the exact displayed period; it must never advance another period.
      if(!scheduled&&!Number.isSafeInteger(expectedPeriodStartMillis))fail('invalid-argument','Refresh the billing period before generating an invoice.');
      const currentStart=millis(subscription.manualBillingNextPeriodStart||subscription.currentPeriodStart||subscription.agreementSnapshot?.acceptedAt||subscription.createdAt);
      const requestedStart=scheduled?currentStart:expectedPeriodStartMillis;
      const commandRef=ref.collection('manualInvoiceCommands').doc(hash(String(requestedStart)));
      const command=await tx.get(commandRef);
      if(command.exists)return {...command.data().result,created:false};
      if(requestedStart!==currentStart)fail('failed-precondition','The billing period changed. Refresh before generating the next invoice.');
      if(!subscription.customerId)fail('failed-precondition','Choose the customer before generating invoices.');
      const reason=eligibility(subscription,now(),scheduled);
      if(reason){if(scheduled)return {skipped:reason};fail('failed-precondition',reason);}
      const price=pricing(subscription),invoiceRef=db.collection('salesInvoices').doc(period.invoiceId),invoice=await tx.get(invoiceRef);
      if(invoice.exists&&(invoice.data().companyId!==subscription.companyId||invoice.data().billingSubscriptionId!==subscriptionId))fail('failed-precondition','An unrelated invoice uses this billing period identifier.');
      const timestamp=now();
      const send=scheduled&&subscription.manualBillingAutoSendEnabled===true&&['email','customerPortal'].includes(subscription.invoiceDeliveryMethod||'email');
      const fields={id:invoiceRef.id,companyId:subscription.companyId,companyName:subscription.companyName||company.name||'',customerId:subscription.customerId,
        customerUserId:subscription.customerUserId||null,customerName:subscription.customerName||'',email:subscription.email||'',
        relationshipId:subscription.relationshipId||subscription.customerCompanyRelationshipId||'',customerCompanyRelationshipId:subscription.customerCompanyRelationshipId||subscription.relationshipId||'',
        serviceLocationIds:subscription.serviceLocationIds||[],serviceLocationSnapshots:subscription.serviceLocationSnapshots||[],agreementId:subscription.agreementId||'',jobId:'',billingProfileId:subscription.billingProfileId||'',
        billingSubscriptionId:subscriptionId,stripeConnectedAccountId:company.stripeConnectedAccountId||subscription.stripeConnectedAccountId||'',invoiceNumber:period.invoiceNumber,type:'subscription',sourceType:'manualBillingSubscription',
        status:'open',deliveryMethod:subscription.invoiceDeliveryMethod||'email',billingCollectionMethod:subscription.billingCollectionMethod||'manualUntilAutopay',
        autopayStatus:subscription.autopayStatus||'unavailable',receiptDeliveryMethod:subscription.receiptDeliveryMethod||subscription.invoiceDeliveryMethod||'email',receiptsEnabled:subscription.receiptsEnabled!==false,
        currency:price.currency,lineItems:price.lines,subtotalAmountCents:price.subtotalAmountCents,discountAmountCents:price.discountAmountCents,taxAmountCents:price.taxAmountCents,totalAmountCents:price.totalAmountCents,
        amountPaidCents:0,amountDueCents:price.totalAmountCents,writeOffAmountCents:0,scheduledSendAt:period.invoiceSendAt,billingPeriodStart:period.periodStart,billingPeriodEnd:period.periodEnd,dueDate:period.dueDate,
        memo:String(memo||subscription.manualInvoiceMemo||'').slice(0,5000),recurringManualInvoice:true,manualBilling:{generatedFromSubscriptionId:subscriptionId,periodStartKey:period.invoiceId,autoGenerated:scheduled},createdByUserId:actor?.uid||'scheduled-manual-invoice',createdAt:timestamp,updatedAt:timestamp};
      if(!invoice.exists)tx.set(invoiceRef,fields);
      tx.set(ref,{billingTimeZone:period.timeZone,billingAnchorDay:period.anchorDay,billingSendAnchorDay:period.sendAnchorDay,
        manualBillingLastInvoiceId:period.invoiceId,manualBillingLastInvoiceNumber:period.invoiceNumber,manualBillingLastInvoiceAt:timestamp,
        manualBillingLastPeriodStart:period.periodStart,manualBillingLastPeriodEnd:period.periodEnd,manualBillingLastInvoiceDueDate:period.dueDate,
        manualBillingNextPeriodStart:period.nextPeriodStart,manualBillingNextPeriodEnd:period.nextPeriodEnd,manualBillingNextInvoiceAt:period.nextInvoiceAt,manualBillingNextDueDate:period.nextDueDate,
        manualBillingStatus:'invoiceCreated',manualBillingUpdatedAt:timestamp,updatedAt:timestamp},{merge:true});
      if(send)tx.set(db.collection('billingEmailQueue').doc(period.invoiceId),{companyId:subscription.companyId,invoiceId:period.invoiceId,status:'pending',createdAt:timestamp});
      const result={invoiceId:period.invoiceId,invoiceNumber:period.invoiceNumber,created:!invoice.exists};
      tx.set(commandRef,{createdAt:timestamp,actorUserId:actor?.uid||'scheduler',result});
      return result;
    });
  }
  async function runScheduled(sendEmail){
    let cursor=null,scanned=0,created=0,failed=0;
    do{
      let query=db.collection('salesBillingSubscriptions').where('manualBillingEnabled','==',true).orderBy('__name__').limit(200);
      if(cursor)query=query.startAfter(cursor.id);
      const page=await query.get();
      for(const doc of page.docs){scanned++;try{
        if(doc.data().checkoutHold&&!doc.data().stripeSubscriptionId)await require('./subscriptionCheckout').createSubscriptionCheckout(db,stripeProvider(),now).releaseExpiredHold(doc.ref);
        if((await generate({subscriptionId:doc.id,scheduled:true})).created)created++;
      }catch(error){failed++;console.error('Manual billing generation failed',{subscriptionId:doc.id,error:error.message});}}
      cursor=page.size===200?page.docs.at(-1):null;
    }while(cursor);
    // Email retries never rewind service periods. Ambiguous send outcomes require review.
    const queue=await db.collection('billingEmailQueue').where('status','==','pending').limit(200).get();
    for(const item of queue.docs){
      const claimed=await db.runTransaction(async tx=>{const current=await tx.get(item.ref);if(current.data()?.status!=='pending')return false;tx.set(item.ref,{status:'sending',startedAt:now()},{merge:true});return true;});
      if(!claimed)continue;
      try{const invoice=await db.collection('salesInvoices').doc(item.id).get();if(!invoice.data()?.sentAt)await sendEmail(item.data());await item.ref.set({status:'sent',completedAt:now()},{merge:true});}
      catch(error){failed++;await item.ref.set({status:'reviewRequired',error:String(error.message).slice(0,1000),updatedAt:now()},{merge:true});}
    }
    return {scanned,created,failed};
  }
  return {generate,runScheduled};
}
exports.createManualRecurringBilling=createManualRecurringBilling;
exports.eligibility=eligibility;
exports.createManualSalesSubscriptionInvoice=onCall({cors:true},request=>createManualRecurringBilling(admin.firestore()).generate({subscriptionId:request.data?.billingSubscriptionId,companyId:request.data?.companyId,expectedPeriodStartMillis:request.data?.expectedPeriodStartMillis,memo:request.data?.memo,uid:request.auth?.uid}));
