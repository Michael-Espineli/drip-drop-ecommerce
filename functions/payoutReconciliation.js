const {onCall}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {randomUUID}=require('node:crypto');
const {billingActor}=require('./billingAccess');
const {documentId,fail}=require('./companyActor');
const {id,hash}=require('./billingMath');
const {getStripe}=require('./stripe/stripeClient');

function createPayoutReconciliation(db,stripe,lifecycle,now=()=>new Date()){
  async function sync(event,payoutId){
    if(!event.account)return false;
    const company=await lifecycle.companyFor(event.account);if(!company)return false;
    const options={stripeAccount:event.account};
    return lifecycle.leased(event,`payout:${payoutId}`,async lease=>{
      const payout=await stripe.payouts.retrieve(payoutId,{},options),rows=[];
      if(payout.automatic&&payout.reconciliation_status!=='in_progress'){
        let cursor=null;
        do{const page=await stripe.balanceTransactions.list({payout:payout.id,limit:100,...(cursor?{starting_after:cursor}:{})},options);rows.push(...page.data);cursor=page.has_more?page.data.at(-1)?.id:null;}while(cursor);
      }
      let gross=0,fees=0,net=0,unmatched=0;
      for(let offset=0;offset<rows.length;offset+=100){
        const page=rows.slice(offset,offset+100),prepared=[];
        for(const row of page){
          const source=id(row.source),payments=source?await db.collection('salesPayments').where('stripeChargeId','==',source).where('stripeConnectedAccountId','==',event.account).get():{docs:[]};
          const adjustments=await db.collection('salesPaymentAdjustments').where('stripeBalanceTransactionId','==',row.id).where('stripeConnectedAccountId','==',event.account).get();
          const matches=[...payments.docs,...adjustments.docs].filter(doc=>doc.data().companyId===company.value.id);
          gross+=row.amount;fees+=row.fee;net+=row.net;if(!matches.length)unmatched++;
          prepared.push({row,source,matches});
        }
        await db.runTransaction(async tx=>{
          const lock=await tx.get(lease.lockRef);if(lock.data()?.token!==lease.token)fail('aborted','Payout synchronization lease changed. Retry.');
          const saved=await Promise.all(prepared.flatMap(item=>item.matches).map(doc=>tx.get(doc.ref)));
          for(const item of prepared){
            tx.set(company.ref.collection('stripeBalanceTransactions').doc(item.row.id),{id:item.row.id,companyId:company.value.id,stripeConnectedAccountId:event.account,stripePayoutId:payout.id,stripeSourceId:item.source,
              type:item.row.type,reportingCategory:item.row.reporting_category||'',currency:item.row.currency,grossAmountCents:item.row.amount,feeAmountCents:item.row.fee,netAmountCents:item.row.net,
              feeDetails:(item.row.fee_details||[]).map(fee=>({amountCents:fee.amount,type:fee.type,description:fee.description||'',applicationId:id(fee.application)})),
              matchedPaymentIds:item.matches.map(doc=>doc.id),matchedInvoiceIds:[...new Set(item.matches.map(doc=>doc.data().invoiceId).filter(Boolean))],reconciliationStatus:item.matches.length?'matched':'unmatched',stripeCreatedAt:new Date(item.row.created*1000),updatedAt:now()},{merge:true});
          }
          for(const doc of saved)tx.set(doc.ref,{stripePayoutIds:[...new Set([...(doc.data()?.stripePayoutIds||[]),payout.id])],reconciliationUpdatedAt:now()},{merge:true});
        });
      }
      return async tx=>{
        const ref=company.ref.collection('stripePayouts').doc(payout.id),old=await tx.get(ref);
        tx.set(ref,{id:payout.id,stripePayoutId:payout.id,companyId:company.value.id,stripeConnectedAccountId:event.account,amountCents:payout.amount,currency:payout.currency,status:payout.status,
          arrivalDate:new Date(payout.arrival_date*1000),stripeCreatedAt:new Date(payout.created*1000),automatic:!!payout.automatic,method:payout.method,type:payout.type,
          stripeBalanceTransactionId:id(payout.balance_transaction),stripeFailureBalanceTransactionId:id(payout.failure_balance_transaction),failureCode:payout.failure_code||'',failureMessage:payout.failure_message||'',
          grossAmountCents:payout.automatic?gross:null,feeAmountCents:payout.automatic?fees:null,netAmountCents:payout.automatic?net:null,transactionCount:rows.length,unmatchedTransactionCount:unmatched,
          reconciliationDifferenceCents:payout.automatic?net-payout.amount:null,
          reconciliationStatus:!payout.automatic?'manualPayoutReview':payout.reconciliation_status==='in_progress'?'pending':net!==payout.amount||unmatched?'reviewRequired':'reconciled',
          lastStripeEventId:event.id,createdAt:old.data()?.createdAt||now(),updatedAt:now()},{merge:true});return true;
      };
    });
  }
  async function refresh(request){
    const companyId=documentId(request.data?.companyId,'Company');
    const actor=await billingActor(db,{get:ref=>ref.get()},companyId,request.auth?.uid);
    const account=actor.company.stripeConnectedAccountId||actor.company.stripeConnectAccountId;
    if(!account)fail('failed-precondition','Connect a Stripe account first.');
    const cursor=request.data?.startingAfter;if(cursor&&!/^po_[a-zA-Z0-9]+$/.test(cursor))fail('invalid-argument','Invalid payout cursor.');
    const page=await stripe.payouts.list({limit:20,...(cursor?{starting_after:cursor}:{})},{stripeAccount:account});
    for(const payout of page.data)await sync({id:`refresh_${hash(`${companyId}:${payout.id}:${randomUUID()}`)}`,type:'payout.updated',account},payout.id);
    return {count:page.data.length,hasMore:page.has_more,nextCursor:page.has_more?page.data.at(-1)?.id:null};
  }
  return {sync,refresh};
}
exports.createPayoutReconciliation=createPayoutReconciliation;
exports.refreshCompanyPayoutReconciliation=onCall({cors:true},request=>{
  const db=admin.firestore(),stripe=getStripe(),lifecycle=require('./stripeLifecycle').createStripeLifecycle(db,stripe);
  return createPayoutReconciliation(db,stripe,lifecycle).refresh(request);
});
