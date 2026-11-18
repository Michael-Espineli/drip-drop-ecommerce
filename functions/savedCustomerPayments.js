const {onCall}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {billingActor}=require('./billingAccess');
const {documentId,fail}=require('./companyActor');
const {id,hash,millis,invoiceDue}=require('./billingMath');
const {createStripeProxy}=require('./stripe/stripeClient');
const {HttpsError}=require('./appErrors');
const text=value=>String(value ?? '').trim();
const account=company=>text(company.stripeConnectedAccountId || company.stripeConnectAccountId);
const open=invoice=>['open','overdue','partiallypaid'].includes(text(invoice.status).replace(/[^a-z]/gi,'').toLowerCase());
const consentVersion='invoice-authorization-v1';

function setupReturnUrl(value,origin){
 let url;try{url=new URL(value);}catch(_){fail('invalid-argument','Choose a valid DripDrop return page.');}
 const origins=['https://dripdrop-poolapp.com','https://www.dripdrop-poolapp.com','https://the-pool-app-dev.web.app','https://the-pool-app-dev.firebaseapp.com','https://the-pool-app-3e652.web.app','https://the-pool-app-3e652.firebaseapp.com'];
 const local=['localhost','127.0.0.1'].includes(url.hostname)&&(process.env.FUNCTIONS_EMULATOR==='true'||process.env.GCLOUD_PROJECT==='the-pool-app-dev');
 if((!origins.includes(url.origin)&&!local)||origin&&origin!==url.origin||url.username||url.password||!url.pathname.startsWith('/'))fail('invalid-argument','Return to the DripDrop application.');
 return url;
}

