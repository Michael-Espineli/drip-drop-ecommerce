const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');
const {createTechnicianWorkWorkflow}=require('./technicianWorkWorkflow');
const {createTechnicianExecution}=require('./technicianExecution');
const {createTechnicianPayRequests}=require('./technicianPayRequests');
const {createTechnicianTime}=require('./technicianTime');
const {calculatePayLines}=require('./payrollCalculation');
const {createRouteWork}=require('./routeWork');
const company='companies/company',day=new Date('2026-10-26T08:00:00Z');
function fixture(extra={}) {
 const db=new MemoryFirestore({[company]:{ownerId:'admin',name:'Pool'},'users/tech/userAccess/company':{roleId:'tech'},'users/other/userAccess/company':{roleId:'tech'},[company+'/roles/tech']:{permissionIdList:['322','326','334']},[company+'/companyUsers/tech']:{userId:'tech',userName:'Alex',workerType:'Employee'},[company+'/companyUsers/other']:{userId:'other',userName:'Blair',workerType:'Employee'},[company+'/companyPayTypes/repair']:{id:'repair',name:'Repair',category:'repair',defaultRateType:'flatPerTask'},[company+'/technicianRates/rate']:{id:'rate',companyId:'company',technicianId:'tech',payTypeId:'repair',payBasis:'serviceStopTask',rateType:'flatPerTask',amountCents:5000,status:'active',effectiveStartDate:new Date('2026-01-01')},[company+'/workOrders/job']:{id:'job',internalId:'J1',customerId:'customer',serviceLocationId:'site'},[company+'/workOrders/job/tasks/task']:{id:'task',name:'Fix',status:'Draft',payTypeId:'repair',estimatedTime:60},[company+'/settings/companyWide']:{workOffersAutoAssignOnAcceptance:true},...extra});
 const work=createTechnicianWorkWorkflow(db,()=>day);
 const call=(action,data={},uid='admin')=>work.command({auth:{uid},data:{companyId:'company',action,...data}});
 const save=(offer={})=>call('save',{offer:{id:'offer',offerType:'Internal Board',postedToBoard:true,boardVisibility:'Employees & Contractors',jobId:'job',jobTaskIds:['task'],title:'Repair',paySource:'Technician Rate',...offer}});
 return {db,work,call,save};
}
test('an old coverage offer cannot reclaim a stop after a shared one-time move',async()=>{
 const f=fixture({[company+'/serviceStops/one']:{id:'one',techId:'admin',serviceDate:day,operationStatus:'Not Finished'},[company+'/activeRoutes/source']:{id:'source',techId:'admin',date:day,serviceStopsIds:['one'],status:'Did Not Start'}});
 await f.save({jobId:'',jobTaskIds:[],routeId:'source',routeSource:'activeRoutes',routeTechId:'admin',paySource:'Offered Amount',offeredAmountCents:10000});
 await createRouteWork(f.db,()=>day).command({auth:{uid:'admin'},data:{action:'oneTime',companyId:'company',requestId:'move',techId:'other',serviceDateKey:'2026-10-28',timeZone:'UTC',stops:[{id:'one',techId:'admin',serviceDateMillis:day.getTime()}]}});
 await assert.rejects(f.call('accept',{offerId:'offer'},'tech'),/assignment or date changed/);
 assert.equal(f.db.records.get(company+'/serviceStops/one').techId,'other');assert.equal(f.db.records.get(company+'/workOffers/offer').claims.length,0);
});
test('acceptance and review approval revalidate date, worker, revision and started work',async()=>{
 for(const phase of ['accept','approve'])for(const patch of [{techId:'other'},{serviceDate:new Date(day.getTime()+86400000)},{assignmentRevision:1},{operationStatus:'In Progress'},{startTime:day}]) {
  const f=fixture({[company+'/settings/companyWide']:{routeCoverageMode:phase==='approve'?'review':'automatic'},[company+'/serviceStops/one']:{id:'one',techId:'admin',serviceDate:day,operationStatus:'Not Finished'},[company+'/activeRoutes/source']:{id:'source',techId:'admin',date:day,serviceStopsIds:['one']}});
  await f.save({jobId:'',jobTaskIds:[],routeId:'source',routeSource:'activeRoutes',routeTechId:'admin',paySource:'Offered Amount',offeredAmountCents:10000});
  if(phase==='approve')await f.call('accept',{offerId:'offer',claimId:'claim'},'tech');
  f.db.set(company+'/serviceStops/one',{...patch},{merge:true});
  const before=new Map(f.db.records);
  await assert.rejects(f.call(phase,{offerId:'offer',claimId:'claim'},phase==='approve'?'admin':'tech'),error=>error.code==='failed-precondition');
  assert.deepEqual(f.db.records,before);
 }
});
test('first coverage claims reject started stop tasks and linked job tasks',async()=>{
 for(const linked of [false,true]) {
  const f=fixture({[company+'/serviceStops/one']:{id:'one',techId:'admin',serviceDate:day,operationStatus:'Not Finished',jobId:'job'},[company+'/serviceStops/one/tasks/task']:{id:'task',workerId:'admin',workerAssignmentMode:'stop',jobTaskId:'task',status:linked?'Scheduled':'In Progress'},[company+'/workOrders/job/tasks/task']:{id:'task',status:linked?'In Progress':'Scheduled'},[company+'/activeRoutes/source']:{id:'source',techId:'admin',date:day,serviceStopsIds:['one']}});
  await f.save({jobId:'',jobTaskIds:[],routeId:'source',routeSource:'activeRoutes',routeTechId:'admin',paySource:'Offered Amount',offeredAmountCents:10000});
  await assert.rejects(f.call('accept',{offerId:'offer'},'tech'),/started/);assert.equal(f.db.records.get(company+'/serviceStops/one').techId,'admin');
 }
});
test('review approval rejects task scope edited after acceptance',async()=>{
 const f=fixture({[company+'/settings/companyWide']:{workOffersRequireApprovalBeforeAssignment:true}});
 await f.save({paySource:'Offered Amount',offeredAmountCents:10000});await f.call('accept',{offerId:'offer',claimId:'claim'},'tech');
 f.db.set(company+'/workOrders/job/tasks/task',{name:'Different work'},{merge:true});
 await assert.rejects(f.call('approve',{offerId:'offer',claimId:'claim'}),/scope changed/);
 assert.equal(f.db.records.get(company+'/workOffers/offer').claims[0].status,'Acceptance Pending Approval');
});
test('new covering routes initialize independent operational state and retain only source provenance',async()=>{
 const f=fixture({[company+'/serviceStops/one']:{id:'one',techId:'admin',serviceDate:day,operationStatus:'Not Finished'},[company+'/activeRoutes/source']:{id:'source',techId:'admin',date:day,serviceStopsIds:['one'],order:[],vehicleSource:'Personal',vehicalId:'private',personalVehicleOwnerId:'admin',vehiclePlate:'SOURCE',durationSeconds:7200,distanceMiles:40,recurringRouteId:'permanent',plannedRouteId:'permanent',startTime:day,endTime:day,startMilage:10,endMilage:50,status:'Finished'}});
 await f.save({jobId:'',jobTaskIds:[],routeId:'source',routeSource:'activeRoutes',routeTechId:'admin',paySource:'Offered Amount',offeredAmountCents:10000});await f.call('accept',{offerId:'offer'},'tech');
 const target=[...f.db.records].find(([path])=>path.startsWith(company+'/activeRoutes/coverage_'))[1];
 assert.equal(target.vehicalId,'');assert.equal(target.personalVehicleOwnerId,'');assert.equal(target.vehiclePlate,'');assert.equal(target.durationSeconds,0);assert.equal(target.distanceMiles,0);assert.equal(target.startTime,null);assert.equal(target.endTime,null);assert.equal(target.startMilage,null);assert.equal(target.endMilage,null);assert.equal(target.recurringRouteId,undefined);assert.equal(target.plannedRouteId,undefined);assert.deepEqual(target.coverageSourceRouteIds,['source']);
 const source=f.db.records.get(company+'/activeRoutes/source');assert.equal(source.vehicalId,'private');assert.equal(source.endMilage,50);assert.equal(source.durationSeconds,7200);assert.equal(source.status,'Finished');
});
test('one authoritative claim wins under concurrent acceptance and retries are idempotent',async()=>{
 const f=fixture();await f.save({paySource:'Offered Amount',offeredAmountCents:10000});
 const result=await Promise.allSettled([f.call('accept',{offerId:'offer',claimId:'A'},'tech'),f.call('accept',{offerId:'offer',claimId:'B'},'other')]);
 assert.equal(result.filter(v=>v.status==='fulfilled').length,1);
 const claim=f.db.records.get(company+'/workOffers/offer').claims[0];
 assert.equal((await f.call('accept',{offerId:'offer',claimId:claim.id},claim.workerId)).alreadyAccepted,true);
});
test('accepted technician rates and bonuses survive later setup changes',async()=>{
 const f=fixture();await f.save({incentive:{type:'flat',amountCents:1000}});await f.call('accept',{offerId:'offer',claimId:'A'},'tech');
 const terms=f.db.records.get(company+'/workOffers/offer').acceptedTerms;
 const lines=calculatePayLines({companyId:'company',jobTaskSource:true,serviceStop:{id:'job',jobId:'job'},tasks:[{id:'task',jobTaskId:'task',name:'Fix',status:'Finished',workerId:'tech',payTypeId:'repair',payrollAgreement:terms}],rates:[{...terms.rates[0],amountCents:8000}],workTypes:terms.workTypes,settings:{routePaySource:'completedTasks'}});
 assert.equal(lines.reduce((n,v)=>n+v.totalAmountCents,0),6000);
 assert.equal(lines.filter(v=>v.payrollMode==='incentive').length,1);
});
test('review-required claims do not reassign until management approves',async()=>{
 const f=fixture({[company+'/settings/companyWide']:{workOffersRequireApprovalBeforeAssignment:true}});await f.save({paySource:'Offered Amount',offeredAmountCents:10000});
 assert.equal((await f.call('accept',{offerId:'offer',claimId:'A'},'tech')).status,'Acceptance Pending Approval');
 assert.equal(f.db.records.get(company+'/workOrders/job/tasks/task').workerId,undefined);
 await assert.rejects(f.call('approve',{offerId:'offer'},'tech'),/approval/);
 await f.call('approve',{offerId:'offer'},'admin');assert.equal(f.db.records.get(company+'/workOrders/job/tasks/task').workerId,'tech');
});
test('wrong board, worker, expired offers and edits of agreed terms are rejected',async()=>{
 const f=fixture({[company+'/workOfferBoards/board']:{memberUserIds:['other']}});await f.save({boardIds:['board'],paySource:'Offered Amount',offeredAmountCents:100});
 await assert.rejects(f.call('accept',{offerId:'offer'},'tech'),/member/);
 await f.call('accept',{offerId:'offer'},'other');await assert.rejects(f.save(),/locked/);
});
test('atomic accepted-job scheduling preserves task policy, frozen pay, and idempotency',async()=>{
 const f=fixture();await f.save({paySource:'Offered Amount',offeredAmountCents:10000,allowsTechnicianSelfScheduling:true});await f.call('accept',{offerId:'offer',claimId:'A'},'tech');
 const execution=createTechnicianExecution(f.db,()=>day),request={auth:{uid:'tech'},data:{companyId:'company',offerId:'offer',serviceDateMillis:day.getTime()}};
 const first=await execution.schedule(request),second=await execution.schedule(request);assert.equal(first.serviceStopId,second.serviceStopId);
 assert.equal([...f.db.records.keys()].filter(v=>v.startsWith(company+'/serviceStops/')&&!v.includes('/tasks/')).length,1);
 const stop=f.db.records.get(company+'/serviceStops/'+first.serviceStopId);assert.equal(stop.payrollAgreement.fixedAmountCents,10000);
});
for (const [taskPaySource,expectedBase] of [['technicianRate',7500],['taskContractedRate',5700]]) {
 test('planned job pay retains '+taskPaySource+' and mixed task policies from quote through scheduled payroll',async()=>{
  const f=fixture({
   [company+'/paySettings/main']:{routePaySource:'serviceStop',taskPaySource},
   [company+'/workOrders/job/tasks/task']:{id:'task',name:'Repair',status:'Draft',payTypeId:'repair',payrollMode:'automatic',contractedRate:3200,estimatedTime:60},
   [company+'/workOrders/job/tasks/custom']:{id:'custom',name:'Custom work',status:'Draft',payTypeId:'repair',payrollMode:'custom',manualPayOverrideCents:2500,estimatedTime:30},
   [company+'/workOrders/job/tasks/included']:{id:'included',name:'Included work',status:'Draft',payTypeId:'repair',payrollMode:'included'},
   [company+'/workOrders/job/tasks/unpaid']:{id:'unpaid',name:'Unpaid work',status:'Draft',payTypeId:'repair',payrollMode:'unpaid'},
   [company+'/companyPayTypes/system_job_service_stop']:{id:'system_job_service_stop',name:'Job Visit',category:'route',defaultRateType:'flatPerStop'},
   [company+'/technicianRates/visit']:{id:'visit',technicianId:'tech',payTypeId:'system_job_service_stop',payBasis:'serviceStop',rateType:'flatPerStop',amountCents:99000,status:'active'},
  });
  const draft={jobId:'job',jobTaskIds:['task','custom','included','unpaid'],workPurpose:'execution',serviceStopTypeId:'',paySource:'Technician Rate',allowsTechnicianSelfScheduling:true,incentive:{type:'percentage',percentage:10}};
  const quote=await f.call('quote',{technicianId:'tech',offer:draft});
  assert.equal(quote.baseCents,expectedBase);assert.equal(quote.incentiveCents,expectedBase/10);assert.equal(quote.needsReview,false);
  await f.save(draft);await f.call('accept',{offerId:'offer',claimId:'planned'},'tech');
  const offer=f.db.records.get(company+'/workOffers/offer'),agreement=offer.claims[0].agreement;
  assert.equal(agreement.baseCents,quote.baseCents);assert.equal(agreement.totalCents,quote.totalCents);
  assert.equal(agreement.settings.taskPaySource,taskPaySource);assert.equal(agreement.settings.routePaySource,'completedTasks');
  const scheduled=await createTechnicianExecution(f.db,()=>day).schedule({auth:{uid:'tech'},data:{companyId:'company',offerId:'offer',claimId:'planned',serviceDateMillis:day.getTime()}});
  const stop=f.db.records.get(company+'/serviceStops/'+scheduled.serviceStopId);
  const tasks=[...f.db.records].filter(([path])=>path.startsWith(company+'/serviceStops/'+stop.id+'/tasks/')).map(([,task])=>({...task,status:'Finished'}));
  const lines=calculatePayLines({companyId:'company',serviceStop:{...stop,operationStatus:'Finished',payrollAgreement:agreement},tasks,settings:{routePaySource:'serviceStop'},workTypes:agreement.workTypes,rates:agreement.rates});
  assert.equal(lines.reduce((sum,line)=>sum+line.totalAmountCents,0),quote.baseCents);
  assert.equal(lines.some(line=>line.source==='serviceStop'),false);
  const jobTasks=draft.jobTaskIds.map(id=>({...f.db.records.get(company+'/workOrders/job/tasks/'+id),status:'Finished',payrollAgreement:agreement}));
  const jobLines=calculatePayLines({companyId:'company',jobTaskSource:true,serviceStop:{id:'job',jobId:'job'},tasks:jobTasks,settings:agreement.settings,workTypes:agreement.workTypes,rates:agreement.rates});
  assert.equal(jobLines.reduce((sum,line)=>sum+line.totalAmountCents,0),quote.totalCents);
  assert.equal(jobLines.filter(line=>line.payrollSource==='workOfferIncentive').length,1);
  assert.equal(f.db.records.get(company+'/workOrders/job/tasks/task').payTypeId,'repair');
  assert.equal(f.db.records.get(company+'/workOrders/job/tasks/custom').manualPayOverrideCents,2500);
 });
}
test('failed scheduling commits no partial stop or task links',async()=>{
 const f=fixture();await f.save({paySource:'Offered Amount',offeredAmountCents:10000,allowsTechnicianSelfScheduling:true});await f.call('accept',{offerId:'offer'},'tech');f.db.commitError=new Error('offline');
 await assert.rejects(createTechnicianExecution(f.db).schedule({auth:{uid:'tech'},data:{companyId:'company',offerId:'offer',serviceDateMillis:day.getTime()}}),/offline/);
 assert.equal([...f.db.records.keys()].filter(v=>v.startsWith(company+'/serviceStops/')).length,0);
});
test('coverage of an existing stop linked to a job retains its visit pay rules',async()=>{
 const f=fixture({
  [company+'/paySettings/main']:{routePaySource:'serviceStop',taskPaySource:'none'},
  [company+'/serviceStops/one']:{id:'one',jobId:'job',techId:'admin',payTypeId:'repair',serviceDate:day,operationStatus:'Not Finished'},
  [company+'/technicianRates/visit']:{id:'visit',technicianId:'tech',payTypeId:'repair',payBasis:'serviceStop',rateType:'flatPerStop',amountCents:6600,status:'active'},
 });
 const draft={jobId:'job',jobTaskIds:[],serviceStopIds:['one'],paySource:'Technician Rate'};
 const quote=await f.call('quote',{technicianId:'tech',offer:draft});
 assert.equal(quote.baseCents,6600);assert.equal(quote.needsReview,false);
 await f.save(draft);await f.call('accept',{offerId:'offer'},'tech');
 assert.equal(f.db.records.get(company+'/workOffers/offer').claims[0].agreement.settings.routePaySource,'serviceStop');
});
test('a service visit pay item remains payable when its planned tasks have no additional pay',async()=>{
 const f=fixture({
  [company+'/workOrders/job/tasks/task']:{id:'task',name:'Included repair task',status:'Draft',payTypeId:'repair',payrollMode:'included',estimatedTime:60},
  [company+'/workOrders/job/laborLineItems/service']:{id:'service',name:'Repair service',sourceType:'serviceStopType',sourceId:'repair',taskIds:['task']},
  [company+'/technicianRates/visit']:{id:'visit',technicianId:'tech',payTypeId:'repair',payBasis:'serviceStop',rateType:'flatPerStop',amountCents:6500,status:'active'},
 });
 const draft={jobId:'job',jobTaskIds:['task'],serviceStopTypeId:'repair',paySource:'Technician Rate',allowsTechnicianSelfScheduling:true};
 const quote=await f.call('quote',{technicianId:'tech',offer:draft});assert.equal(quote.baseCents,6500);assert.equal(quote.needsReview,false);
 await f.save(draft);await f.call('accept',{offerId:'offer',claimId:'service'},'tech');
 const scheduled=await createTechnicianExecution(f.db,()=>day).schedule({auth:{uid:'tech'},data:{companyId:'company',offerId:'offer',claimId:'service',serviceDateMillis:day.getTime()}});
 const agreement=f.db.records.get(company+'/workOffers/offer').claims[0].agreement;
 const stop=f.db.records.get(company+'/serviceStops/'+scheduled.serviceStopId);
 const tasks=[...f.db.records].filter(([path])=>path.startsWith(company+'/serviceStops/'+stop.id+'/tasks/')).map(([,task])=>({...task,status:'Finished'}));
 const lines=calculatePayLines({companyId:'company',serviceStop:{...stop,operationStatus:'Finished',payrollAgreement:agreement},tasks,workTypes:agreement.workTypes,rates:agreement.rates});
 assert.equal(lines.reduce((sum,line)=>sum+line.totalAmountCents,0),quote.totalCents);
 assert.equal(lines.length,1);assert.equal(lines[0].source,'serviceStop');assert.equal(stop.payTypeId,'repair');
});
test('clock-out closes shift and log, including normal nil-transition behavior',async()=>{
 let current=day;const f=fixture(),clock=createTechnicianTime(f.db,()=>current);
 const action=(action,requestId)=>clock.command({auth:{uid:'tech'},data:{companyId:'company',action,requestId}});
 const first=await action('clockIn','1');current=new Date(day.getTime()+3600000);await action('clockOut','2');
 assert.equal(f.db.records.get(company+'/shifts/'+first.shiftId).isCurrent,false);
 assert.equal(f.db.records.get(company+'/workLogs/'+first.logId).current,false);
 assert.equal((await action('clockOut','2')).alreadyApplied,true);
});
test('pay counteroffers require technician acceptance and preserve prior effective-dated rate',async()=>{
 const f=fixture(),requests=createTechnicianPayRequests(f.db,()=>day);
 const call=(action,data={},uid='tech')=>requests.command({auth:{uid},data:{companyId:'company',action,...data}});
 const created=await call('create',{clientRequestId:'rate',type:'rateChange',payTypeId:'repair',payBasis:'serviceStopTask',rateType:'flatPerTask',amountCents:8000,effectiveStartMillis:new Date('2026-11-01').getTime(),reason:'More repair work'});
 await assert.rejects(call('approve',{requestId:created.requestId}),/approval/);
 await call('counter',{requestId:created.requestId,amountCents:7000},'admin');assert.equal(f.db.records.get(company+'/technicianRates/rate').amountCents,5000);
 await call('acceptCounter',{requestId:created.requestId});assert.equal(f.db.records.get(company+'/technicianRates/rate').amountCents,5000);assert.ok(f.db.records.get(company+'/technicianRates/rate').effectiveEndDate);
 assert.equal([...f.db.records.values()].filter(v=>v.payChangeRequestId===created.requestId&&v.amountCents===7000).length,1);
});

