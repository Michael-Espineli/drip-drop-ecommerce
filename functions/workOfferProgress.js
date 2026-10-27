const {id,record,key}=require('./technicianWorkWorkflow');
const completed = value => ['finished','completed','done'].includes(key(value));
function createWorkOfferProgress(db,now=()=>new Date()) {
 async function reconcile(companyId,offerId) {
  if(!offerId)return;
  const c=db.collection('companies').doc(companyId),ref=c.collection('workOffers').doc(offerId);
  return db.runTransaction(async t=>{
   const offer=record(await t.get(ref));if(!offer || !Array.isArray(offer.claims))return;
   const evaluated=[];
   for(const claim of offer.claims) {
    if(!['Accepted','Scheduled','Completed','In Progress'].includes(claim.status)){evaluated.push(claim);continue;}
    const taskIds=claim.taskIds || [],stopIds=claim.stopIds?.length?claim.stopIds:claim.serviceStopId?[claim.serviceStopId]:[];
    const tasks=offer.jobId ? await Promise.all(taskIds.map(value=>t.get(c.collection('workOrders').doc(id(offer.jobId)).collection('tasks').doc(value)))) : [];
    const stopTasks=await Promise.all((claim.agreement?.stopTasks || []).map(v=>t.get(c.collection('serviceStops').doc(v.stopId).collection('tasks').doc(v.taskId))));
    const stops=await Promise.all(stopIds.map(value=>t.get(c.collection('serviceStops').doc(value))));
    const products=(offer.scopeSnapshot?.products || []).filter(v=>v.sourceStopId ? stopIds.includes(v.sourceStopId) : !v.linkedTaskId || taskIds.includes(id(v.linkedTaskId)));
    const materials=await Promise.all(products.map(v=>t.get(c.collection('shoppingList').doc(v.id))));
    const finishedTasks=[...tasks,...stopTasks].filter(v=>v.exists && completed(v.data().status)).length;
    const totalTasks=tasks.length+stopTasks.length;
    const finishedStops=stops.filter(v=>v.exists && completed(v.data().operationStatus)).length;
    const installed=materials.filter(v=>v.exists && ['installed','cancelled','canceled'].includes(key(v.data().status))).length;
    const complete=(totalTasks>0 || stopIds.length>0) && finishedTasks===totalTasks && installed===materials.length && (!stopIds.length || finishedStops===stopIds.length);
    const status=complete?'Completed':finishedTasks || finishedStops?'In Progress':claim.serviceStopId?'Scheduled':claim.status==='Completed'?'Accepted':claim.status;
    evaluated.push({...claim,status,completedAt:complete?(claim.completedAt || now()):null,progress:{finishedTasks,totalTasks,finishedStops,totalStops:stopIds.length,installedProducts:installed,totalProducts:materials.length}});
   }
   const active=evaluated.filter(v=>!['Rejected','Cancelled','Transferred'].includes(v.status));
   const status=active.length && active.every(v=>v.status==='Completed') && !(offer.remainingStopIds || []).length ? 'Completed' : offer.status==='Completed'?'In Progress':offer.status;
   if(JSON.stringify(evaluated)!==JSON.stringify(offer.claims) || status!==offer.status)t.set(ref,{claims:evaluated,status,updatedAt:now()},{merge:true});
  });
 }
 async function onStop(e){const a=e.data?.after?.data(),b=e.data?.before?.data();if(a?.operationStatus===b?.operationStatus)return;return reconcile(e.params.companyId,a?.workOfferId || b?.workOfferId);}
 async function onTask(e){const a=e.data?.after?.data(),b=e.data?.before?.data();if(a?.status===b?.status)return;return reconcile(e.params.companyId,a?.claimedWorkOfferId || a?.payrollAgreement?.offerId || b?.claimedWorkOfferId);}
 async function onStopTask(e){const a=e.data?.after?.data(),b=e.data?.before?.data();if(a?.status===b?.status)return;const stop=await db.collection('companies').doc(e.params.companyId).collection('serviceStops').doc(e.params.stopId).get();return reconcile(e.params.companyId,stop.data()?.workOfferId);}
 async function onProduct(e){
  const a=e.data?.after?.data(),b=e.data?.before?.data();if(a?.status===b?.status)return;
  const c=db.collection('companies').doc(e.params.companyId),jobId=id(a?.jobId || b?.jobId),stopId=id(a?.serviceStopId || b?.serviceStopId),ids=new Set();
  if(jobId){const offers=await c.collection('workOffers').where('jobId','==',jobId).get();offers.docs.forEach(v=>ids.add(v.id));}
  if(stopId){const stop=await c.collection('serviceStops').doc(stopId).get();if(stop.data()?.workOfferId)ids.add(stop.data().workOfferId);}
  for(const offerId of ids)await reconcile(e.params.companyId,offerId);
 }
 return {reconcile,onStop,onTask,onStopTask,onProduct};
}
module.exports={createWorkOfferProgress};
