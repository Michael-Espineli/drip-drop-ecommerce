const {onCall}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {randomUUID}=require('node:crypto');
const {billingActor}=require('./billingAccess');
const {documentId,fail}=require('./companyActor');
const {id,hash,millis}=require('./billingMath');
const {createStripeProxy}=require('./stripe/stripeClient');
const {HttpsError}=require('./appErrors');

function createSalesPaymentCommands(db,stripe,now=()=>new Date(),reconcile) {
  async function manage(request) {
    const data=request.data || {},uid=request.auth?.uid;
    const companyId=documentId(data.companyId,'Company'),paymentId=documentId(data.paymentId,'Payment'),requestId=documentId(data.requestId,'Request');
    const action=data.action;
    if(!['refund','markReconciled','refreshStripeStatus'].includes(action))fail('invalid-argument','Choose a supported payment action.');
    const reason=String(data.reason || '').trim(),amount=data.amountCents;
    if(action==='refund' && (!Number.isSafeInteger(amount) || amount<=0 || amount>999999999999 || reason.length<8 || reason.length>1000))throw new HttpsError('invalid-argument','Enter a positive refund amount in cents and a reason of 8–1000 characters.',{safeToRevise:true});
    const fingerprint=hash({action,amount:action==='refund'?amount:null,reason:action==='refund'?reason:''});
    const paymentRef=db.collection('salesPayments').doc(paymentId),commandRef=paymentRef.collection('companyCommands').doc(hash(`${companyId}:${requestId}`)),token=randomUUID();
    const reserved=await db.runTransaction(async tx=>{
      const actor=await billingActor(db,tx,companyId,uid);
      const [paymentSnap,commandSnap]=await Promise.all([tx.get(paymentRef),tx.get(commandRef)]),payment=paymentSnap.data(),command=commandSnap.data();
      if(!payment || payment.companyId!==companyId)fail('permission-denied','This payment does not belong to the selected company.');
      if(command && command.fingerprint!==fingerprint)fail('already-exists','This request already has different payment instructions.');
      if(command?.status==='complete')return {done:true,result:command.result};
      const invoiceSnap=await tx.get(db.collection('salesInvoices').doc(documentId(payment.invoiceId,'Invoice'))),invoice=invoiceSnap.data();
      if(!invoice || invoice.companyId!==companyId || invoice.customerId!==payment.customerId)fail('failed-precondition','Review this payment’s invoice ownership before continuing.');
      if(action==='markReconciled'){
        if(!payment.grossPosted && !['posted','partiallyRefunded','refunded','disputed','reversed'].includes(payment.status))fail('failed-precondition','Only a posted receipt can be reconciled.');
        const result={paymentId,status:'reconciled'};
        tx.set(paymentRef,{accountingStatus:'reconciled',reconciledAt:payment.reconciledAt || now(),reconciledByUserId:payment.reconciledByUserId || uid,updatedAt:now()},{merge:true});
        tx.set(commandRef,{fingerprint,status:'complete',result,actorUserId:uid,createdAt:now()});
        tx.set(db.collection('salesPaymentEvents').doc(`reconciled_${hash(commandRef.path)}`),{companyId,paymentId,invoiceId:payment.invoiceId,type:'paymentReconciled',actorUserId:uid,createdAt:now()});
        return {done:true,result};
      }
      if(action==='refreshStripeStatus'){
        if(!payment.stripeConnectedAccountId || payment.stripeConnectedAccountId!==(actor.company.stripeConnectedAccountId || actor.company.stripeConnectAccountId) || !payment.stripePaymentIntentId || !['posted','partiallyRefunded','refunded','disputed','reversed'].includes(payment.status))fail('failed-precondition','Only a previously settled Stripe receipt can be refreshed here. Pending payments are confirmed by Stripe.');
        tx.set(commandRef,{fingerprint,action,status:'reserved',actorUserId:uid,createdAt:command?.createdAt || now()},{merge:true});
        return {payment,refresh:true};
      }
      if(!payment.stripeConnectedAccountId || payment.stripeConnectedAccountId!==(actor.company.stripeConnectedAccountId || actor.company.stripeConnectAccountId) || !payment.stripePaymentIntentId || !command && (!['posted','partiallyRefunded'].includes(payment.status) || Number(payment.reversedAmountCents || 0)>0))
        fail('failed-precondition','Only a settled Stripe payment on this company account can be refunded here.');
      if(!command && amount>Number(payment.amountCents || 0)-Number(payment.refundedAmountCents || 0))throw new HttpsError('failed-precondition','The refund exceeds the payment’s remaining refundable amount.',{safeToRevise:true});
      const lock=payment.refundMutation;
      if(lock?.commandId && lock.commandId!==commandRef.id && millis(lock.until)>now().getTime())fail('aborted','Another refund is being processed for this payment. Refresh and retry.');
      tx.set(paymentRef,{refundMutation:{commandId:commandRef.id,token,until:new Date(now().getTime()+120000)}},{merge:true});
      tx.set(commandRef,{fingerprint,action,status:command?.status || 'reserved',amountCents:amount,reason,actorUserId:command?.actorUserId || uid,createdAt:command?.createdAt || now()},{merge:true});
      return {payment,command,token};
    });
    if(reserved.done)return reserved.result;
    const {payment}=reserved,options={stripeAccount:payment.stripeConnectedAccountId};
    if(reserved.refresh){
      const intent=await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId,{expand:['latest_charge']},options),charge=typeof intent.latest_charge==='object'?intent.latest_charge:await stripe.charges.retrieve(id(intent.latest_charge),{},options);
      if(!charge || !['succeeded','failed'].includes(charge.status) || id(charge.payment_intent)!==payment.stripePaymentIntentId || payment.stripeChargeId && charge.id!==payment.stripeChargeId)fail('failed-precondition','The settled charge cannot be confirmed yet.');
      await require('./stripeLifecycle').createStripeLifecycle(db,stripe,now).reversal({id:`operator_refresh_${hash(commandRef.path)}`,type:'operator.payment_refresh',account:payment.stripeConnectedAccountId},charge.id);
      const result={paymentId,status:'synchronized'};await commandRef.set({status:'complete',result,completedAt:now()},{merge:true});return result;
    }
    let refund;
    if(reserved.command?.stripeRefundId)refund=await stripe.refunds.retrieve(reserved.command.stripeRefundId,{},options);
    else {
      let params=reserved.command?.stripeParams;
      if(!params){
       try {
        const intent=await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId,{expand:['latest_charge']},options);
        const charge=typeof intent.latest_charge==='object'?intent.latest_charge:await stripe.charges.retrieve(id(intent.latest_charge),{},options);
        if(!charge || id(charge.payment_intent)!==payment.stripePaymentIntentId || payment.stripeChargeId && charge.id!==payment.stripeChargeId || charge.currency!==payment.currency || charge.amount!==payment.amountCents || charge.disputed || charge.status!=='succeeded')fail('failed-precondition','Stripe’s settled charge does not match this receipt. Refresh payment status before refunding.');
        if(amount>charge.amount-Number(charge.amount_refunded || 0))fail('failed-precondition','Stripe has already refunded part of this payment. Refresh its status before refunding more.');
        params={charge:charge.id,amount,reason:'requested_by_customer',...(charge.application_fee?{refund_application_fee:true}:{}),metadata:{companyId,salesPaymentId:paymentId,salesInvoiceId:payment.invoiceId,requestId:commandRef.id,actorUserId:uid,note:reason.slice(0,500)}};
        await db.runTransaction(async tx=>{
          await billingActor(db,tx,companyId,uid);
          const [current,command]=await Promise.all([tx.get(paymentRef),tx.get(commandRef)]);
          if(current.data()?.refundMutation?.token!==token || command.data()?.fingerprint!==fingerprint)fail('aborted','Refund reservation changed. Retry the same request.');
          tx.set(commandRef,{stripeParams:params},{merge:true});
        });
       } catch(error) {
        if(error.code==='failed-precondition'){
          const safe=await db.runTransaction(async tx=>{const [command,current]=await Promise.all([tx.get(commandRef),tx.get(paymentRef)]);
            if(command.data()?.stripeParams || command.data()?.stripeRefundId || current.data()?.refundMutation?.token!==token)return false;
            tx.set(commandRef,{status:'rejected',error:error.message,rejectedAt:now()},{merge:true});tx.set(paymentRef,{refundMutation:null},{merge:true});return true;
          });
          if(safe)throw new HttpsError(error.code,error.message,{safeToRevise:true});
        }
        throw error;
       }
      }
      refund=await stripe.refunds.create(params,{...options,idempotencyKey:`sales_refund_${hash(commandRef.path)}`});
      await commandRef.set({stripeRefundId:refund.id,status:'processorAccepted',updatedAt:now()},{merge:true});
    }
    const event={id:`operator_refund_${hash(commandRef.path)}`,type:'refund.updated',account:payment.stripeConnectedAccountId,data:{object:{id:refund.id}}};
    const sync=reconcile || (event=>require('./stripeLifecycle').createStripeLifecycle(db,stripe,now).handle(event));
    await sync(event);
    const result={paymentId,invoiceId:payment.invoiceId,stripeRefundId:refund.id,amountCents:amount,status:refund.status || 'pending'};
    await db.runTransaction(async tx=>{
      const current=await tx.get(paymentRef);
      tx.set(commandRef,{status:'complete',result,completedAt:now()},{merge:true});
      if(current.data()?.refundMutation?.commandId===commandRef.id)tx.set(paymentRef,{refundMutation:null},{merge:true});
      tx.set(db.collection('salesPaymentEvents').doc(`refund_requested_${hash(commandRef.path)}`),{companyId,paymentId,invoiceId:payment.invoiceId,type:'refundRequested',amountCents:amount,reason,actorUserId:uid,stripeRefundId:refund.id,createdAt:now()});
    });
    return result;
  }
  return {manage};
}
exports.createSalesPaymentCommands=createSalesPaymentCommands;
exports.manageSalesPayment=onCall({cors:true},request=>createSalesPaymentCommands(admin.firestore(),createStripeProxy()).manage(request));
