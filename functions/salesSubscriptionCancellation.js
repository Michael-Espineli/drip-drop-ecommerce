const {billingActor} = require('./billingAccess');
const {documentId,fail} = require('./companyActor');
const {id,hash,millis} = require('./billingMath');

// Fence setup first, then recover/retire its original Stripe request. An unknown
// create result must never be treated as proof that there is no payable session.
function createSalesSubscriptionCancellation(db,stripe,now=()=>new Date()) {
  async function cancelPending({companyId,subscriptionId,uid}) {
    documentId(companyId,'Company'); documentId(subscriptionId,'Billing subscription');
    const ref=db.collection('salesBillingSubscriptions').doc(subscriptionId);
    const reservation=await db.runTransaction(async tx=>{
      const actor=await billingActor(db,tx,companyId,uid),snap=await tx.get(ref),record=snap.data();
      if(!record || record.companyId!==companyId)fail('permission-denied','This billing subscription belongs to another company.');
      const connected=actor.company.stripeConnectedAccountId || actor.company.stripeConnectAccountId;
      if(record.stripeConnectedAccountId && record.stripeConnectedAccountId!==connected)fail('permission-denied','The company payment account changed.');
      if(record.checkoutCancellationStatus==='complete')return {done:true};
      const attempt=record.checkoutAttemptId?await tx.get(ref.collection('checkoutAttempts').doc(record.checkoutAttemptId)):null;
      const operationId=record.checkoutCancellationId || `cancel_${hash(`${ref.path}:${record.checkoutAttemptId || record.checkoutSessionId || 'local'}`)}`;
      const hadSetup=record.checkoutCancellationHadSetup ?? Boolean(record.checkoutHold || record.checkoutAttemptId || record.checkoutSessionId || record.stripeSubscriptionId);
      tx.set(ref,{checkoutCancellationRequested:true,checkoutCancellationHadSetup:hadSetup,checkoutCancellationId:operationId,checkoutCancellationStatus:'pending',checkoutCancellationRequestedAt:record.checkoutCancellationRequestedAt || now(),
        checkoutHold:true,status:'cancellationPending',autopayEnabled:false,manualBillingEnabled:false,manualBillingAutoSendEnabled:false,nextAction:'finishCancellation',updatedAt:now()},{merge:true});
      return {record,attempt:attempt?.data(),attemptRef:attempt?.ref,connected,operationId,hadSetup};
    });
    if(reservation.done)return {status:'success',billingStatus:'canceled',nextAction:'reviewCanceledSubscription'};
    const {record,attempt,attemptRef,connected,operationId}=reservation,options=connected?{stripeAccount:connected}:{};
    if(reservation.hadSetup && !connected)fail('failed-precondition','The pending payment setup has no company payment account. Review it before canceling.');
    let session,subscriptionIdInStripe=record.stripeSubscriptionId || '';
    if(record.checkoutSessionId || attempt?.sessionId) {
      session=await stripe.checkout.sessions.retrieve(attempt?.sessionId || record.checkoutSessionId,{},options);
    } else if(attempt?.params) {
      if(!connected || attempt.connected!==connected)fail('permission-denied','The pending payment setup belongs to another account.');
      let customer=record.stripeCustomerId;
      if(!customer)customer=(await stripe.customers.create(attempt.customerData,{...options,idempotencyKey:`billing_customer_${hash(ref.path)}`})).id;
      try { session=await stripe.checkout.sessions.create({...attempt.params,customer},{...options,idempotencyKey:record.checkoutAttemptId}); }
      catch(error) {
        // Stripe cannot create a new session with an already-expired request.
        if(!(millis(attempt.expiresAt)<=now().getTime() && error.param==='expires_at'))throw error;
      }
    } else if(reservation.hadSetup && !subscriptionIdInStripe) {
      fail('failed-precondition','The pending payment setup is missing. Review it in Stripe before canceling.');
    }
    if(session?.status==='open') {
      try { session=await stripe.checkout.sessions.expire(session.id,{},options); }
      catch(error) {
        session=await stripe.checkout.sessions.retrieve(session.id,{},options);
        if(session.status==='open')throw error;
      }
    }
    if(session && !['complete','expired'].includes(session.status))fail('aborted','Stripe has not confirmed the payment setup was retired. Retry cancellation.');
    subscriptionIdInStripe=subscriptionIdInStripe || id(session?.subscription);
    let processorSubscription;
    if(subscriptionIdInStripe) {
      processorSubscription=await stripe.subscriptions.retrieve(subscriptionIdInStripe,{},options);
      if(processorSubscription.metadata?.salesBillingSubscriptionId!==subscriptionId || processorSubscription.metadata?.companyId!==companyId || record.stripeCustomerId && id(processorSubscription.customer)!==record.stripeCustomerId)
        fail('permission-denied','The Stripe subscription does not match this billing setup.');
      if(!['canceled','incomplete_expired'].includes(processorSubscription.status))processorSubscription=await stripe.subscriptions.cancel(subscriptionIdInStripe,{}, {...options,idempotencyKey:operationId});
    }
    await db.runTransaction(async tx=>{
      await billingActor(db,tx,companyId,uid);
      const current=await tx.get(ref),saved=current.data() || {};
      if(saved.checkoutCancellationId!==operationId)fail('aborted','The cancellation changed. Refresh and retry.');
      if(saved.stripeSubscriptionId && saved.stripeSubscriptionId!==subscriptionIdInStripe)fail('aborted','A subscription was confirmed while canceling. Retry cancellation.');
      if(attemptRef)tx.set(attemptRef,{status:'canceled',...(session?{sessionId:session.id}:{}),updatedAt:now()},{merge:true});
      tx.set(ref,{status:'canceled',autopayStatus:'canceled',autopayEnabled:false,manualBillingEnabled:false,manualBillingAutoSendEnabled:false,checkoutHold:false,checkoutUrl:'',checkoutStatus:'canceled',
        checkoutCancellationStatus:'complete',cancelAtPeriodEnd:false,canceledAt:now(),nextAction:'reviewCanceledSubscription',
        ...(processorSubscription?{stripeSubscriptionId:processorSubscription.id,stripeStatus:processorSubscription.status}:{}),
        cancellationPaymentReviewRequired:session?.payment_status==='paid' || saved.cancellationPaymentReviewRequired===true,updatedAt:now()},{merge:true});
      if(record.agreementId)tx.set(db.collection('salesAgreements').doc(record.agreementId),{billingFlowStatus:'canceled',billingFlowNextAction:'reviewCanceledSubscription',manualBillingEnabled:false,manualBillingAutoSendEnabled:false,billingFlowUpdatedAt:now()},{merge:true});
    });
    return {status:'success',billingStatus:'canceled',nextAction:'reviewCanceledSubscription',paymentReviewRequired:session?.payment_status==='paid',message:'Billing setup canceled. Any completed payment remains in the payment history for review.'};
  }
  return {cancelPending};
}
module.exports={createSalesSubscriptionCancellation};
