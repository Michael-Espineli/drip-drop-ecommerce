const { HttpsError }=require('firebase-functions/v2/https');
const { createTechnicianWorkWorkflow, id, record, rows, date, stable }=require('./technicianWorkWorkflow');
const { calculatePayLines }=require('./payrollCalculation');
const fail=(code,message)=>{throw new HttpsError(code,message);};
function createTechnicianPayRequests(db,now=()=>new Date()) {
 const work=createTechnicianWorkWorkflow(db,now);
 async function command(request) {
  const uid=request.auth?.uid,d=request.data || {},companyId=id(d.companyId);
  if(!uid) fail('unauthenticated','Sign in first.');
  if(!companyId) fail('invalid-argument','Company is required.');
  return db.runTransaction(async t=>{
   const c=work.company(companyId),a=await work.actorFor(t,companyId,uid),manager=work.can(a,'424');
   const ref=c.collection('payChangeRequests').doc(id(d.requestId) || stable(uid+'_'+id(d.clientRequestId)));
   if(!d.requestId && !d.clientRequestId) fail('invalid-argument','A stable request ID is required.');
   const existing=record(await t.get(ref));
   if(d.action==='create' || d.action==='propose') {
    if(existing) { if(existing.technicianId!==uid && !manager) fail('permission-denied','Request belongs to another technician.'); return {requestId:ref.id,status:existing.status}; }
    if(d.action==='propose' && !manager) fail('permission-denied','Only payroll managers can propose rates.');
    const technicianId=d.action==='propose'?id(d.technicianId):uid;
    if(!technicianId) fail('invalid-argument','Choose a technician.');
    const type=d.type || 'rateChange'; if(!['rateChange','payCorrection','payout'].includes(type)) fail('invalid-argument','Choose a request type.');
    const amount=Number(d.amountCents); if(!Number.isInteger(amount) || amount<0) fail('invalid-argument','Enter a non-negative amount in cents.');
    if(!String(d.reason || '').trim()) fail('invalid-argument','Describe the requested change.');
    let payType=null,source=null;
    if(type==='rateChange') {
     if((d.payBasis==='technicianHourly')!==(d.rateType==='hourly'))fail('invalid-argument','Hourly rates require the hourly pay basis.');
     if(!['serviceStop','serviceStopTask','technicianHourly'].includes(d.payBasis) || !['flatPerStop','flatPerTask','hourly','perBodyOfWater','perServiceLocation','percentage'].includes(d.rateType)) fail('invalid-argument','Choose a valid pay basis and rate type.');
     payType=d.payTypeId?record(await t.get(c.collection('companyPayTypes').doc(id(d.payTypeId)))):null;
     if(d.payBasis!=='technicianHourly' && (!payType || payType.isActive===false)) fail('invalid-argument','Choose an active pay item.');
     if(!Number.isFinite(date(d.effectiveStartMillis).getTime()) || date(d.effectiveStartMillis)<new Date(now().toISOString().slice(0,10)+'T00:00:00Z')) fail('invalid-argument','Choose a current or future effective date.');
    }
    if(type==='payCorrection') { source=record(await t.get(c.collection('technicianPayLineItems').doc(id(d.payLineItemId)))); if(!source || source.technicianId!==technicianId) fail('permission-denied','Choose one of your earned-pay items.'); }
    const status=d.action==='propose'?'Counteroffered':'Pending';
    t.set(ref,{id:ref.id,companyId,technicianId,technicianName:d.action==='propose'?String(d.technicianName || technicianId):a.name,type,status,amountCents:amount,counterAmountCents:d.action==='propose'?amount:null,payTypeId:payType?.id || '',payTypeName:payType?.name || '',payBasis:d.payBasis || 'manualAdjustment',rateType:d.rateType || 'manual',effectiveStartDate:type==='rateChange'?date(d.effectiveStartMillis):null,payLineItemId:source?.id || '',reason:String(d.reason).trim(),createdAt:now(),updatedAt:now(),createdByUserId:uid,history:[{action:d.action,actorId:uid,at:now(),amountCents:amount}]});
    const recipient=d.action==='propose'?technicianId:a.company.ownerId;
    if(recipient) t.set(db.collection('users').doc(recipient).collection('alerts').doc('pay_request_'+ref.id),{source:'payChangeRequest',recipientUserId:recipient,companyId,title:d.action==='propose'?'New pay proposal':'New pay request',message:d.action==='propose'?'Review your proposed rate schedule.':a.name+' submitted a pay request.',status:'Unread',read:false,createdAt:now(),date:now(),route:'/company/payroll'});
    return {requestId:ref.id,status};
   }
   if(!existing) fail('not-found','Pay request not found.');
   if(!['Pending','Counteroffered'].includes(existing.status)) return {requestId:ref.id,status:existing.status};
   const counterResponse=d.action==='acceptCounter' || d.action==='declineCounter';
   if(counterResponse && (existing.technicianId!==uid || existing.status!=='Counteroffered')) fail('permission-denied','This counteroffer is for another technician.');
   if(!counterResponse && !manager) fail('permission-denied','Payroll approval is required.');
   if(d.action==='approve' && existing.status==='Counteroffered') fail('failed-precondition','The technician must accept the counteroffer.');
   if(!['approve','reject','counter','acceptCounter','declineCounter'].includes(d.action)) fail('invalid-argument','Choose a valid decision.');
   const amount=d.action==='counter'?Number(d.amountCents):d.action==='acceptCounter'?existing.counterAmountCents:existing.amountCents;
   if(!Number.isInteger(amount) || amount<0) fail('invalid-argument','Enter a non-negative amount.');
   const approved=d.action==='approve' || d.action==='acceptCounter';
   const rates=approved && existing.type==='rateChange'?rows(await t.get(c.collection('technicianRates').where('technicianId','==',existing.technicianId))):[];
   const source=approved && existing.type==='payCorrection'?record(await t.get(c.collection('technicianPayLineItems').doc(existing.payLineItemId))):null;
   const adjustments=approved && existing.type==='payCorrection'?rows(await t.get(c.collection('technicianPayLineItems').where('previousPayLineItemId','==',existing.payLineItemId))):[];
   if(approved && existing.type==='rateChange') {
    const start=date(existing.effectiveStartDate); if(start<new Date(now().toISOString().slice(0,10)+'T00:00:00Z')) fail('failed-precondition','The effective date has passed. Counteroffer a new effective date.');
    const relevant=rates.filter(v=>v.payBasis===existing.payBasis && id(v.payTypeId || v.workTypeId)===existing.payTypeId && !['draft','archived'].includes(v.status));
    const next=relevant.filter(v=>date(v.effectiveStartDate)>start).sort((x,y)=>date(x.effectiveStartDate)-date(y.effectiveStartDate))[0];
    relevant.filter(v=>date(v.effectiveStartDate)<=start && (!v.effectiveEndDate || date(v.effectiveEndDate)>=start)).forEach(v=>t.set(c.collection('technicianRates').doc(v.id),{effectiveEndDate:new Date(start.getTime()-1),status:'expired',updatedAt:now()},{merge:true}));
    const rateId='comp_tech_rate_request_'+ref.id;
    t.set(c.collection('technicianRates').doc(rateId),{id:rateId,companyId,technicianId:existing.technicianId,ratePlanId:'request_'+ref.id,payBasis:existing.payBasis,payTypeId:existing.payTypeId || null,payTypeName:existing.payTypeName || null,amountCents:amount,rateType:existing.rateType,effectiveStartDate:start,effectiveEndDate:next?new Date(date(next.effectiveStartDate).getTime()-1):null,status:start>now()?'scheduled':'active',reason:existing.reason,createdAt:now(),createdByUserId:uid,previousRateId:relevant.filter(v=>date(v.effectiveStartDate)<=start).sort((x,y)=>date(y.effectiveStartDate)-date(x.effectiveStartDate))[0]?.id || null,payChangeRequestId:ref.id});
   }
   if(approved && existing.type==='payCorrection') {
    if(!source || source.technicianId!==existing.technicianId) fail('failed-precondition','The original earned-pay item is missing.');
    const adjustmentId='comp_pay_adjustment_'+ref.id;
    const correctedAmount=Number(source.totalAmountCents || 0)+adjustments.filter(v=>v.calculationStatus!=='voided').reduce((sum,v)=>sum+Number(v.totalAmountCents || 0),0);
    const difference=amount-correctedAmount;
    t.set(c.collection('technicianPayLineItems').doc(adjustmentId),{...source,id:adjustmentId,source:'manualAdjustment',payrollSource:'payCorrection',payrollComponentId:'adjustment:'+ref.id,totalAmountCents:difference,rateAmountCents:difference,rateType:'manual',payBasis:'manualAdjustment',quantity:1,quantityUnit:'each',calculationStatus:'approved',approvedAt:now(),approvedByUserId:uid,paidAt:null,paidByUserId:null,payStatementId:null,exportBatchId:null,voidedAt:null,previousPayLineItemId:source.id,payChangeRequestId:ref.id,notes:existing.reason,calculatedAt:now(),completedDate:now()});
   }
   const status=approved?'Approved':d.action==='counter'?'Counteroffered':'Rejected';
   const patch={status,updatedAt:now(),decisionByUserId:uid,decisionReason:String(d.reason || ''),history:[...(existing.history || []),{action:d.action,actorId:uid,at:now(),amountCents:amount,reason:String(d.reason || '')}]};
   if(d.action==='counter') { patch.counterAmountCents=amount; if(d.effectiveStartMillis) patch.effectiveStartDate=date(d.effectiveStartMillis); }
   t.set(ref,patch,{merge:true});
   t.set(db.collection('users').doc(existing.technicianId).collection('alerts').doc('pay_request_'+ref.id+'_'+status),{source:'payChangeRequest',relatedEntity:{type:'payChangeRequest',id:ref.id},recipientUserId:existing.technicianId,title:'Pay request '+status,message:patch.decisionReason || existing.reason,status:'Unread',read:false,createdAt:now(),date:now(),route:'/company/payroll'});
   return {requestId:ref.id,status};
  });
 }
 return {command};
}
module.exports={createTechnicianPayRequests};
