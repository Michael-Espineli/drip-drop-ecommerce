const { HttpsError } = require('./appErrors');
const {createTechnicianWorkWorkflow,rows,date,id,stable}=require('./technicianWorkWorkflow');
const {calendarDate,dateKey,timeZone}=require('./routeState');
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
   const savedAt=now();
   for(let index=0;index<drafts.length;index++) {
    const input=drafts[index],sourceId=id(input.existingId || input.id),previous=rates.find(v=>v.id===sourceId),rateId='comp_tech_rate_'+stable(String(d.requestId)+'_'+index);
    ids.push(rateId);if(rates.some(v=>v.id===rateId)) continue;
    const technicianId=id(input.technicianId),payTypeId=id(input.payTypeId || input.workTypeId),amount=Number(input.amountCents);
    if(!technicianId || !Number.isInteger(amount) || amount<0 || !['serviceStop','technicianHourly'].includes(input.payBasis) || !['flatPerStop','hourly','perBodyOfWater','perServiceLocation','percentage','manual'].includes(input.rateType)) throw new HttpsError('invalid-argument','Choose a technician, valid pay basis, rate type, and non-negative amount.');
    const scheduleKey=technicianId+'_'+input.payBasis+'_'+payTypeId;
    if(keys.has(scheduleKey))throw new HttpsError('invalid-argument','Submit one change per technician, pay item, and basis at a time.');keys.add(scheduleKey);
    if((input.payBasis==='technicianHourly')!==(input.rateType==='hourly'))throw new HttpsError('invalid-argument','Hourly rates require the hourly pay basis.');
    const type=types.find(v=>v.id===payTypeId);
    if(input.payBasis!=='technicianHourly' && (!type || type.isActive===false)) throw new HttpsError('failed-precondition','Choose an active pay item.');
    const effectiveToday=input.effectiveToday===true;
    const zone=effectiveToday || input.effectiveStartDay != null ? timeZone(actor.company, d.timeZone || 'America/Los_Angeles') : null;
    const startDay=effectiveToday ? dateKey(savedAt, zone) : input.effectiveStartDay;
    let start=zone ? calendarDate(startDay, zone, 0)
     : date(input.effectiveStartDate ?? input.effectiveStartMillis ?? savedAt);
    if(!Number.isFinite(start.getTime())) throw new HttpsError('invalid-argument','Choose a valid effective date.');
    if(!zone && previous && start<=date(previous.effectiveStartDate)) start=savedAt;
    const versions=rates.filter(v=>v.technicianId===technicianId && v.payBasis===input.payBasis &&
     id(v.payTypeId || v.payWorkTypeId || v.workTypeId)===payTypeId && v.active!==false && v.isActive!==false &&
     !['draft','archived','inactive','deleted'].includes(String(v.status || '').toLowerCase()))
     .map(v=>({ id:v.id, start:v.effectiveStartDate ? date(v.effectiveStartDate) : null,
      end:v.effectiveEndDate ? date(v.effectiveEndDate) : null }));
    const prior=versions.find(v=>v.id===sourceId);
    if((input.existingId && !previous) ||
       (previous?.replacedByRateId && (!prior?.end || prior.end<savedAt || prior.start && prior.end<prior.start))) {
     throw new HttpsError('failed-precondition','This rate has already changed. Reload the current schedule before editing.');
    }
    // A date-only edit also replaces legacy entries that start later that day.
    const replacesLaterOnStartDay=v=>zone && v.start>start && (!v.end || v.end>=v.start) && dateKey(v.start, zone)===startDay;
    const rescheduled=!effectiveToday && zone && prior?.start>savedAt && prior.start<start;
    const replaceFutureVersion=v=>replacesLaterOnStartDay(v) ||
     (!effectiveToday && zone && v.id===sourceId && v.start>savedAt);
    const upcoming=versions.filter(v=>v.start>start && (!v.end || v.end>=v.start) && !replaceFutureVersion(v))
     .sort((a,b)=>a.start-b.start);
    const endBefore=value=>new Date(value.getTime()-1);
    for (const version of versions) {
     if (rescheduled && version.end?.getTime()===endBefore(prior.start).getTime() &&
         (!version.start || version.end>=version.start)) {
      const nextStart=versions.filter(v=>v.start>=prior.start && !replaceFutureVersion(v) && (!v.end || v.end>=v.start))
       .reduce((next,v)=>v.start<next ? v.start : next,start);
      changes.push({ id:version.id, merge:true, payload:{
       effectiveEndDate:endBefore(nextStart), status:'expired', replacedByRateId:rateId, updatedAt:savedAt,
      } });
     } else if (replaceFutureVersion(version) ||
                ((!version.start || version.start<=start) && (!version.end || version.end>=start))) {
      const cutoff=version.id===sourceId && rescheduled ? version.start : start;
      changes.push({ id:version.id, merge:true, payload:{
       effectiveEndDate:endBefore(cutoff), status:'expired', replacedByRateId:rateId, updatedAt:savedAt,
      } });
     }
    }
    changes.push({ id:rateId, payload:{
     id:rateId, companyId, technicianId, payBasis:input.payBasis, payTypeId:payTypeId || null, payTypeName:type?.name || null,
     amountCents:amount, rateType:input.rateType, effectiveStartDate:start,
     effectiveEndDate:upcoming.length ? endBefore(upcoming[0].start) : null, status:start>savedAt ? 'scheduled' : 'active',
     ratePlanId:input.ratePlanId || 'manual_'+rateId, previousRateId:previous?.id || null, reason:String(input.reason || ''),
     createdAt:savedAt, createdByUserId:actor.uid, isBaseTechnicianRate:input.isBaseTechnicianRate===true,
    } });
   }
   changes.forEach(change=>t.set(c.collection('technicianRates').doc(change.id),change.payload,{merge:!!change.merge}));
   return {rateIds:ids};
  });
 };
}
module.exports={createTechnicianRates};
