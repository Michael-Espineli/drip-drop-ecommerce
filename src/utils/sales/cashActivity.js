import {hasPostedPayment} from './financialMetrics';
const millis=value=>value?.toMillis?.() ?? value?.getTime?.() ?? (typeof value==='number'?value:0);
export function cashActivity(payments,adjustments,startMillis,endMillis){
 const movements=[],missing=[];
 const paymentCurrencies=new Map(payments.map(payment=>[payment.id,payment.currency || 'usd']));
 const recordedRefunds=new Set(adjustments.filter(row=>row.kind==='refund').map(row=>row.paymentId));
 const recordedReversals=new Set(adjustments.filter(row=>['dispute','bankReturn','reversePayment'].includes(row.kind)).map(row=>row.paymentId));
 for(const payment of payments){
  if(!hasPostedPayment(payment))continue;
  if(Number(payment.refundedAmountCents)>0&&!recordedRefunds.has(payment.id))missing.push(payment.id);
  if(Number(payment.reversedAmountCents)>0&&!recordedReversals.has(payment.id))missing.push(payment.id);
  const date=millis(payment.receivedAt || payment.createdAt);
  if(!date){missing.push(payment.id);continue;}
  movements.push({id:`receipt:${payment.id}`,currency:payment.currency || 'usd',amountCents:Number(payment.amountCents)||0,date,kind:'receipt'});
 }
 const seen=new Set();
 for(const adjustment of adjustments){
  if(adjustment.cashMovements?.length){
   for(const row of adjustment.cashMovements){if(seen.has(row.id))continue;seen.add(row.id);movements.push({id:row.id,currency:row.currency || adjustment.currency || 'usd',amountCents:row.amountCents,date:row.createdAtMillis,kind:adjustment.kind});}
  }else if((adjustment.kind==='refund'&&adjustment.status==='succeeded')||adjustment.kind==='reversePayment'){
   const date=millis(adjustment.createdAt);if(!date){missing.push(adjustment.id);continue;}
   movements.push({id:`adjustment:${adjustment.id}`,currency:adjustment.currency || paymentCurrencies.get(adjustment.paymentId) || 'usd',amountCents:-Number(adjustment.amountCents || 0),date,kind:adjustment.kind,estimatedDate:adjustment.kind==='refund'});
  }else if(['dispute','bankReturn'].includes(adjustment.kind))missing.push(adjustment.id);
 }
 const rows=movements.filter(row=>row.date>=startMillis&&row.date<endMillis),byCurrency={};
 for(const row of rows){const currency=String(row.currency).toLowerCase();const totals=byCurrency[currency] || {receiptsCents:0,refundsAndReversalsCents:0,netCents:0};if(row.kind==='receipt')totals.receiptsCents+=row.amountCents;else totals.refundsAndReversalsCents+=row.amountCents;totals.netCents+=row.amountCents;byCurrency[currency]=totals;}
 return {rows,byCurrency,missing:[...new Set(missing)],estimatedDates:rows.filter(row=>row.estimatedDate).length};
}
