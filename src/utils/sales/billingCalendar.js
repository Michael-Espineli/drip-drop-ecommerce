// Keep calendar behavior aligned with functions/billingCalendar.js (shared fixture tests).
const millis=value=>value?.toMillis?.() ?? value?.getTime?.() ?? (typeof value?.seconds==='number'?value.seconds*1000:typeof value?._seconds==='number'?value._seconds*1000:typeof value==='number'?value:typeof value==='string'?Date.parse(value):0);
const key=value=>String(value||'').replace(/[^a-z0-9]/gi,'').toLowerCase();

// Billing dates belong to the company's calendar, independent of the worker's TZ.
function parts(value,timeZone='UTC') {
  const result={};
  for(const p of new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(millis(value))))
    if(p.type!=='literal')result[p.type]=Number(p.value);
  return result;
}
function zonedDate(p,timeZone='UTC') {
  const target=Date.UTC(p.year,p.month-1,p.day,p.hour||0,p.minute||0,p.second||0);
  let instant=target;const seen=new Set();
  for(let i=0;i<4;i++){
    const local=parts(instant,timeZone),offset=Date.UTC(local.year,local.month-1,local.day,local.hour,local.minute,local.second)-instant;
    const next=target-offset;if(next===instant)break;
    // A missing spring-forward wall time rolls forward by the DST gap.
    if(seen.has(next))return new Date(Math.max(next,...seen));
    seen.add(instant);instant=next;
  }
  return new Date(instant);
}
const dayStart=(value,tz)=>zonedDate({...parts(value,tz),hour:0,minute:0,second:0},tz);
const dateKey=(value,tz)=>{const p=parts(value,tz);return `${p.year}${String(p.month).padStart(2,'0')}${String(p.day).padStart(2,'0')}`;};
function addInterval(value,interval='month',count=1,timeZone='UTC',anchorDay) {
  const p=parts(value,timeZone),unit=key(interval);count=Math.max(1,Number(count)||1);
  if(!Number.isInteger(count))throw new Error('Billing interval count must be an integer.');
  if(unit.includes('day')||unit.includes('week')){
    const date=new Date(Date.UTC(p.year,p.month-1,p.day+count*(unit.includes('week')?7:1)));
    Object.assign(p,{year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()});
  } else {
    const month=new Date(Date.UTC(p.year+(unit.includes('year')?count:0),p.month-1+(unit.includes('year')?0:count),1));
    Object.assign(p,{year:month.getUTCFullYear(),month:month.getUTCMonth()+1});
    p.day=Math.min(anchorDay||p.day,new Date(Date.UTC(p.year,p.month,0)).getUTCDate());
  }
  return zonedDate(p,timeZone);
}
function billingPeriod(subscription={},company={},now=new Date()) {
  const timeZone=subscription.billingTimeZone||company.billingTimeZone||company.timeZone||'UTC';
  const fallback=subscription.currentPeriodStart||subscription.agreementSnapshot?.acceptedAt||subscription.createdAt||now;
  const start=dayStart(subscription.manualBillingNextPeriodStart||fallback,timeZone);
  const invoiceSendAt=new Date(millis(subscription.manualBillingNextInvoiceAt||subscription.manualBillingNextPeriodStart||fallback));
  const anchorDay=subscription.billingAnchorDay||parts(subscription.currentPeriodStart||subscription.agreementSnapshot?.startDate||subscription.manualBillingNextPeriodStart||fallback,timeZone).day;
  const sendAnchorDay=subscription.billingSendAnchorDay||parts(invoiceSendAt,timeZone).day;
  const add=(value,anchor=anchorDay)=>addInterval(value,subscription.interval,subscription.intervalCount,timeZone,anchor);
  const savedEnd=millis(subscription.manualBillingNextPeriodEnd||subscription.currentPeriodEnd);
  const end=savedEnd>start.getTime()?dayStart(savedEnd,timeZone):add(start);
  const dueDays=({net7:7,net14:14,net15:15,net30:30})[key(subscription.paymentTerms)]||0;
  const dueDate=dueDays?addInterval(dayStart(invoiceSendAt,timeZone),'day',dueDays,timeZone):dayStart(invoiceSendAt,timeZone);
  const nextInvoiceAt=add(invoiceSendAt,sendAnchorDay);
  return {timeZone,anchorDay,sendAnchorDay,invoiceSendAt,periodStart:start,periodEnd:end,nextPeriodStart:end,nextPeriodEnd:add(end),nextInvoiceAt,dueDate,
    nextDueDate:dueDays?addInterval(dayStart(nextInvoiceAt,timeZone),'day',dueDays,timeZone):dayStart(nextInvoiceAt,timeZone),
    invoiceId:`si_${subscription.id}_${dateKey(start,timeZone)}`,invoiceNumber:`REC-${dateKey(start,timeZone)}-${String(subscription.id||'').slice(-6).toUpperCase()}`};
}
export {parts,zonedDate,dayStart,dateKey,addInterval,billingPeriod};
