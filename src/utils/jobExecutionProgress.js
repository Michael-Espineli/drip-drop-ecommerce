const id=v=>typeof v==='object'?v?.id:String(v || '');
const normalized=v=>String(v || '').replace(/[^a-z]/gi,'').toLowerCase();
export const isExecutionComplete = item => ['finished','completed','complete','done','cancelled','canceled','skipped'].includes(normalized(item?.status || item?.operationStatus));
export const jobExecutionProgress = ({tasks=[],services=[],products=[],offers=[]}={}) => {
 const openTasks=tasks.filter(v=>!isExecutionComplete(v)),outstandingProducts=products.filter(v=>!['installed','cancelled','canceled','deleted'].includes(normalized(v.status)));
 const stages={unassigned:0,offered:0,acceptedUnscheduled:0,scheduled:0,blocked:0,completed:tasks.length-openTasks.length};
 openTasks.forEach(task=>{
  const offer=offers.find(o=>(o.jobTaskIds || []).includes(task.id)&&!['Rejected','Cancelled','Expired','Completed'].includes(o.status));
  const missingParts=outstandingProducts.some(v=>id(v.linkedTaskId || v.jobTaskId)===task.id&&!['purchased','delivered','available'].includes(normalized(v.status)));
  if(missingParts)stages.blocked++;
  else if(id(task.serviceStopId))stages.scheduled++;
  else if(task.workerId || offer?.claims?.some(v=>v.taskIds?.includes(task.id)&&['Accepted','Scheduled'].includes(v.status)))stages.acceptedUnscheduled++;
  else if(offer)stages.offered++;
  else stages.unassigned++;
 });
 const openServices=services.filter(service=>{
  if(service.completionStatus==='Finished')return false;
  const refs=(service.taskIds?.length?service.taskIds:service.laborLineTaskIds) || [];
  return !refs.length || refs.some(ref=>!tasks.some(task=>task.id===id(ref)&&isExecutionComplete(task))) || outstandingProducts.some(v=>refs.map(id).includes(id(v.linkedTaskId || v.jobTaskId)));
 });
 return {stages,remainingTasks:openTasks.length,remainingServices:openServices.length,remainingProducts:outstandingProducts.length,remainingProductUnits:outstandingProducts.reduce((n,v)=>n+Math.max(0,(Number(v.quantity)||1)-(Number(v.installedQuantity)||0)),0),remainingMinutes:openTasks.reduce((n,v)=>n+Math.max(0,Number(v.estimatedTime || v.estimatedMinutes || 0)-Number(v.actualTime || 0)),0)};
};
