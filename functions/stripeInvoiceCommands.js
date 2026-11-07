const {onCall}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {billingActor}=require('./billingAccess');
const {documentId,fail}=require('./companyActor');
const {id,hash,millis,paymentIntent}=require('./billingMath');
const {normalizePayment}=require('./salesInvoiceCommands');
const {createStripeProxy}=require('./stripe/stripeClient');
const {HttpsError}=require('./appErrors');

function createStripeInvoiceCommands(db,stripe,now=()=>new Date(),sync){
 async function manage(request){
  const data=request.data || {},companyId=documentId(data.companyId,'Company'),invoiceId=documentId(data.invoiceId,'Invoice'),requestId=documentId(data.requestId,'Request');
  const action=data.action,reason=String(data.reason || '').trim();
  if(!['refresh','pauseDraft','updateDraftLines','finalize','void','credit','writeOff','recordExternalPayment'].includes(action))fail('invalid-argument','Choose a supported Stripe invoice action.');
  if(action!=='refresh'&&(reason.length<8||reason.length>1000))fail('invalid-argument','Explain the invoice change in 8–1000 characters.');
  const payment=action==='recordExternalPayment'?normalizePayment(data.payment,now()):null;
  const amount=data.amountCents;
  if(action==='credit'&&(!Number.isSafeInteger(amount)||amount<=0))fail('invalid-argument','Choose a positive whole-cent credit amount.');
  let lines=null;
  if(action==='updateDraftLines'){
   if(!Array.isArray(data.lines)||!data.lines.length||data.lines.length>100)fail('invalid-argument','Choose 1–100 draft invoice lines.');
   lines=data.lines.map(line=>{
    if(!/^il_[a-zA-Z0-9]+$/.test(line.id)||!Number.isSafeInteger(line.amount)||Math.abs(line.amount)>999999999999||!String(line.description || '').trim()||String(line.description).length>1000)fail('invalid-argument','Each line needs its Stripe ID, description and whole-cent total.');
    return {id:line.id,amount:line.amount,description:String(line.description).trim()};
   });
   if(new Set(lines.map(l=>l.id)).size!==lines.length)fail('invalid-argument','Each invoice line can only be edited once.');
  }
  const fingerprint=hash({action,reason,payment,amount:action==='credit'?amount:null,lines,expectedTotalAmountCents:data.expectedTotalAmountCents ?? null});
  const invoiceRef=db.collection('salesInvoices').doc(invoiceId),commandId=hash(`${companyId}:${requestId}`),commandRef=invoiceRef.collection('stripeCommands').doc(commandId);
  const reserved=await db.runTransaction(async tx=>{
   const actor=await billingActor(db,tx,companyId,request.auth?.uid),[saved,command]=await Promise.all([tx.get(invoiceRef),tx.get(commandRef)]),invoice=saved.data();
   if(!invoice||invoice.companyId!==companyId||!invoice.stripeInvoiceId||invoice.stripeConnectedAccountId!==(actor.company.stripeConnectedAccountId || actor.company.stripeConnectAccountId))fail('permission-denied','This Stripe invoice does not belong to the selected company account.');
   if(command.exists){if(command.data().fingerprint!==fingerprint)fail('already-exists','Retry the original Stripe invoice instructions.');return command.data();}
   if(invoice.stripeInvoiceMutation&&action!=='refresh')fail('failed-precondition','Another Stripe invoice change needs confirmation. Retry that original request.');
   const value={fingerprint,action,reason,payment,amountCents:action==='credit'?amount:null,lines,connectedAccount:invoice.stripeConnectedAccountId,stripeInvoiceId:invoice.stripeInvoiceId,stripeCustomerId:invoice.stripeCustomerId || '',expectedTotalAmountCents:data.expectedTotalAmountCents ?? null,actorUserId:request.auth.uid,createdAt:now(),status:'reserved'};
   tx.set(commandRef,value);if(action!=='refresh')tx.set(invoiceRef,{stripeInvoiceMutation:commandId},{merge:true});return value;
  });
  if(reserved.status==='complete')return reserved.result;
  if(reserved.status==='rejected')fail('failed-precondition','This request was rejected before changing Stripe. Start a new request after refreshing.');
  const options={stripeAccount:reserved.connectedAccount};
  let command=reserved;
  if(!command.processorParams){
   try{
    const invoice=await stripe.invoices.retrieve(command.stripeInvoiceId,{},options);
    if(command.stripeCustomerId&&id(invoice.customer)!==command.stripeCustomerId)fail('permission-denied','Stripe customer does not match the saved invoice.');
    if(command.expectedTotalAmountCents!==null&&invoice.total!==command.expectedTotalAmountCents)fail('failed-precondition','Stripe’s invoice total changed. Refresh before changing it.');
    const intentId=paymentIntent(invoice),intent=intentId?await stripe.paymentIntents.retrieve(intentId,{},options):null;
    if(action!=='refresh'&&intent&&['processing','requires_capture','succeeded'].includes(intent.status)&&invoice.status!=='paid')fail('failed-precondition','A payment is being confirmed. Wait before changing the invoice.');
    let params={},operation=action;
    if(action==='pauseDraft'){
     if(invoice.status!=='draft')fail('failed-precondition','Only draft invoices can pause automatic finalization.');params={auto_advance:false};
    }else if(action==='updateDraftLines'){
     if(invoice.status!=='draft'||invoice.auto_advance!==false)fail('failed-precondition','Pause draft finalization before editing its lines.');
     const known=new Set((invoice.lines?.data || []).map(line=>line.id));
     if(invoice.lines?.has_more||lines.some(line=>!known.has(line.id)))fail('failed-precondition','Reload the complete invoice before editing its lines.');params={lines};
    }else if(action==='finalize'){
     if(invoice.status!=='draft')fail('failed-precondition','Only a draft invoice can be finalized.');params={auto_advance:false};
    }else if(action==='void'||action==='writeOff'){
     if(invoice.status!=='open'||Number(invoice.amount_paid)>0)fail('failed-precondition','Only an open unpaid invoice can be voided or written off here. Resolve payments separately.');
    }else if(action==='credit'){
     if(!['open','uncollectible'].includes(invoice.status)||amount>invoice.amount_remaining)fail('failed-precondition','Credit only the remaining unpaid balance. Use the refund action for collected money.');
     params={invoice:invoice.id,amount,memo:reason,reason:'order_change',email_type:'none',metadata:{companyId,salesInvoiceId:invoiceId,commandId}};
    }else if(action==='recordExternalPayment'){
     if(invoice.status!=='open'||Number(invoice.amount_paid)!==0||payment.amountCents!==invoice.amount_remaining)fail('failed-precondition','Record the full outstanding balance of an unpaid Stripe invoice. Partial or mixed Stripe/external payments need review in Stripe.');
     params={paid_out_of_band:true};
    }
    const processorParams={operation,params};
    await commandRef.set({processorParams,processorStartedAt:now()},{merge:true});
    command={...command,processorParams,processorStartedAt:now()};
   }catch(error){
    await db.runTransaction(async tx=>{const [saved,current]=await Promise.all([tx.get(commandRef),tx.get(invoiceRef)]);if(saved.data()?.processorParams)return;tx.set(commandRef,{status:'rejected',error:error.message},{merge:true});if(current.data()?.stripeInvoiceMutation===commandId)tx.set(invoiceRef,{stripeInvoiceMutation:null},{merge:true});});
    throw new HttpsError(['failed-precondition','permission-denied','aborted','invalid-argument'].includes(error.code)?error.code:'unavailable',error.message,{safeToRevise:true});
   }
  }
  if(!command.processorResult&&action!=='refresh'&&millis(command.processorStartedAt)+23*3600000<now().getTime())fail('failed-precondition','This Stripe operation has an uncertain outcome. Review Stripe before making another change.');
  if(!command.processorResult){
   const params=command.processorParams.params,keyOptions={...options,idempotencyKey:`stripe_invoice_${hash(commandRef.path)}`};
   let result;
   if(action==='refresh')result={id:command.stripeInvoiceId};
   else if(action==='pauseDraft')result=await stripe.invoices.update(command.stripeInvoiceId,params,keyOptions);
   else if(action==='updateDraftLines')result=await stripe.invoices.updateLines(command.stripeInvoiceId,params,keyOptions);
   else if(action==='finalize')result=await stripe.invoices.finalizeInvoice(command.stripeInvoiceId,params,keyOptions);
   else if(action==='void')result=await stripe.invoices.voidInvoice(command.stripeInvoiceId,params,keyOptions);
   else if(action==='writeOff')result=await stripe.invoices.markUncollectible(command.stripeInvoiceId,params,keyOptions);
   else if(action==='credit')result=await stripe.creditNotes.create(params,keyOptions);
   else result=await stripe.invoices.pay(command.stripeInvoiceId,params,keyOptions);
   await commandRef.set({processorResult:{id:result.id,status:result.status || 'accepted'},status:'processorAccepted'},{merge:true});
   if(action==='recordExternalPayment'&&(result.amount_paid!==payment.amountCents||result.paid_out_of_band!==true))await invoiceRef.set({paymentReviewRequired:true,paymentReviewReason:'externalStripeBalanceChanged'},{merge:true});
  }
  if(action==='recordExternalPayment')await invoiceRef.set({externalPaymentDetails:{...payment,actorUserId:command.actorUserId,commandId}},{merge:true});
  const event={id:`invoice_command_${hash(commandRef.path)}`,type:'invoice.updated',account:command.connectedAccount,data:{object:{id:command.stripeInvoiceId}}};
  await (sync || (event=>require('./stripeLifecycle').createStripeLifecycle(db,stripe,now).handle(event)))(event);
  const result={invoiceId,status:'synchronized',action};
  await db.runTransaction(async tx=>{
   const invoice=await tx.get(invoiceRef);
   tx.set(commandRef,{status:'complete',result,completedAt:now()},{merge:true});
   if(invoice.data()?.stripeInvoiceMutation===commandId)tx.set(invoiceRef,{stripeInvoiceMutation:null},{merge:true});
   tx.set(db.collection('salesInvoiceEvents').doc(`stripe_command_${hash(commandRef.path)}`),{companyId,invoiceId,action,reason,actorUserId:command.actorUserId,stripeInvoiceId:command.stripeInvoiceId,createdAt:now(),result});
  });return result;
 }
 return {manage};
}
exports.createStripeInvoiceCommands=createStripeInvoiceCommands;
exports.manageStripeInvoice=onCall({cors:true},request=>createStripeInvoiceCommands(admin.firestore(),createStripeProxy()).manage(request));
