const { HttpsError } = require('./appErrors');
const {createTechnicianWorkWorkflow,id,record,rows,done,key,stable}=require('./technicianWorkWorkflow');
const purchaseRecorded = item => Boolean(item.purchasedItem || item.purchasedItemId || item.datePurchased || item.purchasedAt)
  || ['purchased','delivered'].includes(key(item.status));
const installed = item => Boolean(item.installedAt) || key(item.status) === 'installed';
const closedMaterial = item => installed(item) || ['cancelled','canceled','deleted'].includes(key(item.status));
const closedStop=stop=>done({status:stop.operationStatus || stop.status}) || Boolean(stop.finishedAt || stop.completedAt);
function createJobCloseout(db,now=()=>new Date()) {
 const work=createTechnicianWorkWorkflow(db,now);
 const equipment=require('./equipmentCompletion').createEquipmentCompletion(db,now);
 return async request=>{
  if(!request.auth?.uid) throw new HttpsError('unauthenticated','Sign in first.');
  const d=request.data || {},companyId=id(d.companyId),jobId=id(d.jobId);
  if(!companyId || !jobId || !d.requestId || typeof d.finishJob!=='boolean') throw new HttpsError('invalid-argument','Job and a completion request ID are required.');
  return db.runTransaction(async t=>{
   const c=work.company(companyId),a=await work.actorFor(t,companyId,request.auth.uid),ref=c.collection('workOrders').doc(jobId);
   const eventId='closeout_'+stable(String(d.requestId));
   const previous=await t.get(ref.collection('history').doc(eventId));
   if(previous.exists)return previous.data().result || {jobId,alreadyApplied:true};
   const [jobSnap,tasksSnap,productsSnap,servicesSnap,stopsSnap,plannedSnap,offersSnap]=await Promise.all([t.get(ref),t.get(ref.collection('tasks')),t.get(c.collection('shoppingList').where('jobId','==',jobId)),t.get(ref.collection('laborLineItems')),t.get(c.collection('serviceStops').where('jobId','==',jobId)),t.get(ref.collection('plannedServiceStops')),t.get(c.collection('workOffers').where('jobId','==',jobId))]);
   const job=record(jobSnap);if(!job) throw new HttpsError('not-found','Job no longer exists.');
   // Closeout must see the same legacy references as the job detail screen.
   const aliases=['jobId.id','workOrderId','assignedJobId'];
   const [extraProducts,extraStops,referencedStops]=await Promise.all([
    Promise.all(aliases.map(field=>t.get(c.collection('shoppingList').where(field,'==',jobId)))),
    Promise.all(aliases.map(field=>t.get(c.collection('serviceStops').where(field,'==',jobId)))),
    Promise.all((Array.isArray(job.serviceStopIds)?job.serviceStopIds:job.serviceStopIds?[job.serviceStopIds]:[]).map(value=>t.get(c.collection('serviceStops').doc(id(value)))))
   ]);
   const distinct=values=>[...new Map(values.map(value=>[value.id,value])).values()];
   const tasks=rows(tasksSnap),products=distinct([...rows(productsSnap),...extraProducts.flatMap(rows)]),services=servicesSnap.empty?(job.laborLineItems || []):rows(servicesSnap),stops=distinct([...rows(stopsSnap),...extraStops.flatMap(rows),...referencedStops.filter(value=>value.exists).map(record)]).filter(stop=>!id(stop.jobId) || id(stop.jobId)===jobId);
   if(!work.can(a,'24') && !tasks.some(v=>v.workerId===a.uid) && !stops.some(v=>v.techId===a.uid)) throw new HttpsError('permission-denied','Only assigned technicians or job managers can close this job.');
   if(d.serviceStopIds!==undefined && (!Array.isArray(d.serviceStopIds) || d.serviceStopIds.some(value=>typeof value!=='string' || !value || value.includes('/')))) throw new HttpsError('invalid-argument','Select valid service stops.');
   const selected=new Set(d.serviceIds || []),at=now(),taskIds=new Set(d.taskIds || []),productIds=new Set(d.productIds || []),selectedStopIds=new Set(d.serviceStopIds || []);
   if([...selectedStopIds].some(value=>!stops.some(stop=>stop.id===value))) throw new HttpsError('failed-precondition','A selected service stop no longer belongs to this job. Refresh before finishing.');
   const selectedStops=stops.filter(stop=>selectedStopIds.has(stop.id) && !closedStop(stop));
   if(!work.can(a,'24') && selectedStops.some(stop=>stop.techId!==a.uid)) throw new HttpsError('permission-denied','Management must review completing another technician’s service stop.');
   const stopTaskSnapshots=await Promise.all(stops.map(stop=>t.get(c.collection('serviceStops').doc(stop.id).collection('tasks'))));
   const stopTasks=selectedStops.map(stop=>rows(stopTaskSnapshots[stops.findIndex(value=>value.id===stop.id)]));
   const linkedAssignments=new Map();
   selectedStops.forEach((stop,index)=>{
    const reviewed=d.serviceStopTaskIds?.[stop.id];
    if(!Array.isArray(reviewed) && stopTasks[index].some(task=>!done(task)) || stopTasks[index].some(task=>!done(task) && !reviewed?.includes(task.id))) throw new HttpsError('failed-precondition','Service stop tasks changed. Refresh and review all unfinished stop tasks before finishing.');
    if(!work.can(a,'24') && stopTasks[index].some(task=>!done(task) && task.workerId && task.workerId!==a.uid)) throw new HttpsError('permission-denied','Management must review completing another technician’s assigned work.');
    stopTasks[index].filter(task=>!done(task)).forEach(task=>{
     const linked=id(task.jobTaskId || task.workOrderTaskId || task.sourceTaskId);
     if(tasks.some(value=>value.id===linked && !done(value))) {
      taskIds.add(linked);
      linkedAssignments.set(linked,{workerId:task.workerId || stop.techId || '',workerName:task.workerName || stop.tech || '',serviceStopId:{id:stop.id,internalId:stop.internalId || ''}});
     }
    });
   });
   const completedTasks=tasks.map(v=>taskIds.has(v.id)?{...v,status:'Finished',workerId:v.workerId || linkedAssignments.get(v.id)?.workerId || a.uid,workerName:v.workerName || linkedAssignments.get(v.id)?.workerName || a.name,...(!id(v.serviceStopId) && linkedAssignments.has(v.id)?{serviceStopId:linkedAssignments.get(v.id).serviceStopId}:{}),completedAt:v.completedAt || at,completedByUserId:v.completedByUserId || a.uid}:v);
   const productsToInstall = products.filter(item=>productIds.has(item.id) && !installed(item));
   if ([...productIds].some(id=>!products.some(item=>item.id===id)) ||
       productsToInstall.some(item=>!purchaseRecorded(item) || item.returned || item.planWorkspaceOnly || item.shoppingListActive===false)) {
    throw new HttpsError('failed-precondition','Only purchased materials on this job can be confirmed installed.');
   }
   const installations = new Map(productsToInstall.map(item=>[item.id,{
    status:'Installed',fulfillmentStatus:'installed',needsAction:false,installedAt:at,
    installedByUserId:a.uid,installedByUserName:a.name,installedQuantity:Math.max(0,Number(item.quantity ?? item.quantityString) || 1),
    updatedAt:at,
   }]));
   const completedProducts=products.map(item=>({...item,...installations.get(item.id)}));
   if(!work.can(a,'24') && tasks.some(v=>taskIds.has(v.id) && v.workerId && v.workerId!==a.uid)) throw new HttpsError('permission-denied','Management must review completing another technician’s assigned work.');
   const purchaseIds = new Set(productsToInstall.map(item=>id(item.purchasedItem || item.purchasedItemId)).filter(Boolean));
   const purchases=await Promise.all([...purchaseIds].map(purchaseId=>t.get(c.collection('purchasedItems').doc(purchaseId))));
   const approvals=await Promise.all(productsToInstall.map(async item=>{
    const approvalId=id(item.partApprovalRequestId || item.approvalRequestId || item.customerApprovalRequestId);
    if(!approvalId) return null;
    const approval=await t.get(db.collection('customerPartApprovals').doc(approvalId));
    const source=approval.data();
    if(!source || source.companyId!==companyId || (source.shoppingListItemId || source.shoppingItemId)!==item.id ||
        !['approved','resolved'].includes(key(source.approvalStatus || source.status))) {
     throw new HttpsError('failed-precondition','A selected material needs a valid customer approval before installation.');
    }
    return approval;
   }));

   const nextServices=services.map(v=> selected.has(v.id) || (v.taskIds?.length?v.taskIds:v.laborLineTaskIds || []).length && (v.taskIds?.length?v.taskIds:v.laborLineTaskIds).every(value=>completedTasks.some(task=>task.id===id(value)&&done(task))) && !completedProducts.some(item=>(v.taskIds?.length?v.taskIds:v.laborLineTaskIds || []).map(id).includes(id(item.linkedTaskId || item.jobTaskId)) && !closedMaterial(item)) ? {...v,completionStatus:'Finished',completedAt:v.completedAt || at,completedByUserId:a.uid} : v);
   const remainingTasks=completedTasks.filter(v=>!done(v)),remainingProducts=completedProducts.filter(v=>!closedMaterial(v)),remainingServices=nextServices.filter(v=>v.completionStatus!=='Finished');
   const future=stops.filter(v=>!closedStop(v) && !selectedStopIds.has(v.id)),offers=rows(offersSnap),openOffers=offers.filter(v=>!['Rejected','Cancelled','Expired','Completed'].includes(v.status) && !(v.claims || []).some(claim=>['Accepted','Scheduled','In Progress','Completed'].includes(claim.status))),planned=rows(plannedSnap).filter(v=>!done(v) && !id(v.serviceStopId));
   if(d.finishJob!==false && (remainingTasks.length || remainingServices.length)) throw new HttpsError('failed-precondition','Finish the remaining tasks and services, or keep the job open.');
   if(d.finishJob!==false && (future.length || planned.length || openOffers.length) && !d.cancelRemainingVisits) throw new HttpsError('failed-precondition','Review the remaining scheduled visits before closing the job.');
   const equipmentStopTasks=stops.flatMap((stop,index)=>rows(stopTaskSnapshots[index]).map(task=>({stop,task:selectedStopIds.has(stop.id) && !closedStop(stop) && !done(task)?{...task,status:'Finished',completedAt:task.completedAt || at}:task})));
   const equipmentWrites=await equipment.plan(t,{companyId,jobId,job:{...job,...(d.finishJob?{completedAt:job.completedAt || at}:{})},tasks:completedTasks,stopTasks:equipmentStopTasks,finishJob:d.finishJob,completedAt:at});
   if(tasks.length+products.length+approvals.filter(Boolean).length+purchases.length+nextServices.length+future.length+planned.length+offers.length+selectedStops.length+stopTasks.flat().length+equipmentWrites.length>400) throw new HttpsError('resource-exhausted','Close out this job in smaller groups.');
   if(d.finishJob && d.cancelRemainingVisits) {
     const cancelled=new Set(future.map(v=>v.id));
     const dropped=new Set(openOffers.map(v=>v.id));
     for(const task of completedTasks) {
       if(cancelled.has(id(task.serviceStopId))) {task.serviceStopId={id:'',internalId:''};task.detachedFromCancelledVisit=true;taskIds.add(task.id);}
       if(dropped.has(task.claimedWorkOfferId)){task.claimedWorkOfferId=null;taskIds.add(task.id);}
     }
     for(const offer of offers) {
       if(dropped.has(offer.id)) {
         t.set(c.collection('workOffers').doc(offer.id),{status:'Cancelled',claims:(offer.claims || []).map(claim=>['Acceptance Pending Approval'].includes(claim.status)?{...claim,status:'Cancelled',cancellationReason:'Job closed after completion review.'}:claim),cancelledAt:at,cancelledByUserId:a.uid,updatedAt:at},{merge:true});
       } else if((offer.claims || []).some(claim=>cancelled.has(claim.serviceStopId))) {
         const claims=offer.claims.map(claim=>cancelled.has(claim.serviceStopId)?{...claim,serviceStopId:null,status:(claim.taskIds || []).length?'Accepted':'Cancelled',cancelledVisitId:claim.serviceStopId,cancellationReason:'Unused appointment cancelled during job completion.'}:claim);
         t.set(c.collection('workOffers').doc(offer.id),{claims,status:claims.every(claim=>['Cancelled','Rejected','Transferred'].includes(claim.status))?'Cancelled':'Accepted',serviceStopId:'',cancelledVisitIds:future.map(v=>v.id),updatedAt:at},{merge:true});
       }
     }
   }
   completedTasks.filter(v=>taskIds.has(v.id)).forEach(v=>t.set(ref.collection('tasks').doc(v.id),v,{merge:true}));
   for (const [id,updates] of installations) t.set(c.collection('shoppingList').doc(id),updates,{merge:true});
   approvals.forEach(approval=>{if(approval) t.set(approval.ref,{fulfillmentStatus:'installed',shoppingListItemStatus:'Installed',installedAt:at,installedByUserId:a.uid,updatedAt:at},{merge:true});});
   purchases.filter(v=>v.exists).forEach(v=>t.set(v.ref,{installed:true,installedAt:at,installationJobId:jobId},{merge:true}));
   nextServices.forEach(v=>t.set(ref.collection('laborLineItems').doc(v.id),v,{merge:true}));
   selectedStops.forEach((stop,index)=>{
    const stopRef=c.collection('serviceStops').doc(stop.id);
    const start=stop.startTime?.toDate?.() || (stop.startTime?new Date(stop.startTime):null);
    const duration=start && Number.isFinite(start.getTime())?Math.max(0,Math.round((at-start)/60000)):Math.max(0,Number(stop.duration) || 0);
    t.set(stopRef,{operationStatus:'Finished',endTime:stop.endTime || at,finishedAt:stop.finishedAt || at,completedAt:stop.completedAt || at,completedByUserId:a.uid,manuallyFinished:true,manualFinishSource:'admin_web',duration,updatedAt:at},{merge:true});
    stopTasks[index].filter(task=>!done(task)).forEach(task=>t.set(stopRef.collection('tasks').doc(task.id),{status:'Finished',workerId:task.workerId || stop.techId || '',workerName:task.workerName || stop.tech || '',completedAt:task.completedAt || at,completedByUserId:a.uid,updatedAt:at},{merge:true}));
   });
   if(d.finishJob!==false) future.forEach(v=>t.set(c.collection('serviceStops').doc(v.id),{operationStatus:'Skipped',skipReason:'Job completed; remaining appointment cancelled during closeout.',cancelledAt:at,cancelledByUserId:a.uid},{merge:true}));
   if(d.finishJob!==false) planned.forEach(v=>t.set(ref.collection('plannedServiceStops').doc(v.id),{status:'Cancelled',cancelledAt:at,cancelledByUserId:a.uid,cancelReason:'Job finished during closeout.'},{merge:true}));
   equipment.apply(t,equipmentWrites);
   t.set(ref,{laborLineItems:nextServices,...(d.finishJob===false?{}:{operationStatus:'Finished',completedAt:job.completedAt || at,completedByUserId:a.uid}),updatedAt:at},{merge:true});
   const result={jobId,finished:d.finishJob,remainingTasks:remainingTasks.length,remainingProducts:remainingProducts.length,installedProductIds:[...installations.keys()],remainingServices:remainingServices.length,completedServiceStopIds:selectedStops.map(stop=>stop.id)};
   t.set(ref.collection('history').doc(eventId),{id:eventId,companyId,jobId,type:'Updated',action:d.finishJob===false?'Work Completed':'Job Finished',title:d.finishJob===false?'Work completed':'Job finished',description:'Closeout by '+a.name,createdAt:at,date:at,userId:a.uid,userName:a.name,actorId:a.uid,actorName:a.name,serviceIds:[...selected],taskIds:[...taskIds],productIds:[...productIds],completedServiceStopIds:selectedStops.map(stop=>stop.id),cancelledVisitIds:d.finishJob!==false?future.map(v=>v.id):[],cancelledOfferIds:d.finishJob?openOffers.map(v=>v.id):[],result},{merge:true});
   return result;
  });
 };
}
module.exports={createJobCloseout};
