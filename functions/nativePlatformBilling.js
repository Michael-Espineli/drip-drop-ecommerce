const {companyBillingMembership}=require('./billingAccess');
const {documentId,fail}=require('./companyActor');
const {id,hash,liveSubscription}=require('./billingMath');

function createNativePlatformBilling(db,stripe,now=()=>new Date()){
  async function start(request,plan,publishableKey){
    const companyId=documentId(request.data?.companyId,'Company'),uid=request.auth?.uid,ref=db.collection('companies').doc(companyId);
    const reservation=await db.runTransaction(async tx=>{
      const actor=await companyBillingMembership(db,tx,companyId,uid);
      if(!actor.administrator&&!actor.permissions.includes('890'))fail('permission-denied','Subscription management permission is required.');
      const company=actor.company,existing=await tx.get(ref.collection('subscriptions'));
      const active=existing.docs.find(doc=>doc.data().stripeSubscriptionId&&liveSubscription(doc.data().stripeStatus||doc.data().status));
      if(active)return {company,subscriptionId:active.data().stripeSubscriptionId};
      if(company.stripeSubscriptionId&&liveSubscription(company.stripeStatus))return {company,subscriptionId:company.stripeSubscriptionId};
      const prior=company.checkoutAttemptId?await tx.get(ref.collection('checkoutAttempts').doc(company.checkoutAttemptId)):null;
      const old=prior?.data();
      if(old&&!['failed','expired'].includes(old.status)){
        if(old.kind!=='native')fail('failed-precondition','Finish or expire the pending browser Checkout before starting mobile billing.');
        if(old.params.items[0].price!==plan.stripePriceId)fail('failed-precondition','Finish or cancel the existing billing setup before choosing a different plan.');
        return {company,attempt:{...old,id:prior.id}};
      }
      const version=Number(company.checkoutVersion||0)+1,attemptId=`native_${hash(`${companyId}:${version}`)}`;
      const customerData=company.checkoutCustomerData||{name:company.name||company.companyName||'Company',email:company.email||request.auth.token?.email||'',metadata:{companyId}};
      const params={items:[{price:plan.stripePriceId}],payment_behavior:'default_incomplete',payment_settings:{save_default_payment_method:'on_subscription'},metadata:{flow:'dripdrop_platform_subscription',companyId,userId:uid,dripDropSubscriptionId:plan.id||'',paymentAttemptId:attemptId},expand:['latest_invoice.payment_intent']};
      const attempt={kind:'native',platform:true,status:'creating',params,customerData,createdAt:now()};
      tx.set(ref.collection('checkoutAttempts').doc(attemptId),attempt);tx.set(ref,{checkoutAttemptId:attemptId,checkoutVersion:version,checkoutHold:true,checkoutCustomerData:customerData},{merge:true});
      return {company,attempt:{...attempt,id:attemptId}};
    });
    let customerId=reservation.company.stripeCustomerId||reservation.company.stripeId,subscriptionId=reservation.subscriptionId;
    if(subscriptionId&&!customerId){const saved=await stripe.subscriptions.retrieve(subscriptionId);if(saved.metadata?.companyId!==companyId)fail('permission-denied','Saved subscription ownership does not match.');customerId=id(saved.customer);}
    if(!customerId){const customer=await stripe.customers.create(reservation.attempt.customerData,{idempotencyKey:`billing_customer_${hash(ref.path)}`});customerId=customer.id;await ref.set({stripeCustomerId:customerId},{merge:true});}
    const customer=await stripe.customers.retrieve(customerId);
    if(customer.deleted||customer.metadata?.companyId&&customer.metadata.companyId!==companyId)fail('permission-denied','Saved billing customer does not match this company.');
    if(!subscriptionId){
      let cursor=null;
      do{const page=await stripe.subscriptions.list({customer:customerId,status:'all',limit:100,...(cursor?{starting_after:cursor}:{})});const live=page.data.filter(sub=>sub.metadata?.companyId===companyId&&liveSubscription(sub.status));
        if(live.length>1)fail('failed-precondition','Multiple Stripe subscriptions require billing review.');if(live[0])subscriptionId=live[0].id;cursor=!subscriptionId&&page.has_more?page.data.at(-1)?.id:null;
      }while(cursor);
    }
    let subscription=subscriptionId?await stripe.subscriptions.retrieve(subscriptionId,{expand:['latest_invoice.payment_intent']}):await stripe.subscriptions.create({...reservation.attempt.params,customer:customerId},{idempotencyKey:reservation.attempt.id});
    if(id(subscription.customer)!==customerId||subscription.metadata?.companyId!==companyId)fail('permission-denied','Stripe subscription ownership does not match.');
    if(subscription.items?.data?.[0]?.price?.id!==plan.stripePriceId)fail('failed-precondition','Manage the existing subscription before selecting a different plan.');
    await db.runTransaction(async tx=>{
      const current=await tx.get(ref);
      if(reservation.attempt&&current.data()?.checkoutAttemptId!==reservation.attempt.id)fail('aborted','Billing setup changed. Refresh before continuing.');
      if(current.data()?.stripeSubscriptionId&&current.data().stripeSubscriptionId!==subscription.id&&liveSubscription(current.data().stripeStatus))fail('failed-precondition','Another subscription already owns billing.');
      tx.set(ref,{stripeCustomerId:customerId,stripeSubscriptionId:subscription.id,stripeStatus:subscription.status,checkoutHold:false,updatedAt:now()},{merge:true});
      if(reservation.attempt)tx.set(ref.collection('checkoutAttempts').doc(reservation.attempt.id),{stripeSubscriptionId:subscription.id,status:'completed',updatedAt:now()},{merge:true});
    });
    if(subscription.status!=='incomplete')fail('failed-precondition','This company already has a subscription. Manage its billing instead of creating another.');
    let invoice=subscription.latest_invoice;
    if(typeof invoice==='string')invoice=await stripe.invoices.retrieve(invoice,{expand:['payment_intent']});
    const intent=typeof invoice?.payment_intent==='string'?await stripe.paymentIntents.retrieve(invoice.payment_intent):invoice?.payment_intent;
    const secret=invoice?.confirmation_secret?.client_secret||intent?.client_secret;
    if(!secret)fail('failed-precondition','The existing subscription has no payment to confirm. Refresh its billing status.');
    const version=String(request.data?.stripeVersion||''),ephemeral=await stripe.ephemeralKeys.create({customer:customerId},/^20\d\d-\d\d-\d\d(?:\.[a-z]+)?$/.test(version)?{apiVersion:version}:undefined);
    return {status:200,subscriptionId:subscription.id,customerId,ephemeralKey:ephemeral.secret,publishableKey,clientSecret:secret};
  }
  return {start};
}
module.exports={createNativePlatformBilling};
