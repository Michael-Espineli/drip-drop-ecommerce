const { HttpsError }=require('firebase-functions/v2/https');
const {randomUUID}=require('node:crypto');
const {createTechnicianWorkWorkflow,id,record,rows,date,key,stable,routeIds}=require('./technicianWorkWorkflow');
const {calculatePayLines,reconcilePayLines,selectPayRate}=require('./payrollCalculation');
const fail=(code,message)=>{throw new HttpsError(code,message);};
function createTechnicianTime(db,now=()=>new Date()) {
 const work=createTechnicianWorkWorkflow(db,now);
 async function command(request) {
  if(!request.auth?.uid) fail('unauthenticated','Sign in first.');
  const d=request.data || {},companyId=id(d.companyId), uid=request.auth.uid;
  if(!companyId) fail('invalid-argument','Select a company.');
  const requestId=id(d.requestId) || randomUUID();
  return db.runTransaction(async t=>{
   const c=work.company(companyId),actor=await work.actorFor(t,companyId,uid);
   const person=c.collection('companyUsers').doc(actor.user.id || uid);
   const locked=record(await t.get(person));
   let clock=locked?.timeClock || {};
   const openShifts=rows(await t.get(c.collection('shifts').where('techId','==',uid).where('isCurrent','==',true)));
   const openLogs=rows(await t.get(c.collection('workLogs').where('userId','==',uid).where('current','==',true)));
   if(openLogs.length>1) fail('failed-precondition','Multiple open work logs need management review before clock changes.');
   const log=openLogs[0],shift=openShifts.find(v=>v.id===log?.shiftId);
   if(log && !shift) fail('failed-precondition','The open work log has no active shift. Management must review it.');
   const staleShifts=openShifts.filter(v=>v.id!==shift?.id);
   const staleLogs=await Promise.all(staleShifts.map(v=>t.get(c.collection('workLogs').where('shiftId','==',v.id))));
   if(d.action==='status') return {shiftId:shift?.id || null,logId:log?.id || null};
   if(clock.lastRequestId===requestId) return {shiftId:clock.shiftId || '',logId:clock.logId || '',alreadyApplied:true};
   const when=now();
   const ctx=await work.context(t,c,actor);
   const linkedOfferId=d.action==='clockOut' || d.offerId===undefined ? id(log?.workOfferId) : id(d.offerId);
   const linkedOffer=linkedOfferId ? record(await t.get(c.collection('workOffers').doc(linkedOfferId))) : null;
   const accepted=linkedOffer?.claims?.find(v=>v.workerId===uid && ['Accepted','Scheduled','In Progress','Completed'].includes(v.status));
   if(accepted?.status==='Completed' && d.action==='clockIn') fail('failed-precondition','This work is completed. Choose current work or general shift time.');
   if(linkedOfferId && !accepted) fail('permission-denied','Choose accepted work assigned to you.');
   const agreedLines=(accepted?.agreement.quotedPayLines || []).filter(v=>v.rateType==='hourly');
   const uniqueHourly=[...new Set(agreedLines.map(v=>v.rateId))];
   if(uniqueHourly.length>1) fail('failed-precondition','This offer has mixed hourly rates. Record time against its individual tasks instead.');
   const agreedRate=accepted?.agreement.rates?.find(v=>v.id===uniqueHourly[0]) || (accepted ? selectPayRate({companyId,technicianId:uid,workTypeId:'',basis:'technicianHourly',hourlyFallback:true,rates:accepted.agreement.rates || [],date:date(accepted.agreement.acceptedAt)}):null);
   const shiftRate=shift?.hourlyRateSnapshot || selectPayRate({companyId,technicianId:uid,workTypeId:'',basis:'technicianHourly',hourlyFallback:true,rates:ctx.rates,date:when});
   const allocation={workOfferClaimId:accepted?.id || null,workOfferId:linkedOfferId || null,jobId:linkedOffer?.jobId || null,hourlyRateSnapshot:agreedRate || shiftRate || null,timePayIncluded:!!accepted && ['Offered Amount','Unpaid'].includes(accepted.agreement.paySource)};
   staleShifts.forEach((stale,index)=>{
     const ends=rows(staleLogs[index]).filter(v=>v.endTime).map(v=>date(v.endTime).getTime()).filter(Number.isFinite);
     t.set(c.collection('shifts').doc(stale.id),{isCurrent:false,endTime:ends.length?new Date(Math.max(...ends)):stale.date,closedByReconciliation:true,payrollHistoricalRepairOnly:true,repairReason:'Legacy shift left open after its work logs closed.'},{merge:true});
   });
   if(d.action==='clockIn') {
    if(shift || log) return {shiftId:shift?.id || '',logId:log?.id || '',alreadyApplied:true};
    const shiftId='comp_shi_'+stable(uid+'_'+requestId),logId='work_log_'+stable(shiftId+'_start');
    t.set(c.collection('shifts').doc(shiftId),{id:shiftId,date:when,techId:uid,techName:actor.name,isCurrent:true,estimatedTime:0,estimatedMiles:0,startTime:when,endTime:null,hourlyRateSnapshot:shiftRate || null,timePolicySnapshot:{payBreaks:ctx.settings.payBreaks===true,payLunches:ctx.settings.payLunches===true}});
    t.set(c.collection('workLogs').doc(logId),{id:logId,shiftId,startTime:when,startLatitude:0,startLongitude:0,type:'Working',...allocation,companyId,companyName:actor.company.name || '',userId:uid,userName:actor.name,current:true});
    clock={shiftId,logId,lastRequestId:requestId};
   } else {
    if(!shift || !log) { if(d.action==='clockOut') return {alreadyApplied:true}; fail('failed-precondition','Clock in before changing your status.'); }
    if(!['clockOut','working','break','lunch'].includes(d.action)) fail('invalid-argument','Choose a clock action.');
    if(date(log.startTime)>when) fail('failed-precondition','The open log has an invalid start time.');
    t.set(c.collection('workLogs').doc(log.id),{endTime:when,endLatitude:0,endLongitude:0,current:false,updatedAt:when},{merge:true});
    if(d.action==='clockOut') {
     t.set(c.collection('shifts').doc(shift.id),{isCurrent:false,endTime:when},{merge:true});
     clock={shiftId:'',logId:'',lastRequestId:requestId};
    } else {
     const logId='work_log_'+stable(shift.id+'_'+requestId);
     t.set(c.collection('workLogs').doc(logId),{id:logId,shiftId:shift.id,startTime:when,startLatitude:0,startLongitude:0,type:d.action==='break'?'On Break':d.action==='lunch'?'On Lunch':'Working',...allocation,companyId,companyName:actor.company.name || '',userId:uid,userName:actor.name,current:true});
     clock={shiftId:shift.id,logId,lastRequestId:requestId};
    }
   }
   t.set(person,{userId:uid,timeClock:clock},{merge:true});
   return {shiftId:clock.shiftId,logId:clock.logId,closedShiftId:d.action==='clockOut'?shift?.id || null:null};
  });
 }
 async function reconcile(companyId,source,sourceId) {
  const c=work.company(companyId),nowAt=now();
  return db.runTransaction(async t=>{
   const collection=source==='workLogs'?'shifts':'activeRoutes';
   const parent=record(await t.get(c.collection(collection).doc(sourceId)));
   if(!parent) return;
   const [settingsSnap,wide,ratesSnap,oldSnap,logsSnap]=await Promise.all([t.get(c.collection('paySettings').doc('main')),t.get(c.collection('settings').doc('companyWide')),t.get(c.collection('technicianRates').where('technicianId','==',id(parent.techId))),t.get(c.collection('technicianPayLineItems').where(source==='workLogs'?'shiftId':'activeRouteId','==',sourceId)),t.get(c.collection(source==='workLogs'?'workLogs':'activeRouteLogs').where(source==='workLogs'?'shiftId':'activeRouteId','==',sourceId))]);
   const settings=settingsSnap.data() || {},wideData=wide.data() || {};
   if(parent.payrollHistoricalRepairOnly && oldSnap.empty) return;
   if([settings.payrollEnabled,settings.companyPayrollEnabled,wideData.payrollEnabled,wideData.companyPayrollEnabled].includes(false) || settings.payrollDisabled===true || wideData.payrollDisabled===true) return;
   const selected=settings.hourlyPaySource;
   if(source==='workLogs' && selected!=='workLogs' || source!=='workLogs' && !['activeRouteDuration','activeRouteLogs'].includes(selected) || !['hourlyOnly','hybrid'].includes(settings.payMode)) return;
   const closed=source==='workLogs'?parent.isCurrent===false && parent.endTime:parent.endTime && ['finished','completed'].includes(key(parent.status));
   let routeAllocation=null,allocationReview='';
   if(source!=='workLogs') {
     const ids=routeIds(parent),stops=(await Promise.all(ids.map(value=>t.get(c.collection('serviceStops').doc(value))))).map(record).filter(Boolean);
     const offerIds=[...new Set(stops.map(v=>v.workOfferId).filter(Boolean))];
     if(offerIds.length) {
       const offers=await Promise.all(offerIds.map(value=>t.get(c.collection('workOffers').doc(value))));
       const offer=offers.length===1?record(offers[0]):null;
       const claim=offer?.claims?.find(v=>v.workerId===parent.techId && ['Accepted','Scheduled','In Progress','Completed'].includes(v.status) && stops.every(stop=>stop.workOfferClaimId===v.id && (v.stopIds || []).includes(stop.id)));
       if(claim && stops.length===ids.length && stops.every(v=>v.workOfferId===offer.id)) {
         const terms=claim.agreement,hourly=(terms.quotedPayLines || []).filter(v=>v.rateType==='hourly'),rateIds=[...new Set(hourly.map(v=>v.rateId))];
         const rate=terms.rates?.find(v=>v.id===rateIds[0]) || selectPayRate({companyId,technicianId:parent.techId,workTypeId:'',basis:'technicianHourly',hourlyFallback:true,rates:terms.rates || [],date:date(terms.rateDate || terms.acceptedAt)});
         if(rateIds.length>1) allocationReview='This route has multiple accepted hourly rates. Allocate time before approving pay.';
         routeAllocation={offerId:offer.id,claimId:claim.id,jobId:offer.jobId || null,rate:rate || null,included:['Offered Amount','Unpaid'].includes(terms.paySource)};
       } else allocationReview='This route mixes accepted scopes or fixed-pay work. Review and allocate route time before approving pay; do not add hourly pay already included in a fixed offer.';
     }
   }
   const groups=new Map(), policy=parent.timePolicySnapshot || settings;
   const intervals=rows(logsSnap).filter(v=>v.endTime && !v.timePayIncluded && (key(v.type || v.status)==='working' || ['inprogress','traveling'].includes(key(v.type || v.status)) || policy.payBreaks===true && ['onbreak','break'].includes(key(v.type || v.status)) || policy.payLunches===true && ['onlunch','lunch'].includes(key(v.type || v.status))));
   if(closed && selected==='activeRouteDuration') {
     let minutes=(date(parent.endTime)-date(parent.startTime))/60000;
     const excluded=rows(logsSnap).filter(v=>v.endTime && (policy.payBreaks!==true && ['onbreak','break'].includes(key(v.type || v.status)) || policy.payLunches!==true && ['onlunch','lunch'].includes(key(v.type || v.status))));
     minutes-=excluded.reduce((n,v)=>n+Math.max(0,(date(v.endTime)-date(v.startTime))/60000),0);
     if(!routeAllocation?.included) groups.set('route',{minutes:Math.max(0,minutes),rate:routeAllocation?.rate || parent.hourlyRateSnapshot || null,jobId:routeAllocation?.jobId || null,offerId:routeAllocation?.offerId || null,claimId:routeAllocation?.claimId || null});
   } else if(closed && !routeAllocation?.included) {
     const sorted=intervals.map(v=>({...v,start:date(v.startTime).getTime(),end:date(v.endTime).getTime()})).filter(v=>Number.isFinite(v.start)&&Number.isFinite(v.end)&&v.end>v.start).sort((a,b)=>a.start-b.start);
     let end=0;
     for(const log of sorted) {
       const minutes=Math.max(0,log.end-Math.max(log.start,end))/60000;end=Math.max(end,log.end);
       const groupKey=log.workOfferId || 'shift';
       const group=groups.get(groupKey) || {minutes:0,rate:log.hourlyRateSnapshot || routeAllocation?.rate || parent.hourlyRateSnapshot || null,jobId:log.jobId || routeAllocation?.jobId || null,offerId:log.workOfferId || routeAllocation?.offerId || null,claimId:log.workOfferClaimId || routeAllocation?.claimId || null};
       group.minutes+=minutes;groups.set(groupKey,group);
     }
   }
   let minutes=0;
   const generated=[...groups].flatMap(([allocationId,group])=>{
     minutes+=group.minutes;
     const rate=group.rate ? {...group.rate,payTypeId:null,workTypeId:null,payBasis:'technicianHourly',rateType:'hourly'} : null;
     const hourly=calculatePayLines({companyId,serviceStop:{id:'time_'+sourceId,techId:parent.techId,tech:parent.techName || parent.tech || '',operationStatus:'Finished',serviceDate:parent.date || parent.startTime,payTypeId:'time_hourly',duration:group.minutes},tasks:[],rates:rate?[rate]:rows(ratesSnap),workTypes:[{id:'time_hourly',name:source==='workLogs'?'Clocked Shift':'Route Time',defaultRateType:'hourly'}],settings:{payMode:'hourlyOnly',hourlyPaySource:'serviceStopDuration'}});
     return hourly.map(v=>({...v,id:'comp_pay_time_'+source+'_'+sourceId+'_'+stable(allocationId),payrollComponentId:'time:'+source+':'+sourceId+':'+allocationId,source:source==='workLogs'?'manualAdjustment':'activeRoute',payrollSource:source,serviceStopId:null,activeRouteId:source==='workLogs'?null:sourceId,shiftId:source==='workLogs'?sourceId:null,jobId:group.jobId,workOfferId:group.offerId || null,workOfferClaimId:group.claimId || null,payTypeId:null,workTypeId:null,payTypeName:source==='workLogs'?'Clocked Shift':'Route Time',workTypeName:source==='workLogs'?'Clocked Shift':'Route Time',calculatedAt:nowAt,...(allocationReview?{totalAmountCents:0,calculationStatus:'needsReview',notes:allocationReview}:{})}));
   });
   const result=reconcilePayLines({generated,existing:rows(oldSnap)});
   result.writes.forEach(v=>t.set(c.collection('technicianPayLineItems').doc(v.id),v,{merge:true}));
   t.set(c.collection(collection).doc(sourceId),{payrollTimeMinutes:minutes,payrollNeedsReview:generated.some(v=>v.calculationStatus==='needsReview'),payrollConflictIds:result.conflicts},{merge:true});
  });
 }
 async function onShift(e) { if(JSON.stringify(e.data?.before?.data())===JSON.stringify(e.data?.after?.data())) return; const before=e.data?.before?.data(),after=e.data?.after?.data(); if(before?.isCurrent===after?.isCurrent && String(before?.endTime)===String(after?.endTime)) return; return reconcile(e.params.companyId,'workLogs',e.params.shiftId); }
 async function onLog(e) { const a=e.data?.after?.data(),b=e.data?.before?.data(); return reconcile(e.params.companyId,'workLogs',id(a?.shiftId || b?.shiftId)); }
 async function onRoute(e) { const a=e.data?.after?.data(),b=e.data?.before?.data(); if(a?.status===b?.status && String(a?.startTime)===String(b?.startTime) && String(a?.endTime)===String(b?.endTime)) return; return reconcile(e.params.companyId,'activeRoutes',e.params.routeId); }
 async function onRouteLog(e) { const a=e.data?.after?.data(),b=e.data?.before?.data(); return reconcile(e.params.companyId,'activeRoutes',id(a?.activeRouteId || b?.activeRouteId)); }
 return {command,reconcile,onShift,onLog,onRoute,onRouteLog};
}
module.exports={createTechnicianTime};
