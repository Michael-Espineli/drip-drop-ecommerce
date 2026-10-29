const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Timestamp}=require('firebase-admin/firestore');
const {MemoryFirestore}=require('./testSupport/MemoryFirestore');
const {createRouteWork}=require('./routeWork');
const {calendarDate,dateKey,newActiveRoute}=require('./routeState');
const p='companies/company/',zone='America/Los_Angeles',day=calendarDate('2026-10-27',zone,0),next=calendarDate('2026-10-28',zone,0);
function fixture(extra={}) {
  const stop={id:'stop',companyId:'company',techId:'source',tech:'Sam',serviceDate:Timestamp.fromDate(day),recurringServiceStopId:'rss',operationStatus:'Not Finished',manualPayOverrideCents:1200,jobId:'job'};
  const db=new MemoryFirestore({
    'companies/company':{ownerId:'owner',timeZone:zone},'users/operator/userAccess/company':{roleId:'ops',roleName:'Team Lead',status:'Active'},
    [p+'roles/ops']:{permissionIdList:['244']},[p+'companyUsers/source']:{userId:'source',userName:'Sam',status:'Active'},[p+'companyUsers/target']:{userId:'target',userName:'Taylor',workerType:'Employee',status:'Active'},
    [p+'serviceStops/stop']:stop,[p+'recurringServiceStop/rss']:{techId:'source',day:'Tuesday'},
    [p+'activeRoutes/source']:{id:'source',date:day,techId:'source',serviceStopsIds:['stop'],order:[{id:'old',serviceStopId:'stop',order:1}],status:'Traveling',startTime:day,startMilage:10,vehicalId:'truck',durationSeconds:500,distanceMiles:12,plannedRouteId:'planned'},
    [p+'serviceStops/stop/tasks/task']:{id:'task',workerId:'source',workerAssignmentMode:'stop',jobTaskId:'linked',status:'Scheduled',contractedRate:500},
    [p+'workOrders/job/tasks/linked']:{id:'linked',workerId:'source',workerAssignmentMode:'stop',status:'Scheduled',contractedRate:500},...extra,
  });
  const work=createRouteWork(db,()=>new Date('2026-10-27T19:00:00Z'));
  const payload={companyId:'company',action:'oneTime',requestId:'request',techId:'target',serviceDateKey:'2026-10-28',timeZone:zone,stops:[{id:'stop',techId:'source',serviceDateMillis:day.getTime(),assignmentRevision:0}]};
  return {db,payload,call:(data={},uid='operator')=>work.command({auth:uid?{uid}:null,data:{...payload,...data}}),read:path=>db.records.get(p+path)};
}
test('244 alone moves the stop, inherited job tasks, and both routes atomically without changing recurring ownership or pay',async()=>{
  const f=fixture(),rss=f.read('recurringServiceStop/rss'); const result=await f.call();
  const stop=f.read('serviceStops/stop'),source=f.read('activeRoutes/source'),dest=f.read('activeRoutes/com_ar_20261028_target');
  assert.deepEqual(result.movedStopIds,['stop']);assert.equal(stop.techId,'target');assert.equal(dateKey(stop.serviceDate,zone),'2026-10-28');assert.equal(stop.assignmentRevision,1);
  assert.equal(stop.manualPayOverrideCents,1200);assert.equal(stop.oneTimeRouteMove.originalTechId,'source');assert.deepEqual(f.read('recurringServiceStop/rss'),rss);
  assert.deepEqual(source.serviceStopsIds,[]);assert.equal(source.totalStops,0);assert.equal(source.vehicalId,'truck');assert.equal(source.startTime.getTime(),day.getTime());assert.equal(source.startMilage,10);assert.equal(source.status,'Traveling');
  assert.deepEqual(dest.serviceStopsIds,['stop']);assert.equal(dest.totalStops,1);assert.equal(dest.order[0].recurringServiceStopId,'rss');assert.equal(dest.vehicalId,'');assert.equal(dest.durationSeconds,0);assert.equal(dest.distanceMiles,0);assert.equal(dest.plannedRouteId,undefined);assert.equal(dest.startTime,null);
  assert.equal(f.read('serviceStops/stop/tasks/task').workerId,'target');assert.equal(f.read('workOrders/job/tasks/linked').workerId,'target');assert.equal(f.read('workOrders/job/tasks/linked').contractedRate,500);
  assert.equal(f.read('routeMoveRequests/request').actorId,'operator');
  assert.equal(f.read('routeMoveRequests/request').before[0].techId,'source');assert.equal(f.read('routeMoveRequests/request').after[0].techId,'target');
});
test('replay recovers a committed result after a lost response and rejects reuse with changed input or actor',async()=>{
  const f=fixture();await f.call();const version=f.db.version;
  assert.equal((await f.call()).alreadyApplied,true);assert.equal(f.db.version,version);
  await assert.rejects(f.call({serviceDateKey:'2026-10-29'}),/different move/);
  await assert.rejects(f.call({},'owner'),/different move/);
});
test('failed commit leaves stop, task, routes and request history unchanged',async()=>{
  const f=fixture(),before=new Map(f.db.records);f.db.commitError=new Error('offline');await assert.rejects(f.call(),/offline/);assert.deepEqual(f.db.records,before);
});
test('concurrent competing moves have one winner and cannot duplicate destination membership',async()=>{
  const f=fixture();const outcomes=await Promise.allSettled([f.call(),f.call({requestId:'competing',serviceDateKey:'2026-10-29'})]);
  assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);
  assert.equal([...f.db.records].filter(([path,r])=>path.startsWith(p+'activeRoutes/') && r.serviceStopsIds?.includes('stop')).length,1);
});
test('same-day technician reassignment works and preserves existing destination order and vehicle',async()=>{
  const f=fixture({[p+'activeRoutes/target']:{id:'target',techId:'target',date:day,serviceStopsIds:['another'],order:[{serviceStopId:'another',order:1}],status:'Did Not Start',vehicalId:'other-truck'},[p+'serviceStops/another']:{id:'another',techId:'target',serviceDate:day}});
  await f.call({serviceDateKey:'2026-10-27'});assert.deepEqual(f.read('activeRoutes/target').serviceStopsIds,['another','stop']);assert.equal(f.read('activeRoutes/target').vehicalId,'other-truck');
});
test('time-only same-technician/date changes fail as a no-op',async()=>{
  const f=fixture();await assert.rejects(f.call({techId:'source',serviceDateKey:'2026-10-27'}),/already have/);assert.equal(f.read('routeMoveRequests/request'),undefined);
});
test('individually assigned tasks keep their worker',async()=>{
  const f=fixture({[p+'serviceStops/stop/tasks/individual']:{workerId:'third',workerAssignmentMode:'task',status:'Scheduled'}});await f.call();assert.equal(f.read('serviceStops/stop/tasks/individual').workerId,'third');
});
for(const [name,patch] of Object.entries({started:{startTime:day},status:{operationStatus:'In Progress'},finished:{operationStatus:'Finished'},skipped:{operationStatus:'Skipped'},accepted:{workOfferId:'agreed'},pending:{pendingWorkOfferId:'pending'},pay:{payrollAgreement:{offerId:'agreed'}}})) {
  test(`rejects ${name} work before any writes`,async()=>{const f=fixture();f.db.set(p+'serviceStops/stop',{...f.read('serviceStops/stop'),...patch});const before=new Map(f.db.records);await assert.rejects(f.call(),error=>error.code==='failed-precondition');assert.deepEqual(f.db.records,before);});
}
test('started or agreed linked tasks protect the entire move',async()=>{
  for(const patch of [{status:'In Progress'},{status:'Finished'},{payrollAgreement:{offerId:'agreed'}}]) {const f=fixture();f.db.set(p+'workOrders/job/tasks/linked',{...f.read('workOrders/job/tasks/linked'),...patch});await assert.rejects(f.call(),error=>error.code==='failed-precondition');assert.equal(f.read('serviceStops/stop').techId,'source');}
});
test('changed assignment, date, revision or missing stop fails closed',async()=>{
  for(const patch of [{techId:'third'},{serviceDate:next},{assignmentRevision:1}]) {const f=fixture();f.db.set(p+'serviceStops/stop',{...f.read('serviceStops/stop'),...patch});await assert.rejects(f.call(),/changed/);}
  const f=fixture();f.db.records.delete(p+'serviceStops/stop');await assert.rejects(f.call(),error=>error.code==='not-found');
});
test('active access and operational permission are required, even for retry',async()=>{
  const f=fixture();await assert.rejects(f.call({},null),error=>error.code==='unauthenticated');await assert.rejects(f.call({},'outsider'),error=>error.code==='permission-denied');
  for(const value of [{status:'Revoked'},{active:false},{status:'Active',userStatus:'Inactive'}]){const denied=fixture({'users/operator/userAccess/company':{roleId:'ops',...value}});await assert.rejects(denied.call(),error=>error.code==='permission-denied');}
  const denied=fixture({[p+'roles/ops']:{permissionIdList:['424']}});await assert.rejects(denied.call(),error=>error.code==='permission-denied');
  await f.call();f.db.set('users/operator/userAccess/company',{roleId:'ops',status:'Revoked'});await assert.rejects(f.call(),error=>error.code==='permission-denied');
});
test('foreign or inactive destination workers cannot receive stops',async()=>{
  for(const data of [{status:'Inactive'},{companyId:'foreign',status:'Active'}]){const f=fixture({[p+'companyUsers/target']:{userId:'target',...data}});await assert.rejects(f.call(),/active technician/);}
});
test('closed destination rejects new work while closed source retains closeout evidence',async()=>{
  const f=fixture({[p+'activeRoutes/closed']:{id:'closed',techId:'target',date:next,endTime:next,status:'Finished',serviceStopsIds:[]}});await assert.rejects(f.call(),/closed/);assert.equal(f.read('serviceStops/stop').techId,'source');
  const source=fixture();source.db.set(p+'activeRoutes/source',{...source.read('activeRoutes/source'),status:'Finished',endTime:day,endMilage:20});await source.call();assert.equal(source.read('activeRoutes/source').status,'Finished');assert.equal(source.read('activeRoutes/source').endMilage,20);
});
test('duplicates and stale third-route membership are removed without losing route history',async()=>{
  const f=fixture({[p+'activeRoutes/duplicate']:{id:'duplicate',date:day,techId:'source',serviceStopsIds:['stop'],order:[],endTime:day,status:'Finished',vehicalId:'historic'},[p+'activeRoutes/stale']:{id:'stale',date:new Date('2025-01-01'),techId:'third',serviceStopsIds:['stop','keep'],order:[{serviceStopId:'stop',order:1},{serviceStopId:'keep',order:2}],status:'Finished',endTime:day}});
  await f.call();assert.deepEqual(f.read('activeRoutes/stale').serviceStopsIds,['keep']);assert.equal(f.read('activeRoutes/stale').order[0].order,1);assert.equal(f.read('activeRoutes/stale').endTime.getTime(),day.getTime());assert.deepEqual(f.read('activeRoutes/duplicate').serviceStopsIds,[]);assert.equal(f.read('activeRoutes/duplicate').vehicalId,'historic');
});
test('company calendar wins over caller timezone and handles DST boundaries',async()=>{
  const f=fixture();await f.call({serviceDateKey:'2026-11-01',timeZone:'Asia/Tokyo'});assert.equal(f.read('serviceStops/stop').serviceDate.getTime(),Date.parse('2026-11-01T07:00:00Z'));
  assert.equal(calendarDate('2026-11-02',zone,0)-calendarDate('2026-11-01',zone,0),25*3600000);
});
test('invalid dates and oversized atomic scopes fail without partial changes',async()=>{
  const f=fixture();await assert.rejects(f.call({serviceDateKey:'2026-02-30'}),error=>error.code==='invalid-argument');
  for(let n=0;n<441;n++)f.db.set(p+'serviceStops/stop/tasks/task'+n,{status:'Scheduled'});
  const before=new Map(f.db.records);await assert.rejects(f.call(),error=>error.code==='resource-exhausted');assert.deepEqual(f.db.records,before);
});
test('new route schema uses the same stable ID as web and native',()=>assert.equal(newActiveRoute({companyId:'company',workerId:'target',workerName:'Taylor',dayKey:'2026-10-28',zone}).id,'com_ar_20261028_target'));
test('unrelated technicians and historical routes do not limit a small move',async()=>{
  const f=fixture();
  for(let n=0;n<500;n++){
    f.db.set(p+'serviceStops/unrelated'+n,{id:'unrelated'+n,techId:'third',serviceDate:next});
    f.db.set(p+'activeRoutes/history'+n,{id:'history'+n,techId:'source',date:new Date('2025-01-01'),serviceStopsIds:[]});
  }
  await f.call();assert.equal(f.read('serviceStops/stop').techId,'target');
});
