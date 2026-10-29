const { HttpsError } = require('firebase-functions/v2/https');
const { createTechnicianWorkWorkflow, id, date, record, rows, key, done, stable, agreementReference, paySettingsForOffer } = require('./technicianWorkWorkflow');
const { jobPayFields } = require('./payrollCalculation');
const fail=(code,message)=>{throw new HttpsError(code,message);};
function createTechnicianExecution(db,now=()=>new Date()) {
 const work=createTechnicianWorkWorkflow(db,now);
 async function schedule(request) {
  if(!request.auth?.uid) fail('unauthenticated','Sign in first.');
  const d=request.data || {}, companyId=id(d.companyId), offerId=id(d.offerId);
  if(!companyId || !offerId) fail('invalid-argument','Company and offer are required.');
  return db.runTransaction(async t=>{
   const c=work.company(companyId), actor=await work.actorFor(t,companyId,request.auth.uid);
   const ref=c.collection('workOffers').doc(offerId), offer=record(await t.get(ref));
   if(!offer) fail('not-found','Offer not found.');
   const claims=Array.isArray(offer.claims)?offer.claims:[];
   let claim=claims.find(v=>v.id===d.claimId || !d.claimId && (v.workerId===actor.uid || work.can(actor,'324')));
   if(!claim && offer.acceptedByUserId && ['Accepted','Scheduled'].includes(offer.status)) {
     if(actor.uid!==offer.acceptedByUserId && !work.can(actor,'324')) fail('permission-denied','Only the accepted worker or management can schedule this offer.');
     if(offer.serviceStopId) return {serviceStopId:offer.serviceStopId,alreadyScheduled:true};
     const targetUser=rows(await t.get(c.collection('companyUsers').where('userId','==',offer.acceptedByUserId)))[0] || {};
     const target={...actor,uid:offer.acceptedByUserId,name:offer.acceptedByUserName || targetUser.userName || offer.acceptedByUserId,user:targetUser};
     const ctx=await work.context(t,c,target),legacyScope=await work.scopeFor(t,c,offer);
     const quote=work.estimate({companyId,offer,scope:legacyScope.scope,ctx,actor:target});
     if(quote.needsReview) fail('failed-precondition','Management must resolve legacy pay setup before scheduling.');
     claim={id:'legacy_'+stable(offer.id),workerId:target.uid,workerName:target.name,workerType:targetUser.workerType || '',stopIds:[],taskIds:legacyScope.scope.tasks.map(v=>v.id),status:'Accepted',createdAt:now(),agreement:{offerId:offer.id,revision:offer.revision || 1,workerId:target.uid,workerName:target.name,paySource:offer.paySource || 'Technician Rate',fixedAmountCents:Number(offer.offeredAmountCents || 0),incentive:offer.incentive || {type:'none'},rates:ctx.rates,settings:paySettingsForOffer(offer,ctx.settings),workTypes:ctx.workTypes,taskIds:legacyScope.scope.tasks.map(v=>v.id),scopeStopIds:[],baseCents:quote.baseCents,totalCents:quote.totalCents,acceptedAt:now(),legacyAcceptedAt:offer.acceptedAt || null}};
     claims.push(claim);
   }
   if(!claim || !['Accepted','Scheduled'].includes(claim.status)) fail('failed-precondition','Accept and approve this work before scheduling.');
   if(claim.workerId!==actor.uid && !work.can(actor,'324')) fail('permission-denied','You cannot schedule this work.');
   if(claim.workerId===actor.uid && !work.can(actor,'324') && offer.allowsTechnicianSelfScheduling!==true) fail('permission-denied','Management must schedule this offer.');
   if(claim.serviceStopId) return {serviceStopId:claim.serviceStopId,alreadyScheduled:true};
   if(!offer.jobId || claim.stopIds.length) fail('failed-precondition','Route coverage already has dated stops.');
   const when=date(Number(d.serviceDateMillis));
   if(!Number.isFinite(when.getTime())) fail('invalid-argument','Choose a valid service date.');
   if(offer.proposedStartDate && when<date(offer.proposedStartDate) || (offer.completionDeadlineAt || offer.proposedEndDate) && when>date(offer.completionDeadlineAt || offer.proposedEndDate)) fail('failed-precondition','Schedule within the accepted offer window.');
   const {job,scope}=await work.scopeFor(t,c,offer);
   const diagnostic=offer.workPurpose==='diagnostic' || key(offer.serviceStopTypeUseCaseRawValue).includes('estimate');
   if(!diagnostic && !scope.tasks.length) fail('failed-precondition','Execution work needs tasks.');
   if(scope.tasks.some(v=>done(v) || id(v.serviceStopId))) fail('failed-precondition','Some work is already completed or scheduled. Refresh before scheduling.');
   const stopId='comp_ss_offer_'+stable(offerId+'_'+claim.id);
   const typeId=offer.serviceStopTypeId || (diagnostic?'system_job_estimate_service_stop':'system_job_service_stop');
   const stopType=record(await t.get(c.collection('companyPayTypes').doc(typeId)));
   const location=job.serviceLocationId ? record(await t.get(c.collection('serviceLocations').doc(job.serviceLocationId))) : null;
   const minutes=Number(offer.estimatedMinutes || scope.tasks.reduce((n,v)=>n+Number(v.estimatedTime || 0),0));
   const agreement={...claim.agreement,incentiveCents:claim.agreement.incentive?.type==='flat'?Number(claim.agreement.incentive.amountCents || 0):0};
   const stop={id:stopId,internalId:'S'+stable(offerId).slice(0,8),companyId,companyName:actor.company.name || '',customerId:job.customerId || '',customerName:job.customerName || '',address:location?.address || job.address || offer.address || {streetAddress:'',city:'',state:'',zip:'',latitude:0,longitude:0},dateCreated:now(),serviceDate:when,startTime:null,endTime:null,duration:0,estimatedDuration:minutes,estimatedMinutes:minutes,tech:claim.workerName,techId:claim.workerId,recurringServiceStopId:'',description:offer.description || job.description || '',serviceLocationId:job.serviceLocationId || '',typeId,type:offer.serviceStopTypeName || stopType?.name || (diagnostic?'Job Estimate':'Job Visit'),typeImage:offer.serviceStopTypeImage || '',jobId:job.id,jobName:job.type || '',operationStatus:'Not Finished',billingStatus:'Not Invoiced',category:diagnostic?'Job Estimate':'Job',serviceStopTypeUseCaseRawValue:diagnostic?'jobEstimate':'jobVisit',payTypeId:typeId,includeReadings:false,includeDosages:false,otherCompany:false,laborContractId:'',contractedCompanyId:'',photoUrls:[],isInvoiced:false,workOfferId:offerId,workOfferClaimId:claim.id,payrollAgreement:agreementReference({...agreement,claimId:claim.id}),estimatedPayCents:agreement.totalCents || 0,
    ...(agreement.paySource==='Offered Amount' || agreement.paySource==='Unpaid'?{payrollMode:'custom',manualPayOverrideCents:agreement.paySource==='Unpaid'?0:agreement.fixedAmountCents,manualPayOverrideNotes:'Accepted work offer '+offerId}:{})};
   if(scope.tasks.length*2+scope.products.length>400) fail('resource-exhausted','Split this work into smaller visits.');
   t.set(c.collection('serviceStops').doc(stopId),stop);
   scope.tasks.forEach(task=>{
    const taskId='comp_ss_task_'+stable(stopId+'_'+task.id);
    t.set(c.collection('serviceStops').doc(stopId).collection('tasks').doc(taskId),{...task,...jobPayFields(task),id:taskId,jobTaskId:task.id,status:'Scheduled',actualTime:0,jobId:{id:job.id,internalId:job.internalId || ''},serviceStopId:{id:stopId,internalId:stop.internalId},recurringServiceStopId:{id:'',internalId:''},recurringServiceStopTaskId:'',workerId:claim.workerId,workerName:claim.workerName,workerType:claim.workerType,workerAssignmentMode:'stop',shoppingListItemId:task.shoppingListItemId || '',dataBaseItemId:task.dataBaseItemId || ''});
    t.set(c.collection('workOrders').doc(job.id).collection('tasks').doc(task.id),{serviceStopId:{id:stopId,internalId:stop.internalId},status:'Scheduled',workerId:claim.workerId,workerName:claim.workerName,workerType:claim.workerType,workerAssignmentMode:'stop'},{merge:true});
   });
   scope.products.forEach(item=>t.set(c.collection('shoppingList').doc(item.id),{serviceStopId:stopId,serviceStopInternalId:stop.internalId,assignedTechId:claim.workerId,assignedTechName:claim.workerName,serviceDate:when},{merge:true}));
   t.set(c.collection('workOrders').doc(job.id),{serviceStopIds:[...new Set([...(job.serviceStopIds || []),stopId])]},{merge:true});
   t.set(ref,{claims:claims.map(v=>v.id===claim.id?{...v,status:'Scheduled',serviceStopId:stopId}:v),serviceStopId:stopId,serviceStopInternalId:stop.internalId,status:'Scheduled',acceptedTerms:claim.agreement,updatedAt:now()},{merge:true});
   return {serviceStopId:stopId};
  });
 }
 return {schedule};
}
module.exports={createTechnicianExecution};
