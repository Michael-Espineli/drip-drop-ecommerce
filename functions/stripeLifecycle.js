const {randomUUID}=require('node:crypto');
const {id,key,hash,millis,period,invoiceSubscription,paymentIntent,money}=require('./billingMath');
const {fail}=require('./companyActor');

const ownerFields=value=>Object.fromEntries(['companyId','companyName','customerId','customerUserId','customerName','email','agreementId','billingSubscriptionId','relationshipId','customerCompanyRelationshipId'].map(field=>[field,value[field] || '']));
const stamp=seconds=>seconds?new Date(seconds*1000):null;
const status=value=>['active','trialing'].includes(value)?'active':['past_due','unpaid'].includes(value)?'pastDue':['canceled','incomplete_expired'].includes(value)?'canceled':value==='paused'?'paused':'pendingStripe';
const netPayment=row=>['failed','pending','processing','void'].includes(row.status)?0:Math.max(0,Number(row.amountCents || 0)-Number(row.refundedAmountCents || 0)-Number(row.reversedAmountCents || 0));

function createStripeLifecycle(db,stripe,now=()=>new Date()){
 async function leased(event,resource,work){
  const resourceId=hash(`${event.account || 'platform'}:${resource}`),eventId=hash(`${event.account || 'platform'}:${event.id}:${resource}`);
  const lockRef=db.collection('stripeSyncLocks').doc(resourceId),eventRef=db.collection('stripeSyncEvents').doc(eventId),token=randomUUID();
  const reserved=await db.runTransaction(async tx=>{const [lock,receipt]=await Promise.all([tx.get(lockRef),tx.get(eventRef)]);if(receipt.data()?.complete)return {done:true,result:receipt.data().result};if(lock.data()?.token&&millis(lock.data().until)>now().getTime())fail('aborted','This Stripe object is being synchronized; retry this event.');tx.set(lockRef,{token,until:new Date(now().getTime()+120000)});return {done:false};});
  if(reserved.done)return reserved.result;
  try{const prepared=await work({lockRef,token});return await db.runTransaction(async tx=>{
   const lock=await tx.get(lockRef);if(lock.data()?.token!==token)fail('aborted','Stripe synchronization lease changed. Retry this event.');
   const result=await prepared(tx);tx.set(eventRef,{complete:true,stripeEventId:event.id,eventType:event.type,account:event.account || '',resource,result:result ?? null,processedAt:now()});tx.set(lockRef,{token:null,until:now()});return result;
  });}catch(error){await db.runTransaction(async tx=>{const lock=await tx.get(lockRef);if(lock.data()?.token===token)tx.set(lockRef,{token:null,until:now()});}).catch(()=>{});throw error;}
 }
 async function companyFor(account,companyId=''){
  if(companyId){const snap=await db.collection('companies').doc(companyId).get();if(!snap.exists)fail('not-found','Stripe company not found.');const value={...snap.data(),id:snap.id};if(account&&! [value.stripeConnectedAccountId,value.stripeConnectAccountId].includes(account))fail('permission-denied','Stripe event account does not belong to the company.');return {ref:snap.ref,value};}
  if(!account)return null;
  for(const field of ['stripeConnectedAccountId','stripeConnectAccountId']){const result=await db.collection('companies').where(field,'==',account).limit(2).get();if(result.size>1)fail('failed-precondition','A Stripe account is linked to multiple companies.');if(!result.empty)return {ref:result.docs[0].ref,value:{...result.docs[0].data(),id:result.docs[0].id}};}
  return null;
 }
 const options=event=>event.account?{stripeAccount:event.account}:{};
 async function subscriptionRecord(stripeId,metadata={}){
  if(metadata.salesBillingSubscriptionId){const snap=await db.collection('salesBillingSubscriptions').doc(metadata.salesBillingSubscriptionId).get();if(!snap.exists)fail('not-found','Stripe billing subscription record is missing.');return snap;}
  const result=await db.collection('salesBillingSubscriptions').where('stripeSubscriptionId','==',stripeId).limit(2).get();if(result.size>1)fail('failed-precondition','Stripe subscription has duplicate application records.');return result.docs[0] || null;
 }
 async function syncSubscription(event,stripeId,session=null){
  return leased(event,`subscription:${stripeId}`,async()=>{
   let subscription=await stripe.subscriptions.retrieve(stripeId,{},options(event));
   const metadata={...(session?.metadata || {}),...(subscription.metadata || {})};
   const record=await subscriptionRecord(subscription.id,metadata);
   if(!record&&event.account)return async()=>false;
   if(!record&&!metadata.companyId)return async()=>false;
   if(record&&!event.account)fail('permission-denied','Connected subscription event must include its Stripe account.');
   const company=await companyFor(event.account,record?.data().companyId || metadata.companyId);
   let billingEndAt=0;
   if(record){
    const savedPlan={...record.data(),id:record.id};
    if(savedPlan.companyId!==company.value.id || savedPlan.stripeConnectedAccountId!==event.account || savedPlan.stripeCustomerId && savedPlan.stripeCustomerId!==id(subscription.customer))fail('permission-denied','Stripe subscription ownership does not match.');
    const {agreementTerms,readAgreement}=require('./billingAgreementTerms');
    const agreement=await readAgreement({get:ref=>ref.get()},db,savedPlan),terms=agreementTerms(savedPlan,agreement,company.value);
    billingEndAt=terms.endAt;
    if(billingEndAt && !['canceled','incomplete_expired'].includes(subscription.status)){
     if(billingEndAt<=now().getTime())subscription=await stripe.subscriptions.cancel(subscription.id,{},options(event));
     else if(!subscription.cancel_at || subscription.cancel_at>Math.floor(billingEndAt/1000)){
      const existingEnd=subscription.cancel_at_period_end?period(subscription).end:0;
      if(!existingEnd || existingEnd>Math.floor(billingEndAt/1000))subscription=await stripe.subscriptions.update(subscription.id,{cancel_at:Math.floor(billingEndAt/1000),proration_behavior:'none'},options(event));
     }
    }
   }
   const p=period(subscription),item=subscription.items?.data?.[0],customer=id(subscription.customer),active=['active','trialing'].includes(subscription.status);
   let platformPlan=null,legacy=[];
   if(!record){const products=await db.collection('subscriptions').where('stripeProductId','==',id(item?.price?.product)).limit(1).get();platformPlan=products.docs[0];legacy=(await company.ref.collection('subscriptions').where('stripeSubscriptionId','==',subscription.id).get()).docs;}
   const ref=record?.ref || legacy[0]?.ref || company.ref.collection('subscriptions').doc(`com_s_${subscription.id}`);
   return async tx=>{
    const [current,companySnap]=await Promise.all([tx.get(ref),tx.get(company.ref)]),saved=current.data() || {},companyData=companySnap.data() || {};
    if(event.account&&! [companyData.stripeConnectedAccountId,companyData.stripeConnectAccountId].includes(event.account))fail('permission-denied','Stripe company account changed.');
    if(record&&(saved.companyId!==company.value.id || saved.stripeConnectedAccountId!==event.account))fail('permission-denied','Stripe subscription ownership does not match.');
    const savedCustomer=saved.stripeCustomerId || (!record?companyData.stripeCustomerId || companyData.stripeId:'');
    if(savedCustomer&&savedCustomer!==customer)fail('permission-denied','Stripe subscription customer does not match.');
    if(record&&saved.stripeSubscriptionId&&saved.stripeSubscriptionId!==subscription.id&&!['canceled','incomplete_expired'].includes(saved.stripeStatus)){
     tx.set(ref,{billingReviewRequired:true,billingReviewReason:'duplicateStripeSubscriptions',duplicateStripeSubscriptionIds:[...new Set([...(saved.duplicateStripeSubscriptionIds || []),subscription.id])],updatedAt:now()},{merge:true});return true;
    }
    const attemptId=session?.metadata?.paymentAttemptId || metadata.paymentAttemptId;
    const attempt=attemptId?await tx.get((record?ref:company.ref).collection('checkoutAttempts').doc(attemptId)):null;
    if(attemptId&&!attempt?.exists)fail('failed-precondition','Unknown recurring Checkout attempt.');
    const patch={stripeSubscriptionId:subscription.id,stripeCustomerId:customer,stripeStatus:subscription.status,
      currentPeriodStart:stamp(p.start),currentPeriodEnd:stamp(p.end),cancelAtPeriodEnd:!!subscription.cancel_at_period_end,canceledAt:stamp(subscription.canceled_at),
      stripeCancelAt:stamp(subscription.cancel_at),...(billingEndAt?{billingEndAt:new Date(billingEndAt)}:{}),
      stripeLatestInvoiceId:id(subscription.latest_invoice),stripeDefaultPaymentMethodId:id(subscription.default_payment_method),
      status:record?status(subscription.status):subscription.cancel_at_period_end?'pending_cancellation':subscription.status,
      stripeSubscriptionItemId:item?.id || '',stripePriceId:item?.price?.id || '',stripeProductId:id(item?.price?.product),
      checkoutHold:false,checkoutStatus:'synced',stripeSyncedAt:now(),updatedAt:now(),createdAt:saved.createdAt || stamp(subscription.created) || now()};
    if(record){const rail=metadata.paymentMethodType || saved.paymentMethodType || (subscription.default_payment_method?.type==='us_bank_account'?'ach':'card');Object.assign(patch,{stripeConnectedAccountId:event.account,paymentMethodType:rail,stripePaymentMethodType:rail==='ach'?'us_bank_account':'card',applicationFeePercent:subscription.application_fee_percent ?? saved.applicationFeePercent ?? 0,
      billingCollectionMethod:'automaticStripe',autopayStatus:active?'active':status(subscription.status),autopayEnabled:active,
      manualBillingEnabled:false,manualBillingAutoSendEnabled:false,manualBillingStatus:'disabledStripeBillingOwnsCollection',
      nextAction:active?'monitorBilling':status(subscription.status)==='canceled'?'reviewCanceledSubscription':'collectPaymentMethod'});}
    if(record && saved.checkoutCancellationRequested)Object.assign(patch,{status:status(subscription.status)==='canceled'?'canceled':'cancellationPending',autopayStatus:'canceled',autopayEnabled:false,manualBillingEnabled:false,manualBillingAutoSendEnabled:false,nextAction:status(subscription.status)==='canceled'?'reviewCanceledSubscription':'finishCancellation',checkoutHold:status(subscription.status)!=='canceled',checkoutUrl:''});
    else Object.assign(patch,{id:ref.id,dripDropSubscriptionId:platformPlan?.id || saved.dripDropSubscriptionId || '',name:platformPlan?.data()?.name || saved.name || 'DripDrop subscription',description:platformPlan?.data()?.description || saved.description || '',price:platformPlan?.data()?.price ?? saved.price ?? item?.price?.unit_amount ?? 0,started:saved.started || stamp(subscription.created),userId:metadata.userId || saved.userId || '',companyId:company.value.id});
    tx.set(ref,patch,{merge:true});
    if(!record)tx.set(company.ref,{stripeCustomerId:customer,stripeSubscriptionId:subscription.id,stripeStatus:subscription.status,checkoutHold:false,checkoutStatus:'synced',updatedAt:now()},{merge:true});
    if(attempt?.exists)tx.set(attempt.ref,{status:'completed',stripeSubscriptionId:subscription.id,updatedAt:now()},{merge:true});
    if(record&&saved.agreementId)tx.set(db.collection('salesAgreements').doc(saved.agreementId),{billingFlowStatus:patch.status,billingFlowNextAction:patch.nextAction,billingCollectionMethod:patch.billingCollectionMethod,autopayStatus:patch.autopayStatus,manualBillingEnabled:false,manualBillingAutoSendEnabled:false,billingFlowUpdatedAt:now()},{merge:true});
    for(const duplicate of legacy.slice(1))tx.set(duplicate.ref,{status:'duplicate',duplicateOf:ref.id,updatedAt:now()},{merge:true});
    return true;
   };
  });
 }
 async function syncInvoice(event,stripeInvoiceId){
  return leased(event,`invoice:${stripeInvoiceId}`,async()=>{
   const invoice=await stripe.invoices.retrieve(stripeInvoiceId,{},options(event)),subId=invoiceSubscription(invoice);
   if(!subId){if(invoice.billing_reason && !invoice.billing_reason.startsWith('subscription'))return async()=>false;fail('failed-precondition','Stripe invoice subscription shape is unsupported; use a compatible snapshot API version.');}
   await syncSubscription({...event,id:`${event.id}:parent`},subId);
   const sub=await stripe.subscriptions.retrieve(subId,{},options(event)),record=await subscriptionRecord(subId,sub.metadata);
   if(!record){const company=await companyFor('',sub.metadata?.companyId);if(!company||event.account)return async()=>false;
    return async tx=>{const current=await tx.get(company.ref);const customer=current.data()?.stripeCustomerId || current.data()?.stripeId;if(customer&&customer!==id(invoice.customer))fail('permission-denied','Platform invoice customer does not match.');
     const refs=await tx.get(company.ref.collection('subscriptions').where('stripeSubscriptionId','==',subId));
     for(const row of refs.docs)tx.set(row.ref,{...(id(sub.latest_invoice)===invoice.id?{lastPaymentStatus:invoice.status==='paid'?'posted':invoice.status,lastPaid:stamp(invoice.status_transitions?.paid_at),lastInvoiceId:invoice.id}:{}),updatedAt:now()},{merge:true});return {subscriptionId:subId};};
   }
   if(!event.account)fail('permission-denied','Customer invoice event has no connected account.');
   await companyFor(event.account,record.data().companyId);
   const invoiceLines=[...(invoice.lines?.data || [])];let linePage=invoice.lines;
   while(linePage?.has_more){
    const cursor=invoiceLines.at(-1)?.id;
    if(!cursor)fail('failed-precondition','Stripe invoice line pagination is incomplete.');
    linePage=await stripe.invoices.listLineItems(invoice.id,{limit:100,starting_after:cursor},options(event));
    if(!linePage.data?.length)fail('failed-precondition','Stripe invoice lines could not be loaded completely.');
    invoiceLines.push(...linePage.data);
   }
   const invoiceId=`sinv_${invoice.id}`,ref=db.collection('salesInvoices').doc(invoiceId),paymentRef=db.collection('salesPayments').doc(`spay_${invoice.id}`);
   const intentId=paymentIntent(invoice);let charge=null,processorIntent=null;
   if(intentId){processorIntent=await stripe.paymentIntents.retrieve(intentId,{expand:['latest_charge.balance_transaction']},options(event));charge=typeof processorIntent.latest_charge==='object'?processorIntent.latest_charge:null;}
   return async tx=>{
    const [subscriptionSnap,current,paymentSnap,receipts]=await Promise.all([tx.get(record.ref),tx.get(ref),tx.get(paymentRef),tx.get(db.collection('salesPayments').where('invoiceId','==',invoiceId))]);
    const subscription=subscriptionSnap.data() || {},saved=current.data() || {},oldPayment=paymentSnap.data() || {};
    if(subscription.stripeConnectedAccountId!==event.account||subscription.stripeSubscriptionId!==subId||subscription.stripeCustomerId&&subscription.stripeCustomerId!==id(invoice.customer))fail('permission-denied','Stripe invoice does not match its billing customer/account.');
    if(current.exists&&(saved.companyId!==subscription.companyId||saved.stripeConnectedAccountId&&saved.stripeConnectedAccountId!==event.account))fail('permission-denied','Invoice ownership changed.');
    const amountPaid=money(Number(invoice.amount_paid || 0)),manualRows=receipts.docs.filter(doc=>doc.id!==paymentRef.id&&!doc.data().stripeInvoiceId),manual=manualRows.reduce((sum,doc)=>sum+netPayment(doc.data()),0);
    const legacy=saved.legacyExternalPaidCents ?? Math.max(0,Number(saved.amountPaidCents || 0)-netPayment(oldPayment)-manual);
    const grossStripe=Math.max(amountPaid,Number(oldPayment.amountCents || 0));
    const refunded=Number(oldPayment.refundedAmountCents || 0),reversed=Math.max(Number(oldPayment.reversedAmountCents || 0),grossStripe-amountPaid),stripeNet=Math.max(0,grossStripe-refunded-reversed),total=money(Number(invoice.total ?? invoice.amount_due ?? 0));
    const writtenOff=Number(saved.writeOffAmountCents || 0),due=Math.max(0,Number(invoice.amount_remaining ?? Math.max(0,Number(invoice.amount_due || 0)-amountPaid))-manual-legacy-writtenOff-Number(saved.creditAmountCents || 0)-Number(saved.disputeCreditCents || 0)+Math.max(0,reversed-(grossStripe-amountPaid)));
    const base={...ownerFields({...subscription,billingSubscriptionId:record.id}),invoiceId,stripeConnectedAccountId:event.account,stripeCustomerId:id(invoice.customer),stripeSubscriptionId:subId,stripeInvoiceId:invoice.id,currency:invoice.currency || subscription.currency || 'usd'};
    const review=saved.paymentReviewRequired&& !['stripeDispute','stripeReversal'].includes(saved.paymentReviewReason) || reversed>0;
    const invoiceStatus=review?'paymentReview':invoice.status==='draft'?'draft':invoice.status==='void'?'void':invoice.status==='uncollectible'?'uncollectible':due>0?(manual+legacy+stripeNet>0?'partiallyPaid':'open'):refunded>=amountPaid&&amountPaid>0?'refunded':refunded>0?'partiallyRefunded':'paid';
    const fields={...base,id:invoiceId,type:'subscription',billingCollectionMethod:'automaticStripe',status:invoiceStatus,subtotalAmountCents:Number(invoice.subtotal || 0),taxAmountCents:Number(invoice.tax || (invoice.total_taxes || []).reduce((s,t)=>s+Number(t.amount || 0),0)),totalAmountCents:total,
      amountPaidCents:manual+legacy+stripeNet,grossAmountPaidCents:manual+legacy+grossStripe,amountRefundedCents:refunded,amountReversedCents:reversed,amountDueCents:['void','uncollectible'].includes(invoice.status)?0:due,
      stripeGrossPaidCents:amountPaid,legacyExternalPaidCents:legacy,paymentReviewRequired:!!review,paymentReviewReason:review?(saved.paymentReviewReason || 'stripeReversal'):'',refundCreditCents:refunded,stripeCreditAmountCents:Number(invoice.pre_payment_credit_notes_amount || 0),stripeAutoAdvance:invoice.auto_advance===true,
      stripePaymentIntentId:intentId,stripeHostedInvoiceUrl:invoice.hosted_invoice_url || '',stripeInvoicePdfUrl:invoice.invoice_pdf || '',receiptUrl:invoice.hosted_invoice_url || '',
      invoiceNumber:invoice.number || saved.invoiceNumber || invoice.id,dueDate:stamp(invoice.due_date),issuedAt:stamp(invoice.created),paidAt:stamp(invoice.status_transitions?.paid_at),
      lineItems:invoiceLines.map(line=>({id:line.id,name:line.description || 'Recurring service',quantity:line.quantity ?? 1,totalAmountCents:line.amount,unitAmountCents:line.price?.unit_amount ?? line.pricing?.unit_amount_decimal ?? line.amount,metadata:line.metadata || {}})),
      lastStripeEventId:event.id,lastStripeEventType:event.type,updatedAt:now(),createdAt:saved.createdAt || stamp(invoice.created) || now()};
    fields.paymentActionRequired=processorIntent?.status==='requires_action' && invoice.status!=='paid';
    fields.lastPaymentFailure=invoice.last_finalization_error?.message || processorIntent?.last_payment_error?.message || '';
    if(grossStripe>0){const external=invoice.paid_out_of_band?saved.externalPaymentDetails:null;const row={...base,id:paymentRef.id,method:invoice.paid_out_of_band?(external?.method || 'other'):subscription.paymentMethodType==='ach'?'stripeAch':'stripeCard',source:invoice.paid_out_of_band?'stripeOutOfBand':'stripe',amountCents:grossStripe,grossPosted:true,
      refundedAmountCents:refunded,reversedAmountCents:reversed,netAmountCents:stripeNet,status:reversed>0?'disputed':refunded>=grossStripe?'refunded':refunded>0?'partiallyRefunded':'posted',
      stripePaymentIntentId:invoice.paid_out_of_band?'':intentId,stripeChargeId:charge?.id || oldPayment.stripeChargeId || '',stripeBalanceTransactionId:id(charge?.balance_transaction),
      processorFeeCents:typeof charge?.balance_transaction==='object'?Number(charge.balance_transaction.fee || 0):oldPayment.processorFeeCents ?? null,
      applicationFeeId:id(charge?.application_fee),receiptUrl:charge?.receipt_url || invoice.hosted_invoice_url || '',receivedAt:external?.receivedAtMillis?new Date(external.receivedAtMillis):stamp(invoice.status_transitions?.paid_at) || oldPayment.receivedAt || now(),referenceNumber:external?.referenceNumber || oldPayment.referenceNumber || '',memo:external?.memo || oldPayment.memo || '',recordedByUserId:external?.actorUserId || oldPayment.recordedByUserId || '',createdAt:oldPayment.createdAt || now(),updatedAt:now()};tx.set(paymentRef,row,{merge:true});}
    tx.set(ref,fields,{merge:true});tx.set(db.collection('salesPaymentEvents').doc(`stripe_${hash(`${event.account}:${event.id}`)}`),{...base,id:event.id,type:event.type,status:invoiceStatus,amountCents:amountPaid,stripeEventId:event.id,createdAt:now()});
    if(id(sub.latest_invoice)===invoice.id)tx.set(record.ref,{stripeLatestInvoiceId:invoice.id,lastPaymentStatus:invoiceStatus,lastPaymentAt:stamp(invoice.status_transitions?.paid_at),lastReceiptUrl:invoice.hosted_invoice_url || '',lastStripeInvoiceSyncedAt:now()},{merge:true});
    return {subscriptionId:subId};
   };
  });
 }
 async function reversal(event,chargeId){
  return leased(event,`charge:${chargeId}`,async()=>{
   const charge=await stripe.charges.retrieve(chargeId,{expand:['balance_transaction','failure_balance_transaction']},options(event));
   const intent=id(charge.payment_intent),known=await db.collection('salesPayments').where('stripePaymentIntentId','==',intent).get();
   let rows=known.docs.filter(row=>row.data().stripeConnectedAccountId===(event.account || ''));
   if(!rows.length&&charge.invoice){await syncInvoice({...event,id:`${event.id}:invoice`},id(charge.invoice));rows=(await db.collection('salesPayments').where('stripeInvoiceId','==',id(charge.invoice)).get()).docs.filter(row=>row.data().stripeConnectedAccountId===event.account);}
   const portalInvoice=charge.metadata?.flow==='customer_invoice_payment'?charge.metadata.salesInvoiceId:'';
   if(!rows.length&&portalInvoice&&event.type!=='charge.failed')rows=[{id:`stripe_invoice_${hash(intent).slice(0,32)}`,ref:db.collection('salesPayments').doc(`stripe_invoice_${hash(intent).slice(0,32)}`),data:()=>({invoiceId:portalInvoice})}];
   if(!rows.length)return async()=>false;
   if(rows.length!==1)fail('failed-precondition','Charge maps to multiple application payments; review before synchronizing.');
   const disputes=[];let cursor;do{const page=await stripe.disputes.list({charge:charge.id,limit:100,...(cursor?{starting_after:cursor}:{})},options(event));disputes.push(...page.data);cursor=page.has_more?page.data.at(-1)?.id:null;}while(cursor);
   const refunds=[];cursor=null;do{const page=await stripe.refunds.list({charge:charge.id,limit:100,expand:['data.balance_transaction'],...(cursor?{starting_after:cursor}:{})},options(event));refunds.push(...page.data);cursor=page.has_more?page.data.at(-1)?.id:null;}while(cursor);
   const paymentRef=rows[0].ref,invoiceRef=db.collection('salesInvoices').doc(rows[0].data().invoiceId);
   return async tx=>{
    const [paymentSnap,invoiceSnap,receipts]=await Promise.all([tx.get(paymentRef),tx.get(invoiceRef),tx.get(db.collection('salesPayments').where('invoiceId','==',invoiceRef.id))]);
    if(!invoiceSnap.exists)fail('not-found','Payment invoice is missing.');const invoice=invoiceSnap.data(),saved=paymentSnap.data() || {};
    if(!event.account || invoice.stripeConnectedAccountId&&invoice.stripeConnectedAccountId!==event.account || saved.stripeConnectedAccountId&&saved.stripeConnectedAccountId!==event.account)fail('permission-denied','Charge account does not match the payment.');
    const company=await tx.get(db.collection('companies').doc(invoice.companyId));if(![company.data()?.stripeConnectedAccountId,company.data()?.stripeConnectAccountId].includes(event.account))fail('permission-denied','Charge does not belong to this company.');
    if(!paymentSnap.exists){const attempt=await tx.get(invoiceRef.collection('portalPaymentAttempts').doc(charge.metadata.paymentAttemptId));if(!attempt.exists||attempt.data().connectedAccount!==event.account||attempt.data().balanceCents!==charge.amount||charge.metadata.companyId!==invoice.companyId)fail('permission-denied','Original invoice payment attempt does not match this charge.');}
    const gross=Number(saved.amountCents ?? charge.amount),refunded=money(Number(charge.amount_refunded || 0)),failed=charge.status==='failed' && paymentSnap.exists && Number(saved.amountCents)>0;
    const disputed=disputes.filter(d=>!['won','warning_closed'].includes(d.status)).reduce((sum,d)=>sum+Number(d.amount || 0),0),reversed=Math.min(Math.max(0,gross-refunded),failed?gross:disputed),net=Math.max(0,gross-refunded-reversed);
    const oldNet=paymentSnap.exists?netPayment(saved):0,other=receipts.docs.filter(doc=>doc.id!==paymentRef.id).reduce((sum,doc)=>sum+netPayment(doc.data()),0);
    const legacy=invoice.legacyExternalPaidCents ?? Math.max(0,Number(invoice.amountPaidCents || 0)-oldNet-other),paid=legacy+other+net;
    const allRefunds=receipts.docs.filter(doc=>doc.id!==paymentRef.id).reduce((sum,doc)=>sum+Number(doc.data().refundedAmountCents || 0),0)+refunded;
    const allReversed=receipts.docs.filter(doc=>doc.id!==paymentRef.id).reduce((sum,doc)=>sum+Number(doc.data().reversedAmountCents || 0),0)+reversed;
    const amountDue=require('./billingMath').invoiceDue({...invoice,amountPaidCents:paid,refundCreditCents:allRefunds});
    const otherReview=invoice.paymentReviewRequired&&!['stripeDispute','stripeReversal'].includes(invoice.paymentReviewReason),review=!!(otherReview || allReversed>0);
    const closed=['void','voided','canceled','cancelled','uncollectible'].includes(key(invoice.status));
    const invoiceStatus=closed?invoice.status:review?'paymentReview':amountDue>0?paid>0?'partiallyPaid':'open':allRefunds>0?paid>0?'partiallyRefunded':'refunded':'paid';
    const row={...ownerFields(invoice),id:paymentRef.id,invoiceId:invoiceRef.id,amountCents:gross,refundedAmountCents:refunded,reversedAmountCents:reversed,netAmountCents:net,
      status:reversed>0?failed?'reversed':'disputed':refunded>=gross?'refunded':refunded>0?'partiallyRefunded':'posted',grossPosted:true,method:saved.method || 'stripeCard',source:saved.source || 'stripe',currency:charge.currency,
      stripeConnectedAccountId:event.account,stripePaymentIntentId:intent,stripeChargeId:charge.id,stripeBalanceTransactionId:id(charge.balance_transaction),applicationFeeId:id(charge.application_fee),receiptUrl:charge.receipt_url || saved.receiptUrl || '',
      createdAt:saved.createdAt || stamp(charge.created) || now(),receivedAt:saved.receivedAt || stamp(charge.created) || now(),updatedAt:now()};
    tx.set(paymentRef,row,{merge:true});tx.set(invoiceRef,{amountPaidCents:paid,grossAmountPaidCents:legacy+other+gross,amountRefundedCents:allRefunds,amountReversedCents:allReversed,refundCreditCents:allRefunds,legacyExternalPaidCents:legacy,
      amountDueCents:closed?0:amountDue,status:invoiceStatus,paymentReviewRequired:review,paymentReviewReason:otherReview?invoice.paymentReviewReason || 'existingReview':allReversed>0?failed?'stripeReversal':'stripeDispute':'',updatedAt:now()},{merge:true});
    if(failed){
     const movement=typeof charge.failure_balance_transaction==='object'?charge.failure_balance_transaction:null;
     const movementDate=movement?.created?stamp(movement.created):stamp(event.created);
     const returnRef=db.collection('salesPaymentAdjustments').doc(`bankreturn_${charge.id}`);
     tx.set(returnRef,{id:returnRef.id,kind:'bankReturn',paymentId:paymentRef.id,invoiceId:invoiceRef.id,...ownerFields(invoice),status:'reversed',amountCents:reversed,currency:charge.currency,stripeConnectedAccountId:event.account,stripeChargeId:charge.id,stripeBalanceTransactionId:id(charge.failure_balance_transaction),cashMovements:movement?[{id:movement.id,amountCents:movement.amount,currency:movement.currency,createdAtMillis:movement.created*1000}]:[],createdAt:movementDate || now(),movementDateConfirmed:!!movement,updatedAt:now()},{merge:true});
    }
    for(const adjustment of [...refunds.map(r=>({...r,kind:'refund'})),...disputes.map(d=>({...d,kind:'dispute'}))])tx.set(db.collection('salesPaymentAdjustments').doc(`${adjustment.kind}_${adjustment.id}`),{id:adjustment.id,kind:adjustment.kind,paymentId:paymentRef.id,invoiceId:invoiceRef.id,...ownerFields(invoice),status:adjustment.status,amountCents:adjustment.amount,currency:adjustment.currency || charge.currency,stripeConnectedAccountId:event.account,stripeChargeId:charge.id,stripeBalanceTransactionId:id(adjustment.balance_transaction),cashMovements:[...(adjustment.balance_transactions || []),...(typeof adjustment.balance_transaction==='object'&&adjustment.balance_transaction?[adjustment.balance_transaction]:[])].filter(row=>row&&Number.isSafeInteger(row.amount)&&row.created).map(row=>({id:row.id,amountCents:row.amount,currency:row.currency || charge.currency,createdAtMillis:row.created*1000})),createdAt:stamp(adjustment.created) || now(),updatedAt:now()},{merge:true});
    tx.set(db.collection('salesPaymentEvents').doc(`stripe_${hash(`${event.account}:${event.id}`)}`),{...ownerFields(invoice),invoiceId:invoiceRef.id,paymentId:paymentRef.id,stripeEventId:event.id,type:event.type,amountCents:gross,refundedAmountCents:refunded,reversedAmountCents:reversed,netAmountCents:net,status:row.status,createdAt:now()});return true;
   };
  });
 }
 async function checkout(event){
  const session=await stripe.checkout.sessions.retrieve(event.data.object.id,{},options(event));
  if(session.metadata?.flow==='customer_invoice_payment')return false;
  if(!['sales_billing_subscription','dripdrop_platform_subscription'].includes(session.metadata?.flow)&&!session.metadata?.companyId)return false;
  const ref=session.metadata?.salesBillingSubscriptionId?db.collection('salesBillingSubscriptions').doc(session.metadata.salesBillingSubscriptionId):db.collection('companies').doc(session.metadata.companyId);
  await leased(event,`checkout:${session.id}`,async()=>async tx=>{const record=await tx.get(ref);if(!record.exists)fail('not-found','Checkout billing record missing.');
   if(event.account){const company=await tx.get(db.collection('companies').doc(record.data().companyId));if(![company.data()?.stripeConnectedAccountId,company.data()?.stripeConnectAccountId].includes(event.account)||record.data().stripeConnectedAccountId!==event.account)fail('permission-denied','Checkout connected account mismatch.');}
   const attemptId=session.metadata.paymentAttemptId || record.data().checkoutAttemptId,attempt=attemptId?await tx.get(ref.collection('checkoutAttempts').doc(attemptId)):null;
   if(attempt?.exists){if(attempt.data().sessionId&&attempt.data().sessionId!==session.id)fail('permission-denied','Checkout session does not match its reservation.');tx.set(attempt.ref,{status:session.status==='expired'?'expired':session.status==='complete'?'completed':'open',sessionId:session.id,updatedAt:now()},{merge:true});}
   if(session.status==='expired' && record.data().checkoutAttemptId===attemptId)tx.set(ref,{checkoutHold:false,checkoutStatus:'expired',updatedAt:now()},{merge:true});return true;
  });
  if(session.subscription)await syncSubscription(event,id(session.subscription),session);
  return true;
 }
 async function handle(event){
  const type=event.type || '';
  if(!/^(checkout\.session\.|customer\.subscription\.|invoice\.|charge\.|refund\.|payout\.|credit_note\.)/.test(type))return false;
  if(!event.data?.object?.id)fail('failed-precondition','Stripe snapshot payload with data.object is required.');
  if(type.startsWith('checkout.session.'))return checkout(event);
  if(type.startsWith('customer.subscription.'))return syncSubscription(event,event.data.object.id);
  if(type==='invoice.created'){
   const handled=await require('./recurringPartCharges').createRecurringPartCharges(db,stripe,now).applyStripeInvoice(event);
   if(!handled)return false;
   return (await syncInvoice(event,event.data.object.id))!==false;
  }
  if(['invoice.paid','invoice.payment_succeeded','invoice.payment_failed','invoice.payment_action_required','invoice.finalization_failed','invoice.finalized','invoice.updated','invoice.voided','invoice.marked_uncollectible'].includes(type)){
   const result=await syncInvoice(event,event.data.object.id);return result!==false;
  }
  if(type.startsWith('charge.dispute.')){const dispute=await stripe.disputes.retrieve(event.data.object.id,{},options(event));return reversal(event,id(dispute.charge));}
  if(type.startsWith('refund.')){const refund=await stripe.refunds.retrieve(event.data.object.id,{},options(event));return reversal(event,id(refund.charge));}
  if(['charge.refunded','charge.failed'].includes(type))return reversal(event,event.data.object.id);
  if(type.startsWith('credit_note.')){const note=await stripe.creditNotes.retrieve(event.data.object.id,{},options(event));return (await syncInvoice(event,id(note.invoice)))!==false;}
  if(type.startsWith('payout.'))return require('./payoutReconciliation').createPayoutReconciliation(db,stripe,{leased,companyFor},now).sync(event,event.data.object.id);
  return false;
 }
 return {handle,syncSubscription,syncInvoice,reversal,leased,companyFor};
}
module.exports={createStripeLifecycle,netPayment};