function createSavedCustomerPayments(db,stripe,now=()=>new Date()){
 async function context(request,reader={get:ref=>ref.get()},{agreementSetup=false,subscriptionId=''}={}){
  const data=request.data || {};
  if(agreementSetup&&data.agreementId){
   const {agreement,company,actor}=await require('./serviceOnboarding').createServiceOnboarding(db,now).context(request,reader);
   if(agreement.status!=='accepted'||agreement.onboardingBilling?.collectionMethod==='invoice')fail('failed-precondition','Accept the agreement before setting up online payment.');
   const billing=agreement.onboardingBilling;
   if(billing?.prorationEnabled&&millis(billing.reviewedStartAt)!==require('./billingCalendar').dayStart(now(),billing.timeZone||company.billingTimeZone||company.timeZone||'UTC').getTime())fail('failed-precondition','The office needs to refresh the prorated first-period preview for today.');
   const connected=account(company),companyId=agreement.companyId,customerId=documentId(agreement.customerId,'Customer');
   if(!connected||![company.customerBillingEnabled,company.salesBillingEnabled,company.salesBillingAutomationEnabled].includes(true))fail('failed-precondition','The company needs to finish online billing setup. Contact the office.');
   const profileId=hash(`${companyId}:${customerId}:${connected}`),profileRef=db.collection('salesPaymentProfiles').doc(profileId);
   return {data,actor:{...actor,company},companyId,customerId,connected,profileId,profileRef,agreement,
    invoice:{customerName:agreement.customerName,email:agreement.onboardingBilling?.contact?.email||agreement.email,currency:agreement.currency||'usd'}};
  }
  const companyId=documentId(data.companyId,'Company'),invoiceId=documentId(data.invoiceId,'Invoice');
  let actor;
  if(subscriptionId){
   const sub=(await reader.get(db.collection('salesBillingSubscriptions').doc(subscriptionId))).data();
   const agreement=sub?.agreementId?(await reader.get(db.collection('salesAgreements').doc(sub.agreementId))).data():null;
   const company=(await reader.get(db.collection('companies').doc(companyId))).data();
   if(!company||sub?.companyId!==companyId||sub.onboardingWorkflowVersion!==1||sub.onboardingCollectionMethod!=='savedMethod'||sub.status!=='active'||
    !sub.onboardingPaymentAuthorizedAt||sub.onboardingPaymentMethodId!==data.paymentMethodId||agreement?.status!=='accepted'||agreement.companyId!==companyId||agreement.billingSubscriptionId!==subscriptionId||agreement.onboardingBilling?.collectionMethod==='invoice'||agreement.customerId!==sub.customerId||sub.onboardingAuthorizationHash!==require('./serviceOnboarding').authorizationHash({...agreement,id:sub.agreementId}))
    fail('failed-precondition','The current agreement does not authorize recurring collection.');
   actor={uid:'system:onboarding',company};
  }else actor=await billingActor(db,reader,companyId,request.auth?.uid);
  const snap=await reader.get(db.collection('salesInvoices').doc(invoiceId)),invoice=snap.data();
  if(!invoice||invoice.companyId!==companyId)fail('permission-denied','Select the company that owns this invoice.');
  if(subscriptionId&&invoice.billingSubscriptionId!==subscriptionId)fail('permission-denied','This invoice is not part of the authorized recurring plan.');
  const customerId=documentId(invoice.customerId,'Customer'),connected=account(actor.company);
  if(!connected||![actor.company.customerBillingEnabled,actor.company.salesBillingEnabled,actor.company.salesBillingAutomationEnabled].includes(true))fail('failed-precondition','Enable customer billing and connect the company’s Stripe account.');
  const profileId=hash(`${companyId}:${customerId}:${connected}`),profileRef=db.collection('salesPaymentProfiles').doc(profileId);
  return {data,actor,companyId,invoiceId,invoice,invoiceRef:snap.ref,customerId,connected,profileId,profileRef};
 }

 async function setup(request){
  const ctx=await context(request,undefined,{agreementSetup:true}),{data,actor,companyId,customerId,connected,profileId,profileRef}=ctx;
  const requestId=documentId(data.requestId,'Request'),method=data.paymentMethodType;
  if(!['card','ach'].includes(method))fail('invalid-argument','Choose a card or US bank account.');
  if(method==='ach'&&(ctx.invoice.currency || 'usd').toLowerCase()!=='usd')fail('failed-precondition','ACH requires USD billing.');
  const returnTo=setupReturnUrl(data.returnUrl,request.rawRequest?.headers?.origin);
  const schedule=ctx.agreement?require('./onboardingPolicy').onboardingSchedule(ctx.agreement,actor.company,now()):null;
  const consent=ctx.agreement
   ? `You authorize ${text(actor.company.name).slice(0,150)||'your service company'} to charge ${((schedule.initialAmountCents||0)/100).toFixed(2)} ${String(ctx.invoice.currency).toUpperCase()} when setup completes, then ${((ctx.agreement.totalAmountCents||0)/100).toFixed(2)} monthly in advance. Billing uses your signup day${ctx.agreement.onboardingBilling?.scheduleMode==='companyOverride'?' or the company-approved billing day':''}, using month-end in shorter months and returning to the original day afterward. ${schedule.prorated?'The first amount includes the office-approved calendar-day proration. ':''}Contact the company to revoke authorization.`
   : `By saving this payment method, you authorize ${text(actor.company.name).slice(0,150)||'your service company'} to collect invoices you authorize under your service agreement. Amounts and payment dates follow those invoices and your agreement. Contact the company to revoke this authorization. Saving a method does not pay an invoice today.`;
  const authorizationHash=ctx.agreement?require('./serviceOnboarding').authorizationHash(ctx.agreement):'';
  const fingerprint=hash({method,returnUrl:returnTo.toString(),consentVersion,authorizationHash});
  const attemptRef=profileRef.collection('setupAttempts').doc(hash(requestId));
  const attempt=await db.runTransaction(async tx=>{
   await context(request,tx,{agreementSetup:true});
   const [profile,saved]=await Promise.all([tx.get(profileRef),tx.get(attemptRef)]);
   if(saved.exists){if(saved.data().fingerprint!==fingerprint)fail('already-exists','Retry the original payment setup request.');return saved.data();}
   const value={fingerprint,method,consent,consentVersion,createdAt:now(),createdByUserId:request.auth?.uid||'email-link',status:'creating',
    ...(ctx.agreement?{onboardingAgreementId:ctx.agreement.id,onboardingRevision:Number(ctx.agreement.revisionNumber||0),authorizationHash}:{})};
   tx.set(profileRef,{companyId,customerId,stripeConnectedAccountId:connected,createdAt:profile.data()?.createdAt || now(),updatedAt:now()},{merge:true});
   tx.set(attemptRef,value);return value;
  });
  // Never recreate an unknown processor request after Stripe's idempotency retention window.
  if(!attempt.sessionId&&millis(attempt.createdAt)+23*3600000<now().getTime())fail('failed-precondition','This setup attempt needs review. Start a new setup link.');
  let profile=(await profileRef.get()).data(),customerIdStripe=profile.stripeCustomerId;
  const options={stripeAccount:connected};
  if(!customerIdStripe){
   const customer=await stripe.customers.create({name:ctx.invoice.customerName || undefined,email:ctx.invoice.email || undefined,metadata:{companyId,salesCustomerId:customerId,salesPaymentProfileId:profileId}}, {...options,idempotencyKey:`saved_customer_${profileId}`});
   await db.runTransaction(async tx=>{const current=await tx.get(profileRef);if(current.data()?.stripeCustomerId&&current.data().stripeCustomerId!==customer.id)fail('aborted','Payment profile changed.');tx.set(profileRef,{stripeCustomerId:customer.id},{merge:true});});
   customerIdStripe=customer.id;
  }
  const metadata={flow:'customer_payment_setup',companyId,salesCustomerId:customerId,salesPaymentProfileId:profileId,setupAttemptId:attemptRef.id};
  // The payer is a customer, even when office staff create the setup link.
  // A public informational return avoids exposing or requiring a staff session.
  const success=new URL('/customer/payment-method-setup',returnTo.origin);success.searchParams.set('paymentSetup','returned');
  const canceled=new URL('/customer/payment-method-setup',returnTo.origin);canceled.searchParams.set('paymentSetup','canceled');
  if(ctx.agreement){
   for(const url of [success,canceled]){
    url.pathname=`/customer/service-agreements/${encodeURIComponent(ctx.agreement.id)}`;
    url.searchParams.set('email',ctx.agreement.email||'');
    const token=ctx.agreement.emailDelivery?.reviewAccessToken;
    if(token)url.searchParams.set('accessToken',token);
   }
  }
  const params={mode:'setup',customer:customerIdStripe,payment_method_types:[method==='ach'?'us_bank_account':'card'],...(method==='ach'?{currency:'usd'}:{}),
   ...(ctx.agreement?{billing_address_collection:'required',customer_update:{address:'auto',name:'auto'}}:{}),
   metadata,setup_intent_data:{metadata},custom_text:{submit:{message:attempt.consent}},success_url:success.toString(),cancel_url:canceled.toString()};
  const session=attempt.sessionId?await stripe.checkout.sessions.retrieve(attempt.sessionId,{},options):await stripe.checkout.sessions.create(params,{...options,idempotencyKey:`saved_setup_${profileId}_${attemptRef.id}`});
  await attemptRef.set({sessionId:session.id,status:session.status,setupIntentId:id(session.setup_intent),updatedAt:now()},{merge:true});
  if(session.setup_intent)await syncSetup(id(session.setup_intent),connected);
  return {url:session.url || '',status:session.status,profileId};
 }

 async function syncSetup(setupId,connected){
  const intent=await stripe.setupIntents.retrieve(setupId,{}, {stripeAccount:connected}),meta=intent.metadata || {};
  if(meta.flow!=='customer_payment_setup')return false;
  const profileRef=db.collection('salesPaymentProfiles').doc(documentId(meta.salesPaymentProfileId,'Payment profile'));
  const attemptRef=profileRef.collection('setupAttempts').doc(documentId(meta.setupAttemptId,'Setup attempt'));
  const [profileSnap,attempt]=await Promise.all([profileRef.get(),attemptRef.get()]),profile=profileSnap.data();
  const company=profile?await db.collection('companies').doc(profile.companyId).get():null;
  if(!profile||!attempt.exists||profile.stripeConnectedAccountId!==connected||account(company?.data() || {})!==connected||meta.companyId!==profile.companyId||meta.salesCustomerId!==profile.customerId||id(intent.customer)!==profile.stripeCustomerId||intent.usage!=='off_session')fail('permission-denied','Payment setup ownership does not match.');
  if(intent.status==='succeeded'){
   const method=await stripe.paymentMethods.retrieve(id(intent.payment_method),{}, {stripeAccount:connected});
   if(id(method.customer)!==profile.stripeCustomerId||!['card','us_bank_account'].includes(method.type))fail('permission-denied','Saved method does not belong to this customer.');
   if(method.type==='us_bank_account'){
    const mandate=id(intent.mandate)?await stripe.mandates.retrieve(id(intent.mandate),{}, {stripeAccount:connected}):null;
    if(mandate?.status!=='active'||id(mandate.payment_method)!==method.id)fail('failed-precondition','Complete bank verification and authorization before starting service billing.');
   }
   const details=method[method.type],value={id:method.id,type:method.type,last4:details.last4,bankName:details.bank_name || '',brand:details.brand || '',expMonth:details.exp_month || null,expYear:details.exp_year || null,
    setupIntentId:intent.id,mandateId:id(intent.mandate),consentVersion:attempt.data().consentVersion,consentText:attempt.data().consent,authorizedAt:new Date(intent.created*1000),status:'ready',updatedAt:now()};
   await profileRef.collection('methods').doc(method.id).set(value,{merge:true});
   if(attempt.data().onboardingAgreementId){
    const customer=await stripe.customers.retrieve(profile.stripeCustomerId,{}, {stripeAccount:connected});
    const address=customer.address||{};
    await require('./serviceOnboarding').createServiceOnboarding(db,now).activatePayment({agreementId:attempt.data().onboardingAgreementId,profileId:profileRef.id,methodId:method.id,authorizedAt:value.authorizedAt,authorizationHash:attempt.data().authorizationHash,
     contact:{name:customer.name||'',email:customer.email||'',address:{streetAddress:address.line1||'',city:address.city||'',state:address.state||'',zip:address.postal_code||'',country:address.country||'US'}}});
    await collectOnboardingPeriod(attempt.data().onboardingAgreementId);
   }
  }
  await attemptRef.set({setupIntentId:intent.id,status:intent.status,verificationUrl:intent.next_action?.verify_with_microdeposits?.hosted_verification_url || '',updatedAt:now()},{merge:true});
  return true;
 }

 async function list(request){
  const ctx=await context(request),profile=(await ctx.profileRef.get()).data();
  if(!profile?.stripeCustomerId)return {methods:[],pending:[]};
  const attempts=await ctx.profileRef.collection('setupAttempts').orderBy('createdAt','desc').limit(20).get();
  for(const attempt of attempts.docs){
   let setupId=attempt.data().setupIntentId;
   if(!setupId&&attempt.data().sessionId){const session=await stripe.checkout.sessions.retrieve(attempt.data().sessionId,{}, {stripeAccount:ctx.connected});setupId=id(session.setup_intent);}
   if(setupId&&!['succeeded','canceled'].includes(attempt.data().status))await syncSetup(setupId,ctx.connected);
  }
  const methods=await ctx.profileRef.collection('methods').get(),visible=[];
  for(const snap of methods.docs){
   const method=await stripe.paymentMethods.retrieve(snap.id,{}, {stripeAccount:ctx.connected});
   if(id(method.customer)!==profile.stripeCustomerId)continue;
   const saved=snap.data();
   if(method.type==='us_bank_account'){
    if(!saved.mandateId)continue;
    const mandate=await stripe.mandates.retrieve(saved.mandateId,{}, {stripeAccount:ctx.connected});
    if(mandate.status!=='active')continue;
   }
   visible.push({id:snap.id,type:saved.type,last4:saved.last4,bankName:saved.bankName,brand:saved.brand,expMonth:saved.expMonth,expYear:saved.expYear});
  }
  const pending=(await ctx.profileRef.collection('setupAttempts').orderBy('createdAt','desc').limit(20).get()).docs.map(s=>s.data()).filter(s=>s.status==='requires_action').map(s=>({status:s.status,verificationUrl:s.verificationUrl || ''}));
  return {methods:visible,pending};
 }

 async function charge(request,{subscriptionId=''}={}){
  const data=request.data || {},requestId=documentId(data.requestId,'Request'),methodId=documentId(data.paymentMethodId,'Payment method');
  const authorization=text(data.authorizationReference);
  if(data.authorizationConfirmed!==true||authorization.length<8||authorization.length>1000)fail('invalid-argument','Confirm customer authorization and identify the agreement or approval covering this invoice.');
  const paymentContext=reader=>context(request,reader,{subscriptionId});
  const ctx=await paymentContext(),commandId=hash(`${ctx.companyId}:${ctx.invoiceId}:${requestId}`),commandRef=ctx.invoiceRef.collection('officePaymentAttempts').doc(commandId);
  const fingerprint=hash({methodId,authorization});
  const reserved=await db.runTransaction(async tx=>{
   const current=await paymentContext(tx),[command,profile,method]=await Promise.all([tx.get(commandRef),tx.get(current.profileRef),tx.get(current.profileRef.collection('methods').doc(methodId))]);
   if(command.exists){if(command.data().fingerprint!==fingerprint)fail('already-exists','Retry the original payment instructions.');return command.data();}
   if(current.invoice.stripeInvoiceId||current.invoice.stripeSubscriptionId)fail('failed-precondition','Collect a Stripe-generated invoice through its Stripe invoice payment flow.');
   if(!open(current.invoice)||current.invoice.paymentReviewRequired||current.invoice.paymentProcessing||current.invoice.billingMutation&&millis(current.invoice.billingMutation.startedAt)+120000>now().getTime())fail('failed-precondition','This invoice is closed, under review, or already processing a payment.');
   const amount=invoiceDue(current.invoice);
   if(!Number.isSafeInteger(amount)||amount<50)fail('failed-precondition','The invoice has no payable balance.');
   if(!profile.data()?.stripeCustomerId||!method.exists||method.data().status!=='ready')fail('failed-precondition','Complete payment setup before collecting an invoice.');
   if(method.data().type==='us_bank_account'&&(current.invoice.currency || 'usd').toLowerCase()!=='usd')fail('failed-precondition','ACH requires USD billing.');
   const attempt=current.invoice.portalPaymentAttemptId?await tx.get(current.invoiceRef.collection('portalPaymentAttempts').doc(current.invoice.portalPaymentAttemptId)):null;
   const value={companyId:ctx.companyId,invoiceId:ctx.invoiceId,customerId:ctx.customerId,connectedAccount:ctx.connected,profileId:ctx.profileId,customer:profile.data().stripeCustomerId,methodId,methodType:method.data().type,mandateId:method.data().mandateId || '',amountCents:amount,currency:(current.invoice.currency || 'usd').toLowerCase(),fingerprint,authorizationReference:authorization,authorizationConfirmed:true,actorUserId:ctx.actor.uid,createdAt:now(),status:'reserved',portalAttempt:attempt?.data() || null,portalAttemptId:attempt?.id || ''};
   tx.set(commandRef,value);tx.set(current.invoiceRef,{officePaymentAttemptId:commandId,paymentProcessing:true,billingMutation:{id:commandId,startedAt:now()}},{merge:true});return value;
  });
  if(reserved.status==='complete')return reserved.result;
  const options={stripeAccount:reserved.connectedAccount};
  if(!reserved.intentId&&!reserved.stripeParams){
   try{
    const previous=reserved.portalAttempt;
    if(previous&&!['expired','failed'].includes(previous.status)){
     const session=previous.sessionId?await stripe.checkout.sessions.retrieve(previous.sessionId,{},options):await stripe.checkout.sessions.create(previous.params,{...options,idempotencyKey:reserved.portalAttemptId});
     if(session.status==='complete')fail('failed-precondition','The customer already completed checkout. Wait for confirmation.');
     if(session.status==='open')await stripe.checkout.sessions.expire(session.id,{},options);
     await ctx.invoiceRef.collection('portalPaymentAttempts').doc(reserved.portalAttemptId).set({sessionId:session.id,status:'expired'},{merge:true});
    }
    const method=await stripe.paymentMethods.retrieve(methodId,{},options);
    if(id(method.customer)!==reserved.customer||method.type!==reserved.methodType)fail('failed-precondition','This method is no longer available for this customer.');
    if(reserved.methodType==='us_bank_account'){
     const mandate=reserved.mandateId?await stripe.mandates.retrieve(reserved.mandateId,{},options):null;
     if(mandate?.status!=='active'||id(mandate.payment_method)!==methodId)fail('failed-precondition','The bank authorization is no longer active. Collect a new authorization.');
    }
    const params={customer:reserved.customer,payment_method:methodId,payment_method_types:[reserved.methodType],amount:reserved.amountCents,currency:reserved.currency,confirm:true,off_session:true,
     application_fee_amount:Math.round(reserved.amountCents*(reserved.methodType==='us_bank_account'?0.19:0.08)/100),
     ...(reserved.mandateId?{mandate:reserved.mandateId}:{}),metadata:{flow:'office_invoice_payment',companyId:ctx.companyId,salesInvoiceId:ctx.invoiceId,paymentAttemptId:commandId,salesPaymentProfileId:ctx.profileId}};
    await db.runTransaction(async tx=>{await paymentContext(tx);const current=await tx.get(ctx.invoiceRef),command=await tx.get(commandRef);if(current.data()?.officePaymentAttemptId!==commandId||command.data()?.status==='rejected')fail('aborted','The invoice payment reservation changed.');tx.set(commandRef,{stripeParams:params,processorStartedAt:now()},{merge:true});});
   }catch(error){
    // This branch has not attempted a charge. A new request may be made after correcting the issue.
    await db.runTransaction(async tx=>{const [invoice,command]=await Promise.all([tx.get(ctx.invoiceRef),tx.get(commandRef)]);if(command.data()?.stripeParams)return;tx.set(commandRef,{status:'rejected',error:error.message},{merge:true});if(invoice.data()?.officePaymentAttemptId===commandId)tx.set(ctx.invoiceRef,{paymentProcessing:false,billingMutation:null},{merge:true});});
    throw new HttpsError(['failed-precondition','permission-denied','aborted','invalid-argument'].includes(error.code)?error.code:'unavailable',error.message,{safeToRevise:true});
   }
  }
  const current=(await commandRef.get()).data();
  if(current.status==='rejected')fail('failed-precondition','The previous payment was rejected before charging. Start a new request.');
  if(!current.intentId&&millis(current.processorStartedAt)+23*3600000<now().getTime())fail('failed-precondition','The original payment could not be confirmed. Review Stripe before retrying; do not start another charge.');
  let intent;
  try{intent=current.intentId?await stripe.paymentIntents.retrieve(current.intentId,{},options):await stripe.paymentIntents.create(current.stripeParams,{...options,idempotencyKey:`office_payment_${commandId}`});}
  catch(error){
   intent=error.payment_intent || error.raw?.payment_intent;
   if(!intent)throw error; // Network/unknown outcomes retain the reservation and exact retry parameters.
   if(typeof intent==='string')intent=await stripe.paymentIntents.retrieve(intent,{},options);
  }
  await commandRef.set({intentId:intent.id,status:'processorAccepted'},{merge:true});
  if(['requires_action','requires_payment_method','requires_confirmation'].includes(intent.status)){
   // Cancel the uncollected attempt before permitting a separate customer Checkout.
   intent=await stripe.paymentIntents.cancel(intent.id,{}, {...options,idempotencyKey:`office_cancel_${commandId}`});
  }
  await syncPayment(intent.id,ctx.connected);
  return (await commandRef.get()).data().result;
 }

 async function syncPayment(intentId,connected){
  const intent=await stripe.paymentIntents.retrieve(intentId,{expand:['latest_charge.balance_transaction']},{stripeAccount:connected}),meta=intent.metadata || {};
  if(meta.flow!=='office_invoice_payment')return false;
  const invoiceRef=db.collection('salesInvoices').doc(documentId(meta.salesInvoiceId,'Invoice')),commandRef=invoiceRef.collection('officePaymentAttempts').doc(documentId(meta.paymentAttemptId,'Payment attempt'));
  const paymentRef=db.collection('salesPayments').doc(`stripe_invoice_${hash(intent.id).slice(0,32)}`),charge=typeof intent.latest_charge==='object'?intent.latest_charge:null;
  const terminal=['succeeded','canceled'].includes(intent.status),posted=intent.status==='succeeded';
  const settlement=await db.runTransaction(async tx=>{
   const [invoiceSnap,commandSnap,paymentSnap]=await Promise.all([tx.get(invoiceRef),tx.get(commandRef),tx.get(paymentRef)]),invoice=invoiceSnap.data(),command=commandSnap.data(),old=paymentSnap.data() || {};
   const company=invoice?await tx.get(db.collection('companies').doc(invoice.companyId)):null;
   if(!invoice||!command||!connected||account(company?.data() || {})!==connected||command.connectedAccount!==connected||command.companyId!==meta.companyId||invoice.companyId!==meta.companyId||id(intent.customer)!==command.customer||(id(intent.payment_method)||id(intent.last_payment_error?.payment_method)||id(charge?.payment_method))!==command.methodId||intent.amount!==command.amountCents||intent.currency!==command.currency||command.intentId&&command.intentId!==intent.id)fail('permission-denied','Stripe payment does not match the reserved customer, company and invoice.');
   const alreadyPosted=old.grossPosted===true;
   const result={invoiceId:invoiceRef.id,paymentId:paymentRef.id,status:posted?'succeeded':alreadyPosted?'paymentReview':intent.status==='canceled'?'customerActionRequired':'processing',amountCents:intent.amount};
   tx.set(commandRef,{intentId:intent.id,status:terminal||alreadyPosted?((posted||alreadyPosted)&&charge?.id?'settling':'complete'):'processing',result,updatedAt:now()},{merge:true});
   if(!alreadyPosted)tx.set(paymentRef,{id:paymentRef.id,invoiceId:invoiceRef.id,companyId:invoice.companyId,customerId:invoice.customerId,customerUserId:invoice.customerUserId || '',customerName:invoice.customerName || '',email:invoice.email || '',currency:intent.currency,
    amountCents:intent.amount,netAmountCents:posted?intent.amount:0,grossPosted:posted,method:command.methodType==='us_bank_account'?'stripeAch':'stripeCard',source:'stripe',status:posted?'posted':intent.status==='canceled'?'failed':'processing',
    stripeConnectedAccountId:connected,stripePaymentIntentId:intent.id,stripeChargeId:charge?.id || '',applicationFeeId:id(charge?.application_fee),stripeBalanceTransactionId:id(charge?.balance_transaction),receiptUrl:charge?.receipt_url || '',
    createdAt:old.createdAt || now(),receivedAt:posted?new Date((charge?.created || intent.created)*1000):null,updatedAt:now()},{merge:true});
   const patch={updatedAt:now()};
   if(invoice.officePaymentAttemptId===commandRef.id){patch.paymentProcessing=!(terminal||alreadyPosted);patch.billingMutation=null;patch.lastPaymentFailure=intent.status==='canceled'?'The saved method needs customer attention. Send the invoice payment link.':alreadyPosted&&!posted?'A previously collected payment needs review. Confirm its Stripe return or reversal.':'';}
   if(posted&&!alreadyPosted){const paid=Number(invoice.amountPaidCents || 0)+intent.amount,due=invoiceDue({...invoice,amountPaidCents:paid}),closed=!open(invoice);Object.assign(patch,{amountPaidCents:paid,amountDueCents:closed?invoice.amountDueCents:due,status:closed?invoice.status:due?'partiallyPaid':'paid',paidAt:due===0?now():null,lastPaymentAt:now(),lastPaymentId:paymentRef.id,paymentReviewRequired:closed||paid+Number(invoice.writeOffAmountCents || 0)+require('./billingMath').invoiceCredits(invoice)>Number(invoice.totalAmountCents || 0)});}
   tx.set(invoiceRef,patch,{merge:true});
   tx.set(db.collection('salesPaymentEvents').doc(`office_${hash(`${intent.id}:${intent.status}`)}`),{companyId:invoice.companyId,invoiceId:invoiceRef.id,paymentId:paymentRef.id,type:'officePaymentStatus',status:intent.status,actorUserId:command.actorUserId,authorizationReference:command.authorizationReference,amountCents:intent.amount,createdAt:now()});
   return {wasPosted:alreadyPosted};
  });
  if((posted||settlement.wasPosted)&&charge?.id){await require('./stripeLifecycle').createStripeLifecycle(db,stripe,now).reversal({id:`office_current_${intent.id}_${intent.status}_${now().getTime()}`,type:'office.payment_refresh',account:connected},charge.id);await commandRef.set({status:'complete'},{merge:true});}
  return true;
 }

 async function handle(event){
  const value=event.data?.object || {};
  if(value.metadata?.flow==='customer_payment_setup'){
   if(event.type==='checkout.session.completed'&&value.setup_intent)return syncSetup(id(value.setup_intent),event.account);
   if(event.type.startsWith('setup_intent.'))return syncSetup(value.id,event.account);
   if(event.type.startsWith('checkout.session.')){
    const profileRef=db.collection('salesPaymentProfiles').doc(documentId(value.metadata.salesPaymentProfileId,'Payment profile')),profile=(await profileRef.get()).data();
    if(!profile||profile.stripeConnectedAccountId!==event.account||profile.companyId!==value.metadata.companyId||id(value.customer)!==profile.stripeCustomerId)fail('permission-denied','Payment setup session does not belong to this profile.');
    const attemptRef=profileRef.collection('setupAttempts').doc(documentId(value.metadata.setupAttemptId,'Setup attempt')),attempt=await attemptRef.get();
    if(!attempt.exists||attempt.data().sessionId&&attempt.data().sessionId!==value.id)fail('permission-denied','Setup session does not match the original request.');
    await attemptRef.set({sessionId:value.id,status:value.status,updatedAt:now()},{merge:true});return true;
   }
  }
  if(value.metadata?.flow==='office_invoice_payment'&&event.type.startsWith('payment_intent.'))return syncPayment(value.id,event.account);
  return false;
 }
 async function collectRecurringInvoice({subscriptionId,invoiceId}){
  const sub=(await db.collection('salesBillingSubscriptions').doc(subscriptionId).get()).data();
  if(!sub||sub.onboardingWorkflowVersion!==1||sub.onboardingCollectionMethod!=='savedMethod')return {skipped:true};
  return charge({data:{companyId:sub.companyId,invoiceId,requestId:`recurring_${invoiceId}`,paymentMethodId:sub.onboardingPaymentMethodId,
   authorizationConfirmed:true,authorizationReference:`Accepted service agreement ${sub.agreementId}; payment setup ${sub.onboardingPaymentProfileId}`}}, {subscriptionId});
 }
 async function collectOnboardingPeriod(agreementId){
  const agreement=(await db.collection('salesAgreements').doc(agreementId).get()).data();
  const subscriptionId=agreement?.billingSubscriptionId;
  if(!subscriptionId)return;
  const result=await require('./manualRecurringBilling').createManualRecurringBilling(db,now).generate({subscriptionId,scheduled:true});
  if(result.invoiceId)await collectRecurringInvoice({subscriptionId,invoiceId:result.invoiceId});
 }
 return {setup,list,charge,handle,syncSetup,syncPayment,collectRecurringInvoice};
}
exports.createSavedCustomerPayments=createSavedCustomerPayments;
for(const [name,method] of Object.entries({createSavedPaymentSetup:'setup',listSavedPaymentMethods:'list',chargeSavedInvoice:'charge'}))exports[name]=onCall({cors:true},request=>createSavedCustomerPayments(admin.firestore(),createStripeProxy())[method](request));
exports.createServiceOnboardingCheckout=onCall({cors:true},request=>{
 if(!request.data?.agreementId)fail('invalid-argument','Select the accepted service agreement.');
 return createSavedCustomerPayments(admin.firestore(),createStripeProxy()).setup(request);
});
