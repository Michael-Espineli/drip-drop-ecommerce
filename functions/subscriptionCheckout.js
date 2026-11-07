const {billingActor,companyBillingMembership}=require('./billingAccess');
const {documentId,fail}=require('./companyActor');
const {id,key,hash,millis,pricing,liveSubscription}=require('./billingMath');
const {agreementTerms,readAgreement}=require('./billingAgreementTerms');
const allowedOrigins=new Set(['https://dripdrop-poolapp.com','https://www.dripdrop-poolapp.com','https://the-pool-app-dev.web.app','https://the-pool-app-dev.firebaseapp.com','https://the-pool-app-3e652.web.app','https://the-pool-app-3e652.firebaseapp.com']);
function redirect(value){let url;try{url=new URL(value);}catch(_){fail('invalid-argument','Choose a valid DripDrop return URL.');}const local=['localhost','127.0.0.1'].includes(url.hostname)&&process.env.FUNCTIONS_EMULATOR==='true';if((!allowedOrigins.has(url.origin)&&!local)||url.username||url.password)fail('invalid-argument','Return to the DripDrop app after billing setup.');return url.toString();}
function createSubscriptionCheckout(db,stripe,now=()=>new Date()){
 async function start(request,{platform=false,plan=null}={}){
  const data=request.data || {},uid=request.auth?.uid;if(!uid)fail('unauthenticated','Sign in to set up billing.');
  const companyId=documentId(data.companyId,'Company'),subscriptionId=platform?'':documentId(data.billingSubscriptionId,'Billing subscription');
  const ref=platform?db.collection('companies').doc(companyId):db.collection('salesBillingSubscriptions').doc(subscriptionId);
  const successUrl=redirect(data.successUrl),cancelUrl=redirect(data.cancelUrl);
  const method=data.paymentMethodType==='ach'?'ach':'card';
  const reserved=await db.runTransaction(async tx=>{
   const snap=await tx.get(ref);if(!snap.exists)fail('not-found','Billing record not found.');const record={...snap.data(),id:snap.id};
   const companySnap=platform?snap:await tx.get(db.collection('companies').doc(companyId)),company=companySnap.data() || {};
   const owns=request.auth?.uid===record.customerUserId || (!record.customerUserId&&request.auth.token?.email_verified===true&&String(request.auth.token.email || '').trim().toLowerCase()===String(record.email || '').trim().toLowerCase()&&record.email);
   if(platform){const actor=await companyBillingMembership(db,tx,companyId,uid);if(!actor.administrator&&!actor.permissions.includes('890'))fail('permission-denied','Subscription management permission is required.');}
   else if(!owns)await billingActor(db,tx,companyId,uid);
   if(!platform && (record.companyId!==companyId || !companySnap.exists))fail('permission-denied','The subscription belongs to another company.');
   if(!platform && data.agreementId && record.agreementId!==data.agreementId)fail('failed-precondition','This agreement has a different billing subscription.');
   if(!platform && (record.checkoutCancellationRequested || ['canceled','cancelled','superseded','expired','cancellationpending'].includes(key(record.status))))fail('failed-precondition','This billing agreement is closed or being canceled.');
   const connected=platform?'':company.stripeConnectedAccountId || company.stripeConnectAccountId || '';
   if(!platform && (!connected || connected!==record.stripeConnectedAccountId || !(company.customerBillingEnabled||company.salesBillingEnabled||company.salesBillingAutomationEnabled)))fail('failed-precondition','The company must finish its connected payment setup.');
   if(!platform&&record.stripeSubscriptionId&&liveSubscription(record.stripeStatus || record.status))return {already:record.stripeSubscriptionId};
   const appSubs=platform?await tx.get(ref.collection('subscriptions')):null;
   if(appSubs?.docs.some(doc=>doc.data().stripeSubscriptionId&&liveSubscription(doc.data().status)))return {already:appSubs.docs.find(doc=>doc.data().stripeSubscriptionId&&liveSubscription(doc.data().status)).data().stripeSubscriptionId};
   const price=platform?null:pricing(record);
   const agreement=platform?{}:await readAgreement(tx,db,record),terms=platform?{}:agreementTerms(record,agreement,company);
   if(!platform && (terms.closed || terms.endAt && terms.endAt<=now().getTime()))fail('failed-precondition','This service agreement has ended. Review its terms before setting up billing.');
   if(method==='ach'&&!platform&&price.currency!=='usd')fail('failed-precondition','ACH requires USD billing.');
   const invoices=platform?null:await tx.get(db.collection('salesInvoices').where('billingSubscriptionId','==',subscriptionId));
   let startAt=Math.max(millis(record.firstInvoiceSendAt),millis(record.manualBillingNextInvoiceAt),millis(record.agreementSnapshot?.startDate));
   for(const invoice of invoices?.docs || []){
    const bill=invoice.data();if(bill.companyId!==companyId)fail('failed-precondition','A linked invoice has inconsistent ownership.');
    if(['void','voided','canceled','cancelled'].includes(key(bill.status)))continue;
    if(Number(bill.amountDueCents ?? Number(bill.totalAmountCents || 0)-Number(bill.amountPaidCents || 0)-Number(bill.writeOffAmountCents || 0))>0)fail('failed-precondition','Settle existing manual invoices before enabling autopay so the same service is not billed twice.');
    if(Number(bill.amountPaidCents || 0)>0){if(!millis(bill.billingPeriodEnd))fail('failed-precondition','Set the service period on existing paid manual invoices before enabling autopay.');startAt=Math.max(startAt,millis(bill.billingPeriodEnd));}
   }
   if(!platform && terms.endAt && startAt>=terms.endAt)fail('failed-precondition','No recurring service period remains before this agreement ends.');
   const previous=record.checkoutAttemptId?await tx.get(ref.collection('checkoutAttempts').doc(record.checkoutAttemptId)):null;
   const old=previous?.data();
   if(old?.kind==='native'&&!['expired','failed'].includes(old.status))fail('failed-precondition','Finish or cancel the pending mobile subscription setup before starting browser Checkout.');
   if(!record.checkoutAttemptId&&record.checkoutSessionId){
    const legacyId=`legacy_${hash(record.checkoutSessionId)}`,legacy={sessionId:record.checkoutSessionId,status:'open',fingerprint:'legacy',connected,customerData:record.checkoutCustomerData || {name:record.customerName || company.name || 'Customer',email:record.email || company.email || '',metadata:{companyId}},expiresAt:new Date(now().getTime()+1800000)};
    tx.set(ref.collection('checkoutAttempts').doc(legacyId),legacy);tx.set(ref,{checkoutAttemptId:legacyId,checkoutHold:true},{merge:true});
    return {ref,record,company,connected,attempt:{...legacy,id:legacyId},retire:true};
   }
   const fingerprint=hash({connected,method:platform?'card':method,total:price?.totalAmountCents,currency:price?.currency,interval:record.interval,intervalCount:record.intervalCount,plan:plan?.stripePriceId,startAt,successUrl,cancelUrl});
   if(old&&!['expired','failed'].includes(old.status))return {ref,record,company,connected,attempt:{...old,id:previous.id},retire:old.fingerprint!==fingerprint || millis(old.expiresAt)<=now().getTime()};
   const version=Number(record.checkoutVersion || 0)+1,attemptId=`checkout_${hash(`${ref.path}:${version}`)}`;
   const metadata=platform?{flow:'dripdrop_platform_subscription',companyId,userId:uid,paymentAttemptId:attemptId}:{flow:'sales_billing_subscription',companyId,salesBillingSubscriptionId:subscriptionId,salesAgreementId:record.agreementId || '',salesCustomerId:record.customerId || '',createdByUserId:uid,stripeConnectedAccountId:connected,paymentMethodType:method,paymentAttemptId:attemptId,pricingSnapshotHash:hash(price)};
   const interval=String(record.interval || 'month').replace(/ly$/,'');if(!platform&&!['day','week','month','year'].includes(interval))fail('failed-precondition','Choose a valid recurring billing interval.');
   const intervalCount=Number(record.intervalCount ?? 1);if(!Number.isInteger(intervalCount)||intervalCount<1)fail('failed-precondition','Choose a valid billing interval count.');
   const params={mode:'subscription',payment_method_types:[platform||method==='card'?'card':'us_bank_account'],line_items:platform?[{price:plan.stripePriceId,quantity:1}]:[{price_data:{currency:price.currency,unit_amount:price.totalAmountCents,recurring:{interval,interval_count:intervalCount},product_data:{name:record.agreementSnapshot?.title || 'Pool service',metadata:{salesAgreementId:record.agreementId || '',pricingSnapshotHash:hash(price)}}},quantity:1}],client_reference_id:platform?companyId:subscriptionId,metadata,subscription_data:{metadata},success_url:successUrl,cancel_url:cancelUrl,expires_at:Math.floor(now().getTime()/1000)+1860};
   if(!platform){params.subscription_data.application_fee_percent=method==='ach'?0.19:0.08;if(startAt>now().getTime()+172800000)params.subscription_data.trial_end=Math.floor(startAt/1000);else if(startAt>now().getTime()+60000){params.subscription_data.billing_cycle_anchor=Math.floor(startAt/1000);params.subscription_data.proration_behavior='none';}}
   const customerData=record.checkoutCustomerData || {name:record.customerName || company.name || undefined,email:record.email || company.email || undefined,metadata:{companyId,...(!platform?{salesCustomerId:record.customerId || '',salesBillingSubscriptionId:subscriptionId}:{})}};
   // Firestore does not accept undefined, even in a frozen Stripe request.
   const clean=JSON.parse(JSON.stringify({fingerprint,params,customerData,connected,status:'creating',expiresAt:new Date(params.expires_at*1000),createdAt:now(),startAt,platform}));clean.expiresAt=new Date(clean.expiresAt);clean.createdAt=new Date(clean.createdAt);
   tx.set(ref.collection('checkoutAttempts').doc(attemptId),clean);
   tx.set(ref,{checkoutAttemptId:attemptId,checkoutVersion:version,checkoutHold:true,checkoutCustomerData:clean.customerData,...(!platform&&terms.endAt?{billingEndAt:new Date(terms.endAt)}:{})},{merge:true});
   return {ref,record,company,connected,attempt:{...clean,id:attemptId}};
  });
  if(reserved.already)return {status:'already_active',stripeSubscriptionId:reserved.already,message:'This company or agreement already has a Stripe subscription. Manage that subscription instead.'};
  const {record,connected,attempt}=reserved,attemptRef=ref.collection('checkoutAttempts').doc(attempt.id),options=connected?{stripeAccount:connected}:{};
  if(connected){const account=await stripe.accounts.retrieve(connected);if(!account.charges_enabled)fail('failed-precondition','The company payment account is not ready.');}
  let customerId=record.stripeCustomerId || (platform?record.stripeId:'');
  if(customerId){const customer=await stripe.customers.retrieve(customerId,{},options);if(customer.deleted)fail('failed-precondition','The saved billing customer was deleted.');if(customer.metadata?.companyId&&customer.metadata.companyId!==companyId)fail('permission-denied','Billing customer belongs to another company.');if(!platform&&customer.metadata?.salesCustomerId&&customer.metadata.salesCustomerId!==record.customerId)fail('permission-denied','Billing customer belongs to another customer.');}
  else{const customer=await stripe.customers.create(attempt.customerData,{...options,idempotencyKey:`billing_customer_${hash(ref.path)}`});customerId=customer.id;await ref.set({stripeCustomerId:customerId},{merge:true});}
  // Recover a completed setup whose webhook/database acknowledgement was delayed.
  let cursor;do{const page=await stripe.subscriptions.list({customer:customerId,status:'all',limit:100,...(cursor?{starting_after:cursor}:{})},options);
   const live=page.data.find(sub=>liveSubscription(sub.status)&&(platform?sub.metadata?.companyId===companyId:sub.metadata?.salesBillingSubscriptionId===record.id));
   if(live){await ref.set({checkoutHold:true,stripeSubscriptionId:live.id,...(!platform?{stripeStatus:live.status}:{})},{merge:true});return {status:'already_active',stripeSubscriptionId:live.id,message:'Your existing subscription is being synchronized.'};}
   cursor=page.has_more?page.data.at(-1)?.id:null;
  }while(cursor);
  if(attempt.status==='completed')return {status:'processing',message:'Your subscription setup is being confirmed.'};
  let session=attempt.sessionId?await stripe.checkout.sessions.retrieve(attempt.sessionId,{},options):null;
  if(!session){try{session=await stripe.checkout.sessions.create({...attempt.params,customer:customerId},{...options,idempotencyKey:attempt.id});}catch(error){if(millis(attempt.expiresAt)<=now().getTime()&&(error.param==='expires_at'||error.code==='parameter_invalid_integer')){await attemptRef.set({status:'expired'},{merge:true});return start(request,{platform,plan});}throw error;}}
  if(session.status==='complete'){await attemptRef.set({sessionId:session.id,status:'completed'},{merge:true});return {status:'processing',message:'Your subscription setup is being confirmed.'};}
  if(reserved.retire||session.status==='expired'){
   if(session.status==='open')await stripe.checkout.sessions.expire(session.id,{},options);
   await attemptRef.set({sessionId:session.id,status:'expired',updatedAt:now()},{merge:true});
   return start(request,{platform,plan});
  }
  const publish=await db.runTransaction(async tx=>{
   const current=await tx.get(ref),latestAttempt=await tx.get(attemptRef);if(current.data()?.checkoutCancellationRequested || ['canceled','cancelled','cancellationpending','expired','superseded'].includes(key(current.data()?.status)) || !['creating','open'].includes(latestAttempt.data()?.status)||current.data()?.checkoutAttemptId!==attempt.id||current.data()?.stripeSubscriptionId&&liveSubscription(current.data()?.stripeStatus || current.data()?.status))return false;
   tx.set(attemptRef,{sessionId:session.id,status:'open',updatedAt:now()},{merge:true});
   tx.set(ref,{checkoutSessionId:session.id,checkoutUrl:session.url,checkoutStatus:'created',checkoutHold:true,...(!platform?{status:'pendingStripe',autopayStatus:'checkoutStarted',nextAction:'completeCheckout',firstAutomaticChargeAt:attempt.startAt?new Date(attempt.startAt):now()}:{}),updatedAt:now()},{merge:true});return true;
  });
  if(!publish){if(session.status==='open')await stripe.checkout.sessions.expire(session.id,{},options);fail('aborted','The billing setup changed. Refresh it before continuing.');}
  return {status:'success',url:session.url,sessionId:session.id,stripeCustomerId:customerId,firstChargeAtMillis:attempt.startAt || now().getTime(),paymentMethodType:method};
 }
 async function releaseExpiredHold(ref){
  const snap=await ref.get(),saved=snap.data();
  if(!saved?.checkoutHold||saved.stripeSubscriptionId||!saved.checkoutAttemptId)return false;
  const attemptRef=ref.collection('checkoutAttempts').doc(saved.checkoutAttemptId),attempt=(await attemptRef.get()).data();
  if(!attempt?.sessionId)return false; // An uncertain create result must be recovered with its original idempotency key.
  const company=await db.collection('companies').doc(saved.companyId).get();
  if(![company.data()?.stripeConnectedAccountId,company.data()?.stripeConnectAccountId].includes(attempt.connected))fail('permission-denied','Checkout account ownership changed.');
  const session=await stripe.checkout.sessions.retrieve(attempt.sessionId,{}, {stripeAccount:attempt.connected});
  if(session.status!=='expired'||session.subscription)return false;
  return db.runTransaction(async tx=>{
   const [current,latest]=await Promise.all([tx.get(ref),tx.get(attemptRef)]);
   if(current.data()?.checkoutAttemptId!==saved.checkoutAttemptId||current.data()?.stripeSubscriptionId||latest.data()?.sessionId!==session.id)return false;
   tx.set(attemptRef,{status:'expired',updatedAt:now()},{merge:true});
   tx.set(ref,{checkoutHold:false,checkoutStatus:'expired',checkoutUrl:'',updatedAt:now()},{merge:true});return true;
  });
 }
 return {start,releaseExpiredHold};
}
module.exports={createSubscriptionCheckout,redirect};
