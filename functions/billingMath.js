const {createHash}=require('node:crypto');
const {fail}=require('./companyActor');
const id=value=>typeof value==='string'?value:value?.id || '';
const key=value=>String(value ?? '').replace(/[^a-z0-9]/gi,'').toLowerCase();
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex').slice(0,40);
const millis=value=>value?.toMillis?.() ?? value?.getTime?.() ?? (typeof value?.seconds==='number'?value.seconds*1000:typeof value?._seconds==='number'?value._seconds*1000:typeof value==='number'?value:typeof value==='string'?Date.parse(value):0);
const money=(value,label='Amount',signed=false)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||Math.abs(value)>999999999999||(!signed&&value<0))fail('failed-precondition',`${label} must be a valid integer number of cents.`);return value;};
const liveSubscription=value=>value && !['canceled','cancelled','incompleteexpired'].includes(key(value));
function pricing(record={}){
 const currency=String(record.currency || 'usd').toLowerCase();
 if(!/^[a-z]{3}$/.test(currency))fail('failed-precondition','Choose a valid billing currency.');
 const source=Array.isArray(record.lineItems)?record.lineItems:[];
 const lines=source.map((line,index)=>{
  const quantity=Number(line.quantity ?? 1);if(!Number.isFinite(quantity)||quantity<0||quantity>1000000)fail('failed-precondition','Billing quantities must be valid nonnegative numbers.');
  const unit=money(Number(line.unitAmountCents ?? (quantity?Math.round(Number(line.totalAmountCents || 0)/quantity):0)),'Unit price',true);
  let total=money(Math.round(unit*quantity),'Line total',true);
  if(['discount','credit'].includes(key(line.type)))total=-Math.abs(total);
  if(line.totalAmountCents!=null && Math.abs(Number(line.totalAmountCents))!==Math.abs(total))fail('failed-precondition','Billing lines changed. Review and accept an updated price snapshot.');
  return {...line,id:line.id || `line_${index}`,name:line.name || line.description || 'Pool service',quantity,unitAmountCents:unit,totalAmountCents:total};
 }).filter(line=>line.quantity>0);
 if(source.length&&!lines.length)fail('failed-precondition','No positive billing quantities remain. Review the accepted agreement before collecting payment.');
 const discount=money(Number(record.discountAmountCents ?? 0),'Discount'),tax=money(Number(record.taxAmountCents ?? 0),'Tax');
 const declared=money(Number(record.amountCents ?? record.totalAmountCents ?? 0),'Accepted total');
 const subtotal=lines.length?money(lines.reduce((n,line)=>n+line.totalAmountCents,0),'Subtotal'):declared+discount-tax;
 const total=money(subtotal-discount+tax,'Total');
 if(total!==declared)fail('failed-precondition','The accepted billing total does not match its pricing lines. Review the agreement before collecting payment.');
 if(!total)fail('failed-precondition','No recurring payment is due for this price.');
 return {currency,lines:lines.length?lines:[{id:'service',name:record.agreementSnapshot?.title || record.title || 'Pool service',quantity:1,unitAmountCents:total,totalAmountCents:total}],subtotalAmountCents:subtotal,discountAmountCents:discount,taxAmountCents:tax,totalAmountCents:total};
}
function period(subscription={}){
 const items=subscription.items?.data || [];
 const starts=items.map(item=>item.current_period_start).filter(Number.isFinite),ends=items.map(item=>item.current_period_end).filter(Number.isFinite);
 return {start:subscription.current_period_start ?? (starts.length?Math.min(...starts):null),end:subscription.current_period_end ?? (ends.length?Math.max(...ends):null)};
}
const invoiceSubscription=invoice=>id(invoice.subscription) || id(invoice.parent?.subscription_details?.subscription);
const paymentIntent=invoice=>id(invoice.payment_intent) || id(invoice.payments?.data?.find(payment=>payment.payment?.type==='payment_intent')?.payment?.payment_intent);
module.exports={id,key,hash,millis,money,liveSubscription,pricing,period,invoiceSubscription,paymentIntent};