test('split coverage moves both route memberships and allocates a single fixed offer and incentive',async()=>{
 const extra={};for(const name of ['one','two'])extra[company+'/serviceStops/'+name]={id:name,techId:'admin',serviceDate:day,operationStatus:'Not Finished',typeId:'repair',customerName:name};
 extra[company+'/activeRoutes/source']={id:'source',techId:'admin',date:day,serviceStopsIds:['one','two'],order:[{serviceStopId:'one',order:1},{serviceStopId:'two',order:2}],totalStops:2,finishedStops:0};
 const f=fixture(extra);await f.save({jobId:'',jobTaskIds:[],routeId:'source',routeSource:'activeRoutes',routeTechId:'admin',routeSplitAllowed:true,paySource:'Offered Amount',offeredAmountCents:10001,incentive:{type:'flat',amountCents:1001}});
 await f.call('accept',{offerId:'offer',claimId:'A',stopIds:['one']},'tech');await f.call('accept',{offerId:'offer',claimId:'B',stopIds:['two']},'other');
 assert.deepEqual(f.db.records.get(company+'/activeRoutes/source').serviceStopsIds,[]);
 const covered=[...f.db.records].filter(([path])=>path.startsWith(company+'/activeRoutes/coverage_')).map(([,v])=>v);
 assert.equal(covered.length,2);assert.equal(covered.reduce((n,v)=>n+v.totalStops,0),2);
 const agreements=['one','two'].map(v=>f.db.records.get(company+'/serviceStops/'+v).payrollAgreement);
 assert.equal(agreements.reduce((n,v)=>n+v.fixedAmountCents,0),10001);assert.equal(agreements.reduce((n,v)=>n+v.incentiveCents,0),1001);
 assert.ok(agreements.every(v=>!v.rates));
});
test('keep-together routes reject partial claims, notify mode informs management, and recurring ownership stays intact',async()=>{
 const f=fixture({[company+'/settings/companyWide']:{routeCoverageMode:'notify'},[company+'/serviceStops/one']:{techId:'admin',serviceDate:day,operationStatus:'Not Finished'},[company+'/serviceStops/two']:{techId:'admin',serviceDate:day,operationStatus:'Not Finished'},[company+'/recurringServiceStop/rss']:{techId:'admin'},[company+'/activeRoutes/source']:{techId:'admin',date:day,serviceStopsIds:['one','two']}});
 await f.save({jobId:'',jobTaskIds:[],routeId:'source',routeSource:'activeRoutes',routeTechId:'admin',routeSplitAllowed:false,paySource:'Offered Amount',offeredAmountCents:10000});
 await assert.rejects(f.call('accept',{offerId:'offer',stopIds:['one']},'tech'),/together/);await f.call('accept',{offerId:'offer',stopIds:['one','two']},'tech');
 assert.equal(f.db.records.get(company+'/recurringServiceStop/rss').techId,'admin');
 assert.ok([...f.db.records.keys()].some(v=>v.startsWith('users/admin/alerts/coverage_')));
});
test('scope changes, unauthorized custom pay, and forged agreement data cannot turn into frozen earnings',async()=>{
 const f=fixture();await assert.rejects(f.call('save',{offer:{id:'bad',jobId:'job',jobTaskIds:['task'],paySource:'Offered Amount',offeredAmountCents:100000}},'tech'));
 await f.save();f.db.set(company+'/workOrders/job/tasks/task',{name:'Changed repair'},{merge:true});await assert.rejects(f.call('accept',{offerId:'offer'},'tech'),/scope changed/);
 const workflow=require('./payrollWorkflow').createPayrollWorkflow(f.db);
 f.db.set(company+'/workOrders/job/tasks/task',{status:'Finished',workerId:'tech',payrollAgreement:{workerId:'tech',paySource:'Offered Amount',fixedAmountCents:999999,taskIds:['task']}},{merge:true});
 await workflow.reconcileJob('company','job');
 const earned=[...f.db.records].filter(([path])=>path.startsWith(company+'/technicianPayLineItems/')).map(([,v])=>v).filter(v=>v.calculationStatus!=='voided');
 assert.equal(earned.reduce((n,v)=>n+v.totalAmountCents,0),5000);
});
test('the payroll workflow resolves private accepted terms after rates change and rejects forged allocations',async()=>{
 const f=fixture();await f.save({paySource:'Offered Amount',offeredAmountCents:10000,incentive:{type:'flat',amountCents:1000},allowsTechnicianSelfScheduling:true});await f.call('accept',{offerId:'offer',claimId:'A'},'tech');
 const scheduled=await createTechnicianExecution(f.db,()=>day).schedule({auth:{uid:'tech'},data:{companyId:'company',offerId:'offer',serviceDateMillis:day.getTime()}});
 const stopPath=company+'/serviceStops/'+scheduled.serviceStopId;
 f.db.set(stopPath,{operationStatus:'Finished',payrollAgreement:{...f.db.records.get(stopPath).payrollAgreement,fixedAmountCents:999999}},{merge:true});
 const taskPath=[...f.db.records.keys()].find(v=>v.startsWith(stopPath+'/tasks/'));f.db.set(taskPath,{status:'Finished'},{merge:true});
 f.db.set(company+'/workOrders/job/tasks/task',{status:'Finished'},{merge:true});
 await require('./workOfferProgress').createWorkOfferProgress(f.db,()=>day).reconcile('company','offer');
 await require('./payrollWorkflow').createPayrollWorkflow(f.db).reconcileStop('company',scheduled.serviceStopId);
 const earned=[...f.db.records].filter(([path])=>path.startsWith(company+'/technicianPayLineItems/')).map(([,v])=>v).filter(v=>v.calculationStatus!=='voided');
 assert.equal(earned.reduce((n,v)=>n+v.totalAmountCents,0),11000);
});
test('clocked work uses accepted hourly rates, unions overlapping records, and keeps fixed work out of hourly earnings',async()=>{
 const hourly={id:'hourly',companyId:'company',technicianId:'tech',payBasis:'technicianHourly',payTypeId:null,rateType:'hourly',amountCents:3000,effectiveStartDate:new Date('2026-01-01'),status:'active'};
 const f=fixture({[company+'/paySettings/main']:{payMode:'hourlyOnly',hourlyPaySource:'workLogs'},[company+'/technicianRates/hourly']:hourly});
 let current=day;const clock=createTechnicianTime(f.db,()=>current);
 const call=(action,requestId)=>clock.command({auth:{uid:'tech'},data:{companyId:'company',action,requestId}});
 const shift=await call('clockIn','start');current=new Date(day.getTime()+3600000);await call('clockOut','end');
 f.db.set(company+'/technicianRates/hourly',{amountCents:8000},{merge:true});
 await clock.reconcile('company','workLogs',shift.shiftId);
 const earned=[...f.db.records].filter(([path])=>path.startsWith(company+'/technicianPayLineItems/')).map(([,v])=>v);assert.equal(earned.reduce((n,v)=>n+v.totalAmountCents,0),3000);
 await clock.reconcile('company','workLogs',shift.shiftId);assert.equal([...f.db.records.keys()].filter(v=>v.startsWith(company+'/technicianPayLineItems/')).length,1);
});
test('closeout requires an explicit choice, preserves remaining work, and cancels unused visits without marking them performed',async()=>{
 const f=fixture({[company+'/shoppingList/product']:{id:'product',jobId:'job',status:'Purchased',quantity:'2'},[company+'/workOrders/job/laborLineItems/service']:{id:'service',name:'Repair',taskIds:['task']},[company+'/serviceStops/future']:{jobId:'job',techId:'tech',operationStatus:'Not Finished'}});
 const close=require('./jobCloseout').createJobCloseout(f.db,()=>day),call=data=>close({auth:{uid:'admin'},data:{companyId:'company',jobId:'job',requestId:data.finishJob?'finish-job':'finish-work',...data}});
 await assert.rejects(call({finishJob:true}),/remaining tasks/);
 await call({finishJob:false,taskIds:['task']});assert.equal(f.db.records.get(company+'/workOrders/job').operationStatus,undefined);assert.equal(f.db.records.get(company+'/shoppingList/product').status,'Purchased');
 await call({finishJob:true,productIds:['product'],serviceIds:['service'],cancelRemainingVisits:true});assert.equal(f.db.records.get(company+'/workOrders/job').operationStatus,'Finished');assert.equal(f.db.records.get(company+'/serviceStops/future').operationStatus,'Skipped');
 await call({finishJob:true,productIds:['product'],serviceIds:['service'],cancelRemainingVisits:true});assert.equal([...f.db.records.keys()].filter(v=>v.startsWith(company+'/workOrders/job/history/')).length,2);
});
const earned=f=>[...f.db.records].filter(([p])=>p.startsWith(company+'/technicianPayLineItems/')).map(([,v])=>v).filter(v=>v.calculationStatus!=='voided');
const progress=f=>require('./workOfferProgress').createWorkOfferProgress(f.db,()=>day);
const payroll=f=>require('./payrollWorkflow').createPayrollWorkflow(f.db);
test('route quotes include inherited stop tasks and completion waits for their product installation',async()=>{
 const f=fixture({[company+'/serviceStops/one']:{techId:'admin',serviceDate:day,operationStatus:'Not Finished',payTypeId:'repair'},[company+'/serviceStops/one/tasks/install']:{status:'Draft',workerId:'admin',workerAssignmentMode:'stop',payTypeId:'repair',name:'Install filter'},[company+'/shoppingList/part']:{status:'Purchased',quantity:2,serviceStopId:'one'},[company+'/activeRoutes/source']:{techId:'admin',date:day,serviceStopsIds:['one']},[company+'/paySettings/main']:{routePaySource:'completedTasks'}});
 await f.save({jobId:'',jobTaskIds:[],routeId:'source',paySource:'Technician Rate',incentive:{type:'flat',amountCents:1000}});
 const quote=await f.call('preview',{offerId:'offer'},'tech');assert.equal(quote.baseCents,5000);assert.equal(quote.scope.tasks[0].name,'Install filter');assert.equal(quote.scope.products.length,1);
 await f.call('accept',{offerId:'offer',claimId:'A'},'tech');
 f.db.set(company+'/serviceStops/one',{operationStatus:'Finished'},{merge:true});await progress(f).reconcile('company','offer');assert.notEqual(f.db.records.get(company+'/workOffers/offer').claims[0].status,'Completed');
 f.db.set(company+'/serviceStops/one/tasks/install',{status:'Finished'},{merge:true});await progress(f).reconcile('company','offer');assert.notEqual(f.db.records.get(company+'/workOffers/offer').claims[0].status,'Completed');
 f.db.set(company+'/shoppingList/part',{status:'Installed'},{merge:true});await progress(f).reconcile('company','offer');await payroll(f).reconcileOffer('company','offer');
 assert.equal(f.db.records.get(company+'/workOffers/offer').claims[0].status,'Completed');assert.equal(earned(f).reduce((n,v)=>n+v.totalAmountCents,0),6000);
});
test('a fixed route pays its agreed amount once, including its tasks, under clock payroll',async()=>{
 const extra={[company+'/paySettings/main']:{payMode:'hourlyOnly',hourlyPaySource:'workLogs'},[company+'/activeRoutes/source']:{techId:'admin',date:day,serviceStopsIds:['one','two']}};
 for(const stop of ['one','two']){extra[company+'/serviceStops/'+stop]={techId:'admin',serviceDate:day,operationStatus:'Not Finished'};extra[company+'/serviceStops/'+stop+'/tasks/install']={status:'Draft',workerId:'admin',workerAssignmentMode:'stop',payTypeId:'repair'};}
 const f=fixture(extra);await f.save({jobId:'',jobTaskIds:[],routeId:'source',paySource:'Offered Amount',offeredAmountCents:10001,incentive:{type:'flat',amountCents:1001}});await f.call('accept',{offerId:'offer',claimId:'A'},'tech');
 for(const stop of ['one','two']){f.db.set(company+'/serviceStops/'+stop,{operationStatus:'Finished'},{merge:true});f.db.set(company+'/serviceStops/'+stop+'/tasks/install',{status:'Finished'},{merge:true});}
 await progress(f).reconcile('company','offer');await payroll(f).reconcileOffer('company','offer');await payroll(f).reconcileOffer('company','offer');
 assert.equal(earned(f).reduce((n,v)=>n+v.totalAmountCents,0),11002);assert.equal(earned(f).filter(v=>v.payrollSource==='workOfferIncentive').length,1);assert.equal(earned(f).filter(v=>v.payrollSource!=='workOfferIncentive').length,2);
});
test('one percentage incentive includes the actual closed clock allocation and updates without duplication',async()=>{
 const rate={id:'hourly',companyId:'company',technicianId:'tech',payBasis:'technicianHourly',rateType:'hourly',amountCents:3000,effectiveStartDate:new Date('2026-01-01'),status:'active'};
 const f=fixture({[company+'/paySettings/main']:{payMode:'hourlyOnly',hourlyPaySource:'workLogs'},[company+'/technicianRates/hourly']:rate});
 await f.save({incentive:{type:'percentage',percentage:10},estimatedMinutes:60});await f.call('accept',{offerId:'offer',claimId:'A'},'tech');
 let current=day;const clock=createTechnicianTime(f.db,()=>current),call=(action,requestId)=>clock.command({auth:{uid:'tech'},data:{companyId:'company',action,requestId,offerId:'offer'}});
 const shift=await call('clockIn','in');f.db.set(company+'/workOrders/job/tasks/task',{status:'Finished'},{merge:true});await progress(f).reconcile('company','offer');await payroll(f).reconcileOffer('company','offer');assert.equal(earned(f).length,0);
 current=new Date(day.getTime()+3600000);await call('clockOut','out');await clock.reconcile('company','workLogs',shift.shiftId);
 await payroll(f).reconcileOffer('company','offer');await payroll(f).reconcileOffer('company','offer');
 assert.equal(earned(f).reduce((n,v)=>n+v.totalAmountCents,0),3300);assert.equal(earned(f).filter(v=>v.payrollSource==='workOfferIncentive').length,1);
});
test('overlapping clock records are counted once and unpaid break/lunch periods are excluded',async()=>{
 const hourly={technicianId:'tech',payBasis:'technicianHourly',rateType:'hourly',amountCents:6000};
 const minute=n=>new Date(day.getTime()+n*60000);
 const f=fixture({[company+'/paySettings/main']:{payMode:'hourlyOnly',hourlyPaySource:'workLogs'},[company+'/technicianRates/hourly']:hourly,[company+'/shifts/shift']:{techId:'tech',date:day,startTime:day,endTime:minute(120),isCurrent:false},[company+'/workLogs/one']:{shiftId:'shift',type:'Working',startTime:day,endTime:minute(60)},[company+'/workLogs/overlap']:{shiftId:'shift',type:'Working',startTime:minute(30),endTime:minute(90)},[company+'/workLogs/lunch']:{shiftId:'shift',type:'On Lunch',startTime:minute(90),endTime:minute(120)}});
 await createTechnicianTime(f.db).reconcile('company','workLogs','shift');assert.equal(earned(f).reduce((n,v)=>n+v.totalAmountCents,0),9000);assert.equal(f.db.records.get(company+'/shifts/shift').payrollTimeMinutes,90);
});
test('fixed accepted work clock records remain visible without additional hourly earnings',async()=>{
 const f=fixture({[company+'/paySettings/main']:{payMode:'hourlyOnly',hourlyPaySource:'workLogs'}});await f.save({paySource:'Offered Amount',offeredAmountCents:10000});await f.call('accept',{offerId:'offer'},'tech');
 let current=day;const clock=createTechnicianTime(f.db,()=>current),call=(action,requestId)=>clock.command({auth:{uid:'tech'},data:{companyId:'company',offerId:'offer',action,requestId}});
 const shift=await call('clockIn','in');current=new Date(day.getTime()+3600000);await call('clockOut','out');await clock.reconcile('company','workLogs',shift.shiftId);assert.equal(earned(f).length,0);assert.ok(f.db.records.get(company+'/workLogs/'+shift.logId).timePayIncluded);
});
test('unstarted accepted coverage transfers atomically and retains the previous offer audit',async()=>{
 const f=fixture({[company+'/serviceStops/one']:{techId:'admin',serviceDate:day,operationStatus:'Not Finished'},[company+'/serviceStops/one/tasks/task']:{status:'Draft',workerId:'admin',workerAssignmentMode:'stop',payTypeId:'repair'},[company+'/activeRoutes/source']:{techId:'admin',date:day,serviceStopsIds:['one']}});
 await f.save({jobId:'',jobTaskIds:[],routeId:'source',paySource:'Offered Amount',offeredAmountCents:10000});await f.call('accept',{offerId:'offer',claimId:'A'},'tech');
 await f.save({id:'cover',jobId:'',jobTaskIds:[],routeId:'source',routeServiceStopIds:['one'],routeTechId:'tech',paySource:'Offered Amount',offeredAmountCents:12000});
 await f.call('accept',{offerId:'cover',claimId:'B'},'other');
 assert.equal(f.db.records.get(company+'/serviceStops/one').techId,'other');assert.equal(f.db.records.get(company+'/serviceStops/one/tasks/task').workerId,'other');assert.equal(f.db.records.get(company+'/workOffers/offer').claims[0].status,'Transferred');assert.equal(f.db.records.get(company+'/workOffers/offer').transferHistory.length,1);
 await progress(f).reconcile('company','offer');await payroll(f).reconcileOffer('company','offer');assert.equal(earned(f).length,0);
});
test('work already performed cannot be transferred through a fresh coverage offer',async()=>{
 const f=fixture({[company+'/serviceStops/one']:{techId:'admin',serviceDate:day,operationStatus:'Not Finished'},[company+'/serviceStops/one/tasks/task']:{status:'Draft',workerId:'admin',workerAssignmentMode:'stop'},[company+'/activeRoutes/source']:{techId:'admin',date:day,serviceStopsIds:['one']}});
 await f.save({jobId:'',jobTaskIds:[],routeId:'source',paySource:'Offered Amount',offeredAmountCents:10000});await f.call('accept',{offerId:'offer',claimId:'A'},'tech');f.db.set(company+'/serviceStops/one/tasks/task',{status:'Finished'},{merge:true});
 await f.save({id:'cover',jobId:'',jobTaskIds:[],routeServiceStopIds:['one'],routeId:'source',paySource:'Offered Amount',offeredAmountCents:12000});await assert.rejects(f.call('accept',{offerId:'cover'},'other'),/already started/);assert.equal(f.db.records.get(company+'/serviceStops/one').techId,'tech');
});
test('a rejected pending split claim releases its reservation and only remaining scope is quoted',async()=>{
 const f=fixture({[company+'/settings/companyWide']:{routeCoverageMode:'review'},[company+'/serviceStops/one']:{techId:'admin',serviceDate:day,operationStatus:'Not Finished'},[company+'/serviceStops/two']:{techId:'admin',serviceDate:day,operationStatus:'Not Finished'},[company+'/activeRoutes/source']:{techId:'admin',date:day,serviceStopsIds:['one','two']}});
 await f.save({jobId:'',jobTaskIds:[],routeId:'source',routeSplitAllowed:true,paySource:'Offered Amount',offeredAmountCents:10000});await f.call('accept',{offerId:'offer',claimId:'A',stopIds:['one']},'tech');
 const quote=await f.call('preview',{offerId:'offer'},'other');assert.equal(quote.baseCents,5000);assert.deepEqual(quote.scope.stops.map(v=>v.id),['two']);
 await f.call('rejectClaim',{offerId:'offer',claimId:'A'});await f.call('accept',{offerId:'offer',claimId:'B',stopIds:['one']},'other');assert.deepEqual(f.db.records.get(company+'/workOffers/offer').remainingStopIds,['two']);
});
test('diagnostics schedule an estimate pay type without creating fake repair tasks',async()=>{
 const f=fixture();await f.save({jobTaskIds:[],workPurpose:'diagnostic',paySource:'Offered Amount',offeredAmountCents:2500,allowsTechnicianSelfScheduling:true});await f.call('accept',{offerId:'offer'},'tech');
 const result=await createTechnicianExecution(f.db,()=>day).schedule({auth:{uid:'tech'},data:{companyId:'company',offerId:'offer',serviceDateMillis:day.getTime(),serviceStopTypeId:'wrong'}});
 assert.equal(f.db.records.get(company+'/serviceStops/'+result.serviceStopId).payTypeId,'system_job_estimate_service_stop');assert.equal([...f.db.records.keys()].filter(v=>v.startsWith(company+'/serviceStops/'+result.serviceStopId+'/tasks/')).length,0);
});
test('rate edits are versioned, retries are stable, and duplicate schedule edits are rejected',async()=>{
 const f=fixture(),edit=require('./technicianRates').createTechnicianRates(f.db,()=>day),rate={existingId:'rate',technicianId:'tech',payTypeId:'repair',payBasis:'serviceStopTask',rateType:'flatPerTask',amountCents:7000,effectiveStartMillis:day.getTime()};
 const request={auth:{uid:'admin'},data:{companyId:'company',requestId:'edit',rates:[rate]}};
 const first=await edit(request),retry=await edit(request);assert.deepEqual(first,retry);assert.equal(f.db.records.get(company+'/technicianRates/rate').amountCents,5000);assert.equal(f.db.records.get(company+'/technicianRates/'+first.rateIds[0]).amountCents,7000);
 await assert.rejects(edit({auth:{uid:'admin'},data:{companyId:'company',requestId:'duplicate',rates:[{...rate,existingId:''},{...rate,existingId:''}]}}),/one change/);
});
test('repeated pay corrections target the corrected total without paying the earlier adjustment twice',async()=>{
 const f=fixture({[company+'/technicianPayLineItems/paid']:{technicianId:'tech',totalAmountCents:5000,calculationStatus:'paid',paidAt:day}}),requests=createTechnicianPayRequests(f.db,()=>day);
 for(const [requestId,amountCents] of [['first',6000],['second',7000]]){const created=await requests.command({auth:{uid:'tech'},data:{companyId:'company',action:'create',clientRequestId:requestId,type:'payCorrection',payLineItemId:'paid',amountCents,reason:'Review total'}});await requests.command({auth:{uid:'admin'},data:{companyId:'company',action:'approve',requestId:created.requestId}});}
 assert.equal(f.db.records.get(company+'/technicianPayLineItems/paid').totalAmountCents,5000);assert.equal(earned(f).reduce((n,v)=>n+v.totalAmountCents,0),7000);
});
test('direct offers cannot be accepted by a manager on behalf of the named technician',async()=>{
 const f=fixture();await f.save({offerType:'Direct User',offeredToUserId:'tech',postedToBoard:false,paySource:'Offered Amount',offeredAmountCents:10000});await assert.rejects(f.call('accept',{offerId:'offer'},'admin'),/named technician/);
});
test('the server offer list never exposes another technician rate snapshot to a work-board manager',async()=>{
 const f=fixture({[company+'/roles/tech']:{permissionIdList:['322','324','332','334']}});await f.save({offerType:'Direct User',offeredToUserId:'other',paySource:'Offered Amount',offeredAmountCents:10000,postedToBoard:false});await f.call('accept',{offerId:'offer'},'other');
 const list=await f.call('list',{},'tech');const offer=list.offers[0];assert.equal(offer.acceptedTerms.baseCents,undefined);assert.equal(offer.acceptedTerms.rates,undefined);assert.equal(offer.acceptedTerms.quotedPayLines,undefined);assert.equal(offer.claims[0].agreement.rates,undefined);
 const own=await f.call('list',{},'other');assert.equal(own.offers[0].claims[0].agreement.totalCents,10000);
});
test('accepted pay uses the schedule quoted for the offered work date rather than the acceptance date',async()=>{
 const start=new Date('2026-11-01T08:00:00Z');const f=fixture({[company+'/technicianRates/rate']:{id:'rate',technicianId:'tech',payTypeId:'repair',payBasis:'serviceStopTask',rateType:'flatPerTask',amountCents:5000,status:'expired',effectiveStartDate:new Date('2026-01-01'),effectiveEndDate:new Date(start.getTime()-1)},[company+'/technicianRates/future']:{id:'future',technicianId:'tech',payTypeId:'repair',payBasis:'serviceStopTask',rateType:'flatPerTask',amountCents:7000,status:'scheduled',effectiveStartDate:start}});
 await f.save({proposedStartDate:start});const quote=await f.call('preview',{offerId:'offer'},'tech');assert.equal(quote.baseCents,7000);await f.call('accept',{offerId:'offer'},'tech');f.db.set(company+'/workOrders/job/tasks/task',{status:'Finished'},{merge:true});await progress(f).reconcile('company','offer');await payroll(f).reconcileOffer('company','offer');assert.equal(earned(f).reduce((n,v)=>n+v.totalAmountCents,0),7000);
});
test('whole-job closeout cancels unused appointments while preserving completed offered work and one audit event per retry',async()=>{
 const f=fixture();await f.save({paySource:'Offered Amount',offeredAmountCents:10000,allowsTechnicianSelfScheduling:true});await f.call('accept',{offerId:'offer',claimId:'A'},'tech');const scheduled=await createTechnicianExecution(f.db,()=>day).schedule({auth:{uid:'tech'},data:{companyId:'company',offerId:'offer',serviceDateMillis:day.getTime()}});
 const close=require('./jobCloseout').createJobCloseout(f.db,()=>day),request={auth:{uid:'admin'},data:{companyId:'company',jobId:'job',requestId:'close',finishJob:true,cancelRemainingVisits:true,taskIds:['task']}};
 await close(request);await close(request);assert.equal(f.db.records.get(company+'/serviceStops/'+scheduled.serviceStopId).operationStatus,'Skipped');assert.equal(f.db.records.get(company+'/workOrders/job/tasks/task').serviceStopId.id,'');
 const history=[...f.db.records].filter(([p])=>p.startsWith(company+'/workOrders/job/history/')).map(([,v])=>v);assert.equal(history.length,1);assert.deepEqual(history[0].cancelledVisitIds,[scheduled.serviceStopId]);
 await progress(f).reconcile('company','offer');await payroll(f).reconcileOffer('company','offer');assert.equal(earned(f).reduce((sum,v)=>sum+v.totalAmountCents,0),10000);
});
test('route-duration pay uses accepted hourly terms and mixed fixed/hourly routes require allocation review',async()=>{
 const rate={id:'hourly',companyId:'company',technicianId:'tech',payBasis:'technicianHourly',rateType:'hourly',amountCents:3000,effectiveStartDate:new Date('2026-01-01'),status:'active'};
 const f=fixture({[company+'/technicianRates/hourly']:rate,[company+'/paySettings/main']:{payMode:'hourlyOnly',hourlyPaySource:'activeRouteDuration'},[company+'/serviceStops/one']:{techId:'admin',operationStatus:'Not Finished',serviceDate:day,estimatedDuration:60},[company+'/activeRoutes/source']:{techId:'admin',date:day,serviceStopsIds:['one']}});
 await f.save({jobId:'',jobTaskIds:[],routeId:'source',paySource:'Technician Rate'});await f.call('accept',{offerId:'offer',claimId:'A'},'tech');
 const [path,route]=[...f.db.records].find(([p,v])=>p.startsWith(company+'/activeRoutes/')&&v.techId==='tech');const end=new Date(day.getTime()+3600000);
 f.db.set(path,{status:'Finished',startTime:day,endTime:end},{merge:true});f.db.set(company+'/technicianRates/hourly',{amountCents:9000},{merge:true});const clock=createTechnicianTime(f.db,()=>end);await clock.reconcile('company','activeRoutes',route.id);assert.equal(earned(f).reduce((sum,v)=>sum+v.totalAmountCents,0),3000);assert.equal(earned(f)[0].workOfferClaimId,'A');
 f.db.set(company+'/serviceStops/mixed',{techId:'tech'});f.db.set(path,{serviceStopsIds:['one','mixed']},{merge:true});await clock.reconcile('company','activeRoutes',route.id);assert.equal(earned(f)[0].calculationStatus,'needsReview');assert.equal(earned(f)[0].totalAmountCents,0);
});
test('paid work cannot be accepted while company payroll is disabled and a lost acceptance response can retry safely',async()=>{
 const f=fixture({[company+'/settings/companyWide']:{payrollEnabled:false}});await f.save({paySource:'Offered Amount',offeredAmountCents:10000});await assert.rejects(f.call('accept',{offerId:'offer'},'tech'),/Enable company payroll/);
 f.db.set(company+'/settings/companyWide',{payrollEnabled:true},{merge:true});const first=await f.call('accept',{offerId:'offer',claimId:'first'},'tech');const retry=await f.call('accept',{offerId:'offer',claimId:'retry'},'tech');assert.equal(first.claimId,retry.claimId);assert.equal(retry.alreadyAccepted,true);
});
test('clock payroll honors legacy company payroll-disable flags as well as the canonical setting',async()=>{
 for(const wide of [{companyPayrollEnabled:false},{payrollDisabled:true},{payrollEnabled:false}]){
  const end=new Date(day.getTime()+3600000),f=fixture({[company+'/settings/companyWide']:wide,[company+'/paySettings/main']:{payMode:'hourlyOnly',hourlyPaySource:'workLogs'},[company+'/technicianRates/hourly']:{technicianId:'tech',payBasis:'technicianHourly',rateType:'hourly',amountCents:3000},[company+'/shifts/closed']:{techId:'tech',startTime:day,endTime:end,isCurrent:false},[company+'/workLogs/closed']:{shiftId:'closed',type:'Working',startTime:day,endTime:end}});
  await createTechnicianTime(f.db).reconcile('company','workLogs','closed');assert.equal(earned(f).length,0);
 }
});
