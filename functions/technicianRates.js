const {HttpsError}=require('firebase-functions/v2/https');
const {createTechnicianWorkWorkflow,record,rows,date,id,stable}=require('./technicianWorkWorkflow');
function createTechnicianRates(db,now=()=>new Date()) {
 const work=createTechnicianWorkWorkflow(db,now);
 return async request=>{
  if(!request.auth?.uid) throw new HttpsError('unauthenticated','Sign in first.');
  const d=request.data || {},companyId=id(d.companyId),drafts=Array.isArray(d.rates)?d.rates:[];
  if(!companyId || !d.requestId || !drafts.length || drafts.length>150) throw new HttpsError('invalid-argument','Provide a stable request ID and up to 150 rate changes.');
  return db.runTransaction(async t=>{
   const c=work.company(companyId),actor=await work.actorFor(t,companyId,request.auth.uid);
   if(!work.can(actor,'424')) throw new HttpsError('permission-denied','Manage Payroll permission is required.');
   const [allSnap,catalog]=await Promise.all([t.get(c.collection('technicianRates')),t.get(c.collection('companyPayTypes'))]);
   const rates=rows(allSnap),types=rows(catalog),changes=[],ids=[],keys=new Set();
   for(let index=0;index<drafts.length;index++) {
    const input=drafts[index],sourceId=id(input.existingId || input.id),previous=rates.find(v=>v.id===sourceId),rateId='comp_tech_rate_'+stable(String(d.requestId)+'_'+index);
    ids.push(rateId);if(rates.some(v=>v.id===rateId)) continue;
    if(previous?.replacedByRateId) throw new HttpsError('failed-precondition','This rate has already changed. Reload the current schedule before editing.');
    const technicianId=id(input.technicianId),payTypeId=id(input.payTypeId || input.workTypeId),amount=Number(input.amountCents);
    if(!technicianId || !Number.isInteger(amount) || amount<0 || !['serviceStop','serviceStopTask','technicianHourly'].includes(input.payBasis) || !['flatPerStop','flatPerTask','hourly','perBodyOfWater','perServiceLocation','percentage','manual'].includes(input.rateType)) throw new HttpsError('invalid-argument','Choose a technician, valid pay basis, rate type, and non-negative amount.');
    const scheduleKey=technicianId+'_'+input.payBasis+'_'+payTypeId;
    if(keys.has(scheduleKey))throw new HttpsError('invalid-argument','Submit one change per technician, pay item, and basis at a time.');keys.add(scheduleKey);
    if((input.payBasis==='technicianHourly')!==(input.rateType==='hourly'))throw new HttpsError('invalid-argument','Hourly rates require the hourly pay basis.');
    const type=types.find(v=>v.id===payTypeId);
    if(input.payBasis!=='technicianHourly' && (!type || type.isActive===false)) throw new HttpsError('failed-precondition','Choose an active pay item.');
    let start=date(input.effectiveStartDate || input.effectiveStartMillis || now());
    if(!Number.isFinite(start.getTime())) throw new HttpsError('invalid-argument','Choose a valid effective date.');
    if(previous && start<=date(previous.effectiveStartDate)) start=now();
    const matches=rates.filter(v=>v.technicianId===technicianId && v.payBasis===input.payBasis && id(v.payTypeId || v.workTypeId)===payTypeId && !['draft','archived'].includes(v.status));
    const next=matches.filter(v=>date(v.effectiveStartDate)>start).sort((a,b)=>date(a.effectiveStartDate)-date(b.effectiveStartDate))[0];
    matches.filter(v=>date(v.effectiveStartDate)<=start && (!v.effectiveEndDate || date(v.effectiveEndDate)>=start)).forEach(v=>changes.push({id:v.id,payload:{effectiveEndDate:new Date(start.getTime()-1),status:'expired',replacedByRateId:rateId,updatedAt:now()},merge:true}));
    changes.push({id:rateId,payload:{id:rateId,companyId,technicianId,payBasis:input.payBasis,payTypeId:payTypeId || null,payTypeName:type?.name || null,amountCents:amount,rateType:input.rateType,effectiveStartDate:start,effectiveEndDate:next?new Date(date(next.effectiveStartDate).getTime()-1):null,status:start>now()?'scheduled':'active',ratePlanId:input.ratePlanId || 'manual_'+rateId,previousRateId:previous?.id || null,reason:String(input.reason || ''),createdAt:now(),createdByUserId:actor.uid,isBaseTechnicianRate:input.isBaseTechnicianRate===true}});
   }
   changes.forEach(change=>t.set(c.collection('technicianRates').doc(change.id),change.payload,{merge:!!change.merge}));
   return {rateIds:ids};
  });
 };
}
module.exports={createTechnicianRates};
