import {jobExecutionProgress} from './jobExecutionProgress';
test('remaining work reflects blockers, schedules, acceptance, offers, and unassigned work without counting finished tasks',()=>{
 const tasks=[{id:'done',status:'Finished'},{id:'blocked'},{id:'scheduled',serviceStopId:{id:'visit'}},{id:'accepted',workerId:'tech'},{id:'offered'},{id:'open'}];
 const result=jobExecutionProgress({tasks,products:[{id:'part',linkedTaskId:'blocked',status:'Need to Purchase',quantity:3,installedQuantity:1}],offers:[{jobTaskIds:['offered'],status:'Posted'}]});
 expect(result.stages).toEqual({unassigned:1,offered:1,acceptedUnscheduled:1,scheduled:1,blocked:1,completed:1});
 expect(result.remainingTasks).toBe(5);expect(result.remainingProductUnits).toBe(2);
});
test('services remain open until their linked work and products finish or management explicitly completes them',()=>{
 const tasks=[{id:'task',status:'Finished'}],services=[{id:'service',taskIds:['task']},{id:'manual'}];
 expect(jobExecutionProgress({tasks,services}).remainingServices).toBe(1);
 expect(jobExecutionProgress({tasks,services,products:[{linkedTaskId:'task',status:'Purchased'}]}).remainingServices).toBe(2);
 expect(jobExecutionProgress({tasks,services:services.map(v=>({...v,completionStatus:'Finished'}))}).remainingServices).toBe(0);
});
test('cancelled offers do not hide unassigned tasks and remaining time does not go negative',()=>{
 const result=jobExecutionProgress({tasks:[{id:'task',estimatedTime:30,actualTime:60}],offers:[{status:'Cancelled',jobTaskIds:['task']}],products:[{status:'Installed',quantity:2}]});
 expect(result.stages.unassigned).toBe(1);expect(result.remainingMinutes).toBe(0);expect(result.remainingProductUnits).toBe(0);
});
